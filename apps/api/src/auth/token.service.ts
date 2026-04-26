import { randomBytes, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { UserRole, IdentityStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { Env } from '../common/config/env.validation';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  identityStatus: IdentityStatus;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresAt: Date;
}

/**
 * Derives a short, deterministic key identifier from a PEM public key.
 * Used as the `kid` header so we can route verification to the right key
 * during a rotation window.
 */
function deriveKid(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly kid: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessExpires: string;
  private readonly refreshTtlMs: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {
    const privPath = config.get('JWT_PRIVATE_KEY_PATH', { infer: true });
    const pubPath = config.get('JWT_PUBLIC_KEY_PATH', { infer: true });
    if (!privPath || !pubPath) {
      throw new Error('JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH are required');
    }
    this.privateKey = readFileSync(privPath, 'utf8');
    this.publicKey = readFileSync(pubPath, 'utf8');
    this.kid = deriveKid(this.publicKey);
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.audience = config.get('JWT_AUDIENCE', { infer: true });
    this.accessExpires = config.get('JWT_ACCESS_EXPIRES', { infer: true });
    this.refreshTtlMs = this.parseDuration(config.get('JWT_REFRESH_EXPIRES', { infer: true }));
    this.logger.log(`JWT signing ready (kid=${this.kid}, iss=${this.issuer}, aud=${this.audience})`);
  }

  /**
   * Current public key — used by the Jwt strategy to verify access tokens.
   * Exposed as a record keyed by `kid` so the strategy can rotate keys
   * without a redeploy (see JwtStrategy for details).
   */
  get jwtPublicKey(): string {
    return this.publicKey;
  }

  get jwtKid(): string {
    return this.kid;
  }

  get jwtIssuer(): string {
    return this.issuer;
  }

  get jwtAudience(): string {
    return this.audience;
  }

  async issueTokens(
    userId: string,
    role: UserRole,
    identityStatus: IdentityStatus,
    deviceName?: string,
  ): Promise<IssuedTokens> {
    const jti = randomBytes(16).toString('hex');
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role, identityStatus, jti },
      {
        algorithm: 'RS256',
        privateKey: this.privateKey,
        expiresIn: this.accessExpires,
        issuer: this.issuer,
        audience: this.audience,
        keyid: this.kid,
      },
    );
    const refreshRaw = randomBytes(48).toString('base64url');
    const refreshHash = this.hashToken(refreshRaw);
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshHash,
        deviceName: deviceName ?? null,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshRaw,
      accessExpiresIn: this.parseDuration(this.accessExpires) / 1000,
      refreshExpiresAt: expiresAt,
    };
  }

  /**
   * Rotation policy: token can only be used once.
   * If already used (usedAt set) → reuse detected → revoke ALL user tokens.
   */
  async rotateRefreshToken(
    refreshRaw: string,
    deviceName?: string,
  ): Promise<{ userId: string; role: UserRole; identityStatus: IdentityStatus; tokens: IssuedTokens } | null> {
    const hash = this.hashToken(refreshRaw);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt < new Date()) return null;

    if (record.usedAt) {
      this.logger.warn(`Refresh token reuse detected for user ${record.userId} — revoking all`);
      await this.revokeAllUserTokens(record.userId);
      return null;
    }

    const now = new Date();
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    });

    const tokens = await this.issueTokens(
      record.userId,
      record.user.role,
      record.user.identityStatus,
      deviceName ?? record.deviceName ?? undefined,
    );
    return {
      userId: record.userId,
      role: record.user.role,
      identityStatus: record.user.identityStatus,
      tokens,
    };
  }

  async revokeRefreshToken(refreshRaw: string): Promise<void> {
    const hash = this.hashToken(refreshRaw);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDuration(d: string): number {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(d);
    if (!match) throw new Error(`Invalid duration: ${d}`);
    const n = Number(match[1]);
    const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
    const mul: Record<'ms' | 's' | 'm' | 'h' | 'd', number> = {
      ms: 1,
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return n * mul[unit];
  }
}

export { deriveKid };
