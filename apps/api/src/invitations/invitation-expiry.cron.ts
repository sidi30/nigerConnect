import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

// Run every hour — the cron is for cleanliness and metrics, not correctness.
// Quota math (§3) already excludes expired-by-date rows, so this is a
// best-effort sweep to mark rows explicitly.
const INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class InvitationExpiryCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvitationExpiryCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // .unref() so the timer doesn't prevent the process from exiting cleanly
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const result = await this.prisma.invitation.updateMany({
        where: {
          status: 'pending',
          expiresAt: { lt: new Date() },
        },
        // Purge targetEmail on expiry — data-minimization: we must not retain a
        // third party's email beyond the life of the invitation (RGPD).
        data: { status: 'expired', targetEmail: null },
      });
      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} pending invitation(s), targetEmail purged.`);
      }
    } catch (error) {
      this.logger.error('Invitation expiry cron failed', error as Error);
    }
  }
}
