import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EmailTokenType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

const TTL_MS: Record<EmailTokenType, number> = {
  reset_password: 60 * 60_000, // 1 hour
  verify_email: 24 * 60 * 60_000, // 24 hours
};

// A 6-digit code is low-entropy (1M combos) — cap guesses hard so it can't be
// brute-forced even with the 24h validity window. After this many wrong tries
// the whole token row is burned and the user must request a fresh code.
const MAX_CODE_ATTEMPTS = 6;

export type CodeOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'none' };

@Injectable()
export class EmailTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, type: EmailTokenType): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const hash = this.hash(raw);
    const expiresAt = new Date(Date.now() + TTL_MS[type]);

    // Invalidate any previous unused token of the same type for this user
    await this.prisma.emailToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.emailToken.create({
      data: { userId, type, tokenHash: hash, expiresAt },
    });

    return raw;
  }

  /**
   * Like {@link create} but ALSO mints a 6-digit numeric code stored alongside
   * the link token in the same row. The email shows the code (typed into the
   * app) and links the long token (web fallback) — both verify the same row.
   * Returns the raw link token + the plaintext code (shown once, never stored).
   */
  async createWithCode(
    userId: string,
    type: EmailTokenType,
  ): Promise<{ token: string; code: string }> {
    const raw = randomBytes(32).toString('base64url');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + TTL_MS[type]);

    await this.prisma.emailToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.emailToken.create({
      data: {
        userId,
        type,
        tokenHash: this.hash(raw),
        codeHash: this.hash(code),
        expiresAt,
      },
    });

    return { token: raw, code };
  }

  /**
   * Atomically verify + consume the token. Returns the userId if valid, null otherwise.
   */
  async consume(rawToken: string, type: EmailTokenType): Promise<string | null> {
    const hash = this.hash(rawToken);
    const record = await this.prisma.emailToken.findUnique({ where: { tokenHash: hash } });
    if (!record) return null;
    if (record.type !== type) return null;
    if (record.usedAt) return null;
    if (record.expiresAt < new Date()) return null;

    await this.prisma.emailToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record.userId;
  }

  /**
   * Verify a 6-digit code scoped to a known user (the caller is authenticated,
   * so we look up THIS user's active token row — codes are never globally
   * unique). Attempt-limited: each wrong guess increments a counter and the row
   * is burned past {@link MAX_CODE_ATTEMPTS}.
   */
  async consumeCode(userId: string, code: string, type: EmailTokenType): Promise<CodeOutcome> {
    const codeHash = this.hash(code);
    try {
      // Each guess runs in a Serializable transaction that locks the active row
      // FOR UPDATE. This serializes guesses so the attempt counter can't be
      // bypassed by firing requests concurrently (Postgres aborts the losing
      // tx with 40001, caught below). Without this, N parallel guesses would
      // all read attempts=N and each test a code "for free".
      return await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            Array<{ id: string; code_hash: string | null; attempts: number; expires_at: Date }>
          >`SELECT id, code_hash, attempts, expires_at
              FROM email_tokens
             WHERE user_id = ${userId}::uuid
               AND type = ${type}::"EmailTokenType"
               AND used_at IS NULL
               AND code_hash IS NOT NULL
             ORDER BY created_at DESC
             LIMIT 1
             FOR UPDATE`;
          const record = rows[0];
          if (!record) return { ok: false, reason: 'none' } as CodeOutcome;
          if (record.expires_at < new Date()) return { ok: false, reason: 'expired' };

          if (record.attempts >= MAX_CODE_ATTEMPTS) {
            await tx.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
            return { ok: false, reason: 'locked' };
          }

          if (!record.code_hash || !this.safeEqualHex(codeHash, record.code_hash)) {
            const attempts = record.attempts + 1;
            await tx.emailToken.update({
              where: { id: record.id },
              // Burn the row on the final allowed miss so it can't be retried.
              data: { attempts, usedAt: attempts >= MAX_CODE_ATTEMPTS ? new Date() : null },
            });
            return { ok: false, reason: attempts >= MAX_CODE_ATTEMPTS ? 'locked' : 'invalid' };
          }

          await tx.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
          return { ok: true, userId };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // Serialization failure (40001) → a concurrent guess won the row. Reject
      // this one without counting it (safe: fewer effective guesses, not more).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        return { ok: false, reason: 'invalid' };
      }
      throw e;
    }
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Constant-time compare of two hex digests of equal length. */
  private safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  }
}
