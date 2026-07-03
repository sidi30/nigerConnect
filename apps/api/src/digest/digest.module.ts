import { Module } from '@nestjs/common';
import { DigestService } from './digest.service';
import { DigestCron } from './digest.cron';

/**
 * E-DIGEST — weekly regional retention digest.
 * PrismaModule, NotificationModule and SettingsModule are all @Global, so no
 * explicit imports are needed here.
 */
@Module({
  providers: [DigestService, DigestCron],
  exports: [DigestService],
})
export class DigestModule {}
