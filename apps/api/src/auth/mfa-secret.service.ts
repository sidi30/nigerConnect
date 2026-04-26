import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * Thin wrapper around the `users.mfa_secret` column that guarantees the
 * value at rest is always AES-256-GCM encrypted.
 *
 * Usage when wiring MFA:
 *   - call `set(userId, base32Secret)` after generating a TOTP seed
 *   - call `get(userId)` during `/auth/mfa/verify` to compare the OTP
 *   - call `clear(userId)` when the user disables MFA
 *
 * Legacy plaintext values (pre-migration) are still accepted transparently;
 * they'll be re-encrypted on the next write.
 */
@Injectable()
export class MfaSecretService {
  private readonly logger = new Logger(MfaSecretService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async set(userId: string, plaintextSecret: string): Promise<void> {
    const ciphertext = this.crypto.encrypt(plaintextSecret);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: ciphertext },
    });
  }

  async get(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });
    if (!row?.mfaSecret) return null;
    if (!this.crypto.isEncrypted(row.mfaSecret)) {
      this.logger.warn(
        `mfa_secret for user ${userId} is plaintext — will be re-encrypted on next write`,
      );
      return row.mfaSecret;
    }
    try {
      return this.crypto.decrypt(row.mfaSecret);
    } catch (error) {
      this.logger.error(`Failed to decrypt mfa_secret for user ${userId}: ${String(error)}`);
      return null;
    }
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabled: false },
    });
  }
}
