import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

// AdminAuditService comes from the @Global() AuditModule — no import needed.
@Module({
  imports: [NotificationModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
