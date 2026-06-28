import { Module } from '@nestjs/common';
import { StorageModule } from '../common/storage/storage.module';
import { ProfileModule } from '../profile/profile.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  // ProfileModule exports ProfileService — reused for the cascading account
  // delete (DB + S3) so admin deletion and self-service deletion stay identical.
  imports: [StorageModule, ProfileModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
