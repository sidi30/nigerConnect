import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';

const INTERVAL_MS = 60 * 60 * 1000; // every hour

/**
 * GDPR / spec compliance:
 * Identity documents are kept 30 days after approval/rejection, then deleted
 * from S3 AND the database row is hard-deleted.
 * The user's identityStatus is preserved on the user table.
 */
@Injectable()
export class IdentityCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityCleanupCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const expired = await this.prisma.identityDocument.findMany({
        where: {
          expiresAt: { lt: new Date() },
          status: { in: ['approved', 'rejected'] },
        },
        select: { id: true, fileUrl: true },
      });
      if (expired.length === 0) return;

      for (const doc of expired) {
        // Best-effort S3 delete — extract key from URL
        const key = this.extractKey(doc.fileUrl);
        if (key) await this.s3.deleteObject(key);
      }
      const deleted = await this.prisma.identityDocument.deleteMany({
        where: { id: { in: expired.map((d) => d.id) } },
      });
      this.logger.log(`🧹 Deleted ${deleted.count} expired identity documents (GDPR cleanup)`);
    } catch (error) {
      this.logger.error('Identity cleanup failed', error as Error);
    }
  }

  private extractKey(url: string): string | null {
    // Expected format: s3://bucket/key or https://cdn.example/key
    try {
      if (url.startsWith('s3://')) {
        const parts = url.replace('s3://', '').split('/');
        return parts.slice(1).join('/');
      }
      const parsed = new URL(url);
      return parsed.pathname.replace(/^\//, '');
    } catch {
      return null;
    }
  }
}
