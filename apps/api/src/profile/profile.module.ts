import { Module } from '@nestjs/common';
import { AssociationModule } from '../association/association.module';
import { ProfileController } from './profile.controller';
import { ProfileReminderCron } from './profile-reminder.cron';
import { ProfileReminderService } from './profile-reminder.service';
import { ProfileService } from './profile.service';

@Module({
  // AssociationModule exports AssociationService — deleteAccount reassigns (or
  // dissolves) any association this user was the last admin/owner of BEFORE
  // the cascading delete removes their membership row (A2).
  imports: [AssociationModule],
  controllers: [ProfileController],
  providers: [ProfileService, ProfileReminderService, ProfileReminderCron],
  exports: [ProfileService],
})
export class ProfileModule {}
