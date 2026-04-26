import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { OAuthProvider, User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { MailerService } from '../common/mail/mailer.service';
import { geocode } from '../common/geo/city-coords';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EmailTokenService } from './email-token.service';
import { GoogleOAuthService } from './google-oauth.service';
import { AppleVerifierService } from './apple-verifier.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_STAGES_MS = [15 * 60_000, 30 * 60_000, 60 * 60_000];

export type AuthResult = {
  user: User;
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    private readonly emailTokens: EmailTokenService,
    private readonly google: GoogleOAuthService,
    private readonly apple: AppleVerifierService,
  ) {}

  async signInWithGoogle(idToken: string, deviceName?: string): Promise<AuthResult> {
    const profile = await this.google.verifyIdToken(idToken);
    // Refuse unverified Google emails. Google returns email_verified=false for
    // some edge cases (hosted domain users with unverified aliases). Accepting
    // them would allow anyone to claim any email via a Google account.
    if (profile.email && !profile.emailVerified) {
      throw new UnauthorizedException('Google email is not verified');
    }
    return this.loginWithOAuth(
      'google',
      profile.providerId,
      {
        email: profile.email ?? undefined,
        emailVerified: profile.emailVerified,
        firstName: profile.firstName ?? undefined,
        lastName: profile.lastName ?? undefined,
        avatarUrl: profile.avatarUrl ?? undefined,
      },
      deviceName,
    );
  }

  /**
   * Sign in with Apple — verifies the identityToken against Apple's JWKS and
   * either links to an existing account or creates a new one.
   *
   * `fullName` and `email` are provided by the client on FIRST sign-in only;
   * Apple will not send them again. We persist them if the backing user is
   * freshly created.
   */
  async signInWithApple(input: {
    identityToken: string;
    fullName?: { givenName?: string; familyName?: string };
    email?: string;
    deviceName?: string;
  }): Promise<AuthResult> {
    const verified = await this.apple.verify(input.identityToken);
    // Prefer the token email (Apple-verified) over the client-sent one.
    const email = verified.email ?? input.email ?? undefined;
    return this.loginWithOAuth(
      'apple',
      verified.sub,
      {
        email,
        // Apple identityToken is only issued for verified Apple IDs, so any
        // email claim it carries is implicitly verified. The client-supplied
        // email (on first sign-in) is NOT trusted — we only fall back to it
        // when the token didn't include one.
        emailVerified: verified.email !== null && verified.email !== undefined,
        firstName: input.fullName?.givenName,
        lastName: input.fullName?.familyName,
      },
      input.deviceName,
    );
  }

  async register(dto: RegisterDto, ip?: string): Promise<AuthResult> {
    await this.enforceRegisterRateLimit(ip);

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, dto.phone ? { phone: dto.phone } : { email: '__none__' }] },
    });
    if (existing) throw new ConflictException('Email or phone already registered');

    const passwordHash = await this.password.hash(dto.password);
    const coords = geocode(dto.city, dto.countryCode);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: `${dto.firstName} ${dto.lastName}`.trim(),
        city: dto.city ?? null,
        countryCode: dto.countryCode ?? null,
        bio: dto.bio ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lon ?? null,
      },
    });

    // Fire & forget — email verification
    void this.sendVerificationEmail(user.id).catch((e) =>
      this.logger.warn(`Failed to send verification email: ${String(e)}`),
    );

    const issued = await this.tokens.issueTokens(user.id, user.role, user.identityStatus);
    return { user, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
  }

  // ── Email verification ─────────────────────────────────────

  async sendVerificationEmail(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.email) return;
    if (user.emailVerified) return;
    const token = await this.emailTokens.create(userId, 'verify_email');
    await this.mailer.sendEmailVerification(user.email, token, user.firstName);
  }

  async verifyEmail(token: string): Promise<{ ok: boolean; userId?: string }> {
    const userId = await this.emailTokens.consume(token, 'verify_email');
    if (!userId) return { ok: false };
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
    return { ok: true, userId };
  }

  // ── Password reset ─────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    // Equalise wall-clock time across hit/miss to defeat email enumeration via
    // timing — both branches do exactly one indexed findUnique before this
    // function resolves; token creation + SMTP run fire-and-forget.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.email) return;
    const userEmail = user.email;
    void (async () => {
      try {
        const token = await this.emailTokens.create(user.id, 'reset_password');
        await this.mailer.sendPasswordReset(userEmail, token, user.firstName);
      } catch (e) {
        this.logger.warn(`Failed to send password reset: ${String(e)}`);
      }
    })();
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.emailTokens.consume(token, 'reset_password');
    if (!userId) throw new BadRequestException('Invalid or expired reset token');

    const passwordHash = await this.password.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      // Revoke all existing refresh tokens — force re-login everywhere
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async login(dto: LoginDto, ip?: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) {
      await this.fakeVerify();
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'banned') throw new ForbiddenException('Account banned');
    if (user.status === 'suspended') throw new ForbiddenException('Account suspended');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(`Account locked until ${user.lockedUntil.toISOString()}`);
    }

    const ok = await this.password.verify(user.passwordHash, dto.password);
    if (!ok) {
      await this.registerFailedLogin(user.id, user.failedLoginCount);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip ?? null,
      },
    });

    const issued = await this.tokens.issueTokens(
      user.id,
      user.role,
      user.identityStatus,
      dto.deviceName,
    );
    return { user, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
  }

  async refresh(refreshToken: string, deviceName?: string): Promise<AuthResult> {
    const result = await this.tokens.rotateRefreshToken(refreshToken, deviceName);
    if (!result) throw new UnauthorizedException('Invalid or reused refresh token');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    return {
      user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    };
  }

  async logout(refreshToken: string, jti?: string, expSeconds?: number): Promise<void> {
    await this.tokens.revokeRefreshToken(refreshToken);
    if (jti && expSeconds) {
      const ttl = Math.max(0, expSeconds - Math.floor(Date.now() / 1000));
      if (ttl > 0) await this.redis.blacklistJwt(jti, ttl);
    }
  }

  async loginWithOAuth(
    provider: OAuthProvider,
    providerId: string,
    profile: {
      email?: string;
      emailVerified?: boolean;
      firstName?: string;
      lastName?: string;
      avatarUrl?: string;
    },
    deviceName?: string,
  ): Promise<AuthResult> {
    let user = await this.prisma.user.findFirst({
      where: { oauthProvider: provider, oauthProviderId: providerId },
    });

    // Account takeover guard: if we found no link by (provider, providerId), but
    // the email is already owned by a user, we MUST NOT silently attach the
    // OAuth identity. Two attack paths we close here:
    //   1. The existing account uses a password → linking would let an OAuth
    //      holder log in without ever proving password ownership.
    //   2. The existing account is already linked to a DIFFERENT provider →
    //      linking would grant dual-provider access and sidestep the first
    //      provider's security controls.
    // Only link automatically when (a) the email is OAuth-verified AND (b) the
    // account has no password AND no other provider yet — i.e. a stub account
    // created by another path, never hardened.
    if (!user && profile.email) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        const safeToLink =
          profile.emailVerified === true &&
          byEmail.passwordHash === null &&
          (byEmail.oauthProvider === null || byEmail.oauthProvider === provider);
        if (!safeToLink) {
          this.logger.warn(
            `Refused OAuth auto-link for provider=${provider} email=${profile.email} existingProvider=${byEmail.oauthProvider ?? 'none'} hasPassword=${byEmail.passwordHash !== null}`,
          );
          throw new ConflictException(
            'An account already exists for this email. Sign in with your password, then link your provider from settings.',
          );
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { oauthProvider: provider, oauthProviderId: providerId },
        });
      }
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email ?? null,
          oauthProvider: provider,
          oauthProviderId: providerId,
          firstName: profile.firstName ?? null,
          lastName: profile.lastName ?? null,
          displayName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null,
          avatarUrl: profile.avatarUrl ?? null,
          // Only trust the provider's verdict — don't mark verified just
          // because an email string was supplied.
          emailVerified: profile.emailVerified === true,
        },
      });
    }

    const issued = await this.tokens.issueTokens(user.id, user.role, user.identityStatus, deviceName);
    return { user, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async submitIdentity(userId: string, documentType: string, fileUrl: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.identityDocument.create({
        data: { userId, documentType, fileUrl, status: 'pending' },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { identityStatus: 'pending' },
      }),
    ]);
  }

  async getIdentityStatus(userId: string): Promise<{ status: string; latestSubmission: Date | null; rejectionReason: string | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        identityDocuments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const latest = user.identityDocuments[0];
    return {
      status: user.identityStatus,
      latestSubmission: latest?.createdAt ?? null,
      rejectionReason: latest?.rejectionReason ?? null,
    };
  }

  async reviewIdentity(
    reviewerId: string,
    targetUserId: string,
    decision: 'approved' | 'rejected',
    reason?: string,
  ): Promise<void> {
    const doc = await this.prisma.identityDocument.findFirst({
      where: { userId: targetUserId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!doc) throw new NotFoundException('No pending identity document');

    const now = new Date();
    const expiresAt = decision === 'approved' ? new Date(now.getTime() + 30 * 86_400_000) : null;

    await this.prisma.$transaction([
      this.prisma.identityDocument.update({
        where: { id: doc.id },
        data: {
          status: decision,
          reviewedById: reviewerId,
          reviewedAt: now,
          rejectionReason: decision === 'rejected' ? reason ?? null : null,
          expiresAt,
        },
      }),
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { identityStatus: decision },
      }),
    ]);
  }

  // ── helpers ────────────────────────────────────────────────

  private async fakeVerify(): Promise<void> {
    // Constant-time to avoid leaking email existence via timing
    await this.password.verify(
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'x',
    ).catch(() => false);
  }

  private async registerFailedLogin(userId: string, current: number): Promise<void> {
    const next = current + 1;
    let lockedUntil: Date | null = null;
    if (next >= MAX_FAILED_LOGINS) {
      const stageIndex = Math.min(
        Math.floor((next - MAX_FAILED_LOGINS) / MAX_FAILED_LOGINS),
        LOCK_STAGES_MS.length - 1,
      );
      const durationMs =
        LOCK_STAGES_MS[stageIndex] ?? LOCK_STAGES_MS[LOCK_STAGES_MS.length - 1] ?? 15 * 60_000;
      lockedUntil = new Date(Date.now() + durationMs);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: next, lockedUntil },
    });
  }

  private async enforceRegisterRateLimit(ip?: string): Promise<void> {
    if (!ip) return;
    if (process.env.NODE_ENV === 'test') return;
    const key = `ratelimit:register:${ip}`;
    const count = await this.redis.incrementCounter(key, 3600);
    if (count > 3) {
      throw new BadRequestException('Too many registrations from this IP. Try again later.');
    }
  }
}
