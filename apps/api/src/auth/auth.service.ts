import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { OAuthProvider, User } from '@prisma/client';
import type { Env } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { MailerService } from '../common/mail/mailer.service';
import {
  geocode,
  haversineKm,
  jitterCoord,
  resolveCityCentroid,
} from '../common/geo/city-coords';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { EmailTokenService } from './email-token.service';
import { GoogleOAuthService } from './google-oauth.service';
import { AppleVerifierService, sha256Hex } from './apple-verifier.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_STAGES_MS = [15 * 60_000, 30 * 60_000, 60 * 60_000];

// How far client-supplied coordinates may sit from the resolved city centroid
// before we distrust them. ~150 km comfortably covers large metros + the city's
// surrounding area while rejecting coordinates that clearly don't match the
// claimed city (spoofing or a stale autocomplete pick from another city).
const MAX_CLIENT_COORD_DISTANCE_KM = 150;

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
    private readonly config: ConfigService<Env, true>,
  ) {}

  async signInWithGoogle(
    idToken: string,
    deviceName?: string,
    nonce?: string,
  ): Promise<AuthResult> {
    const profile = await this.google.verifyIdToken(idToken, nonce);
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
    rawNonce?: string;
    deviceName?: string;
  }): Promise<AuthResult> {
    // Anti-replay: if the client generated a nonce, the token must carry
    // sha256(rawNonce) in its `nonce` claim. Verifier enforces only when set.
    const expectedNonce =
      input.rawNonce !== undefined ? sha256Hex(input.rawNonce) : undefined;
    const verified = await this.apple.verify(input.identityToken, expectedNonce);
    // Prefer the token email (Apple-verified) over the client-sent one.
    const email = verified.email ?? input.email ?? undefined;
    return this.loginWithOAuth(
      'apple',
      verified.sub,
      {
        email,
        // Trust ONLY the verifier's verdict, which now requires an explicit
        // `email_verified` claim in the token. A missing claim → not verified,
        // so the OAuth auto-link guard won't attach this identity to an existing
        // email. We only fall back to the token email here (never the
        // client-supplied one) and verification follows that token claim: if the
        // token carried no email, there is nothing to mark verified.
        emailVerified: verified.email !== null && verified.email === email && verified.emailVerified,
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

    // Prefer coordinates sent by the client (from the /geo/cities autocomplete)
    // so any world city gets a precise pin. Apply a small jitter so users in the
    // same city don't stack perfectly on top of each other on the map.
    //
    // The client value is NOT blindly trusted: if the city+country resolve to a
    // known centroid, the client coords must sit within MAX_CLIENT_COORD_DISTANCE
    // of it — otherwise (spoofed, or a stale pick from a different city) we drop
    // them and use the server geocode instead. Free-text cities with no resolvable
    // centroid still use the client coords (within WGS-84 range, validated by the
    // DTO) since there's nothing to cross-check against.
    let latitude: number | null;
    let longitude: number | null;
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      const centroid = resolveCityCentroid(dto.city, dto.countryCode);
      const clientCoord = { lat: dto.latitude, lon: dto.longitude };
      if (centroid && haversineKm(centroid, clientCoord) > MAX_CLIENT_COORD_DISTANCE_KM) {
        // Client coords don't match the claimed city — fall back to the server
        // geocode (jittered centroid) rather than trusting the client.
        const coords = geocode(dto.city, dto.countryCode);
        latitude = coords?.lat ?? null;
        longitude = coords?.lon ?? null;
      } else {
        const jittered = jitterCoord(clientCoord);
        latitude = jittered.lat;
        longitude = jittered.lon;
      }
    } else {
      const coords = geocode(dto.city, dto.countryCode);
      latitude = coords?.lat ?? null;
      longitude = coords?.lon ?? null;
    }

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
        latitude,
        longitude,
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
    // Mint a 6-digit code (typed into the app) + a long link token (web
    // fallback) — both verify the same row.
    const { token, code } = await this.emailTokens.createWithCode(userId, 'verify_email');
    // Catch delivery errors so neither register() nor the resend endpoint turn
    // a delivery problem into an HTTP 500 — the client cannot act on a relay
    // error. The failure is still logged (+ Sentry when configured).
    try {
      await this.mailer.sendEmailVerification(user.email, token, code, user.firstName);
    } catch (e) {
      this.logger.error(
        `Verification email delivery failed for user ${userId}: ${String(e)}`,
      );
    }
  }

  async verifyEmail(token: string): Promise<{ ok: boolean; userId?: string }> {
    const userId = await this.emailTokens.consume(token, 'verify_email');
    if (!userId) return { ok: false };
    // Conditional update so the welcome email fires exactly once: only the
    // transition false → true counts as "just verified".
    const res = await this.prisma.user.updateMany({
      where: { id: userId, emailVerified: false },
      data: { emailVerified: true },
    });
    if (res.count > 0) this.sendWelcomeEmail(userId);
    return { ok: true, userId };
  }

  /**
   * Verify the 6-digit code the user typed into the app. Scoped to the
   * authenticated user. Throws BadRequest on a wrong/expired/locked code so the
   * client can surface a precise message.
   */
  async verifyEmailCode(userId: string, code: string): Promise<{ ok: true }> {
    const outcome = await this.emailTokens.consumeCode(userId, code, 'verify_email');
    if (!outcome.ok) {
      const message =
        outcome.reason === 'locked'
          ? 'Trop de tentatives. Demande un nouveau code.'
          : outcome.reason === 'expired'
            ? 'Code expiré. Demande un nouveau code.'
            : outcome.reason === 'none'
              ? 'Aucun code en attente. Demande un nouveau code.'
              : 'Code invalide.';
      throw new BadRequestException(message);
    }
    const res = await this.prisma.user.updateMany({
      where: { id: outcome.userId, emailVerified: false },
      data: { emailVerified: true },
    });
    if (res.count > 0) this.sendWelcomeEmail(outcome.userId);
    return { ok: true };
  }

  /**
   * Fire-and-forget welcome email, sent once right after email verification.
   * Never throws into the verify flow — a mail failure must not fail the
   * activation that already succeeded.
   */
  private sendWelcomeEmail(userId: string): void {
    void (async () => {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true },
        });
        if (!user?.email) return;
        await this.mailer.sendWelcome(user.email, user.firstName);
      } catch (e) {
        this.logger.warn(`Failed to send welcome email: ${String(e)}`);
      }
    })();
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
          // Don't log the raw email (PII). A short SHA-256 prefix keeps the line
          // correlatable across attempts without exposing the address.
          const emailHash = createHash('sha256').update(profile.email).digest('hex').slice(0, 12);
          this.logger.warn(
            `Refused OAuth auto-link for provider=${provider} emailHash=${emailHash} existingProvider=${byEmail.oauthProvider ?? 'none'} hasPassword=${byEmail.passwordHash !== null}`,
          );
          throw new ConflictException(
            'An account already exists for this email. Sign in with your password, then link your provider from settings.',
          );
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          // safeToLink already required profile.emailVerified === true, so the
          // provider has verified this address → mark the linked account verified
          // (otherwise it'd stay gated/off-map despite a verified OAuth identity).
          data: { oauthProvider: provider, oauthProviderId: providerId, emailVerified: true },
        });
      }
    }

    let createdNow = false;
    if (!user) {
      // Concurrent first-sign-ins for the same (provider, providerId) both reach
      // here after seeing `findFirst` return null. The @@unique constraint makes
      // the loser's create fail with P2002 — we catch it and re-read the winning
      // row instead of minting a duplicate (upsert-style idempotency). The email
      // auto-link guard above already ran, so we never silently take over an
      // account on this path.
      try {
        user = await this.prisma.user.create({
          data: {
            email: profile.email ?? null,
            oauthProvider: provider,
            oauthProviderId: providerId,
            firstName: profile.firstName ?? null,
            lastName: profile.lastName ?? null,
            displayName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null,
            avatarUrl: profile.avatarUrl ?? null,
            // OAuth signup = the provider already authenticated the user and owns
            // the address (Google rejects unverified upstream; Apple proves
            // account ownership). Treat the account as email-verified so the user
            // isn't stuck behind the verification gate / hidden from the map.
            // Profile completion (city/country) is collected by the client in a
            // follow-up onboarding step.
            emailVerified: true,
          },
        });
        createdNow = true;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          user = await this.prisma.user.findFirst({
            where: { oauthProvider: provider, oauthProviderId: providerId },
          });
          if (!user) throw e;
        } else {
          throw e;
        }
      }
    }

    // Welcome email on first OAuth account creation — same as a normal signup.
    if (createdNow) this.sendWelcomeEmail(user.id);

    const issued = await this.tokens.issueTokens(user.id, user.role, user.identityStatus, deviceName);
    return { user, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async submitIdentity(userId: string, documentType: string, fileUrl: string): Promise<void> {
    // Identity docs live in the PRIVATE bucket. The presign step returns an
    // `s3://<privateBucket>/<key>` pointer; we must never persist a free-form
    // client URL (stored SSRF — a moderator's presign-download would later be
    // pointed at an attacker-chosen object). Accept only our own private
    // pointer, scoped to this user's identity folder.
    const validatedPointer = this.validatePrivateIdentityPointer(userId, fileUrl);
    await this.prisma.$transaction([
      this.prisma.identityDocument.create({
        data: { userId, documentType, fileUrl: validatedPointer, status: 'pending' },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { identityStatus: 'pending' },
      }),
    ]);
  }

  /**
   * Validate a client-supplied identity file pointer. Must be exactly an
   * `s3://<S3_PRIVATE_BUCKET>/<key>` URL whose key lives under
   * `users/<userId>/identity/`. Anything else (foreign host, public bucket,
   * another user's folder, path traversal) is rejected.
   */
  private validatePrivateIdentityPointer(userId: string, fileUrl: string): string {
    const privateBucket = this.config.get('S3_PRIVATE_BUCKET', { infer: true });
    const prefix = `s3://${privateBucket}/`;
    if (typeof fileUrl !== 'string' || !fileUrl.startsWith(prefix)) {
      throw new BadRequestException('Identity file must be uploaded via the identity presign');
    }
    const key = fileUrl.slice(prefix.length).split(/[?#]/)[0] ?? '';
    const expectedKeyPrefix = `users/${userId}/identity/`;
    if (
      !key.startsWith(expectedKeyPrefix) ||
      key.includes('..') ||
      key.includes('//') ||
      key.length <= expectedKeyPrefix.length
    ) {
      throw new BadRequestException('Identity file does not belong to you');
    }
    return fileUrl;
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

    // Tell the user the good news (fire-and-forget — a mail failure must not
    // fail the review that already committed). Only on approval.
    if (decision === 'approved') this.sendIdentityApprovedEmail(targetUserId);
  }

  /**
   * Notify a user their identity was verified. Fire-and-forget, never throws
   * into the review flow.
   */
  private sendIdentityApprovedEmail(userId: string): void {
    void (async () => {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true },
        });
        if (!user?.email) return;
        await this.mailer.sendIdentityApproved(user.email, user.firstName);
      } catch (e) {
        this.logger.warn(`Failed to send identity-approved email: ${String(e)}`);
      }
    })();
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
