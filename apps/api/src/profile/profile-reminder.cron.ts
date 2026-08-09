import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ProfileReminderService } from './profile-reminder.service';

const INTERVAL_MS = 60 * 60 * 1000; // hourly — same cadence as DigestCron

/**
 * P-REMINDER cron — hourly, in-process (setInterval + unref), no external
 * scheduler. Mirrors DigestCron: no-op in tests, at-most-once per member
 * (idempotence + kill-switch enforced inside ProfileReminderService).
 */
@Injectable()
export class ProfileReminderCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfileReminderCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly reminder: ProfileReminderService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const sent = await this.reminder.processBatch();
      if (sent > 0) this.logger.log(`Profile-completion reminder sent to ${sent} member(s)`);
    } catch (error) {
      this.logger.error('Profile reminder batch failed', error as Error);
    }
  }
}
