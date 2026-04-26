import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PushService } from './push.service';

@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, PushService],
  exports: [NotificationService, PushService],
})
export class NotificationModule {}
