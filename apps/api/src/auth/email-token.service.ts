import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { EmailTokenType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

const TTL_MS: Record<EmailTokenType, number> = {
  reset_password: 60 * 60_000, // 1 hour
  verify_email: 24 * 60 * 60_000, // 24 hours
};

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

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
