import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileReminderCron } from './profile-reminder.cron';
import { ProfileReminderService } from './profile-reminder.service';
import { ProfileService } from './profile.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, ProfileReminderService, ProfileReminderCron],
  exports: [ProfileService],
})
export class ProfileModule {}
