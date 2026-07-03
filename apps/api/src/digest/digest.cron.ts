import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DigestService } from './digest.service';

const INTERVAL_MS = 60 * 60 * 1000; // hourly — same cadence as StoriesCron

/**
 * E-DIGEST cron — hourly, in-process (setInterval + unref), no external scheduler.
 * Mirrors StoriesCron: no-op in tests, best-effort at-most-once per member per
 * 7-day window (idempotence + kill-switch enforced inside DigestService).
 */
@Injectable()
export class DigestCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly digest: DigestService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const sent = await this.digest.processBatch();
      if (sent > 0) this.logger.log(`Weekly digest sent to ${sent} member(s)`);
    } catch (error) {
      this.logger.error('Digest batch failed', error as Error);
    }
  }
}
