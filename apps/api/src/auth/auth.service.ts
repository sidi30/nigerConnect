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
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
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
  ) {}

  async register(dto: RegisterDto, ip?: string): Promise<AuthResult> {
    await this.enforceRegisterRateLimit(ip);

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, dto.phone ? { phone: dto.phone } : { email: '__none__' }] },
    });
    if (existing) throw new ConflictException('Email or phone already registered');

    const passwordHash = await this.password.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: `${dto.firstName} ${dto.lastName}`.trim(),
      },
    });

    const issued = await this.tokens.issueTokens(user.id, user.role, user.identityStatus);
    return { user, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
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
    profile: { email?: string; firstName?: string; lastName?: string; avatarUrl?: string },
    deviceName?: string,
  ): Promise<AuthResult> {
    let user = await this.prisma.user.findFirst({
      where: { oauthProvider: provider, oauthProviderId: providerId },
    });

    if (!user && profile.email) {
      user = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
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
          emailVerified: Boolean(profile.email),
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
