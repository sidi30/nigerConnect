import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import { PrismaService } from '../common/prisma/prisma.service';
import { MfaSecretService } from './mfa-secret.service';

const ISSUER = 'NigerConnect';
const RECOVERY_CODE_COUNT = 10;

/**
 * TOTP (Google Authenticator / Authy / 1Password compatible) MFA.
 *
 * Enrollment is two steps so a user can't lock themselves out with a bad scan:
 *   1. `beginEnrollment` generates + stores (encrypted) a secret, mfaEnabled stays false.
 *   2. `confirmEnrollment` verifies a live code, flips mfaEnabled, and returns
 *      one-time recovery codes (shown once, stored hashed).
 *
 * Login verification accepts EITHER a 6-digit TOTP code OR a single-use recovery
 * code. The TOTP secret at rest is AES-256-GCM encrypted by MfaSecretService.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: MfaSecretService,
  ) {
    // Tolerate ±1 time-step (±30s) clock drift between server and phone.
    authenticator.options = { window: 1 };
  }

  /** Step 1 — generate a secret + otpauth URL for the authenticator app/QR. */
  async beginEnrollment(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, email: true },
    });
    if (user?.mfaEnabled) {
      throw new ConflictException('La double authentification est déjà activée.');
    }
    const secret = authenticator.generateSecret();
    // Stored encrypted; mfaEnabled stays false until confirmEnrollment succeeds.
    await this.secrets.set(userId, secret);
    // Label shown in the authenticator app (account name @ issuer).
    const accountName = user?.email ?? userId;
    const otpauthUrl = authenticator.keyuri(accountName, ISSUER, secret);
    return { secret, otpauthUrl };
  }

  /** Step 2 — verify a live code, enable MFA, return one-time recovery codes. */
  async confirmEnrollment(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    });
    if (user?.mfaEnabled) {
      throw new ConflictException('La double authentification est déjà activée.');
    }
    const secret = await this.secrets.get(userId);
    if (!secret) {
      throw new BadRequestException("Aucun enrôlement en cours. Recommence l'activation.");
    }
    if (!this.verifyTotp(code, secret)) {
      throw new BadRequestException('Code incorrect. Vérifie ton application.');
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => this.generateRecoveryCode());
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } }),
      // Drop any stale codes from a previous enrollment, then store the fresh set hashed.
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: this.hash(this.normalize(c)) })),
      }),
    ]);
    return { recoveryCodes: codes };
  }

  /** Turn MFA off — requires a valid TOTP or recovery code. Wipes secret + codes. */
  async disable(userId: string, code: string): Promise<void> {
    const ok = await this.verifyForUser(userId, code);
    if (!ok) throw new BadRequestException('Code incorrect.');
    await this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } });
    await this.secrets.clear(userId); // sets mfaSecret = null, mfaEnabled = false
  }

  async status(userId: string): Promise<{ mfaEnabled: boolean }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    });
    return { mfaEnabled: !!u?.mfaEnabled };
  }

  /**
   * Verify a login challenge: accepts a 6-digit TOTP code OR consumes a single-use
   * recovery code. Returns true on success. Recovery codes are marked used.
   */
  async verifyForUser(userId: string, code: string): Promise<boolean> {
    const cleaned = (code ?? '').trim();
    // TOTP path (6 digits).
    if (/^\d{6}$/.test(cleaned)) {
      const secret = await this.secrets.get(userId);
      if (secret && this.verifyTotp(cleaned, secret)) return true;
    }
    // Recovery-code path (normalized, case/format-insensitive, single use).
    const hash = this.hash(this.normalize(cleaned));
    const rec = await this.prisma.mfaRecoveryCode.findFirst({
      where: { userId, codeHash: hash, usedAt: null },
      select: { id: true },
    });
    if (rec) {
      await this.prisma.mfaRecoveryCode.update({
        where: { id: rec.id },
        data: { usedAt: new Date() },
      });
      return true;
    }
    return false;
  }

  private verifyTotp(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token: token.trim(), secret });
    } catch {
      return false;
    }
  }

  /** A grouped 10-char code, e.g. "A1B2C-D3E4F". Ambiguity-prone chars avoided. */
  private generateRecoveryCode(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I,L,O,0,1
    let out = '';
    const bytes = randomBytes(10);
    for (let i = 0; i < 10; i++) out += alphabet[bytes[i]! % alphabet.length];
    return `${out.slice(0, 5)}-${out.slice(5)}`;
  }

  /** Strip separators/spaces + uppercase so a recovery code matches regardless of formatting. */
  private normalize(code: string): string {
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  private hash(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }
}
