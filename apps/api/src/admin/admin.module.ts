import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../common/storage/storage.module';
import { ProfileModule } from '../profile/profile.module';
import { AdminController } from './admin.controller';
import { AdminMapController } from './admin-map.controller';
import { AdminMapService } from './admin-map.service';
import { AdminService } from './admin.service';

@Module({
  // ProfileModule exports ProfileService — reused for the cascading account
  // delete (DB + S3) so admin deletion and self-service deletion stay identical.
  // AuthModule exports MfaService — the members map verifies the admin's own TOTP
  // before opening the break-glass GPS window (same verifier as login, no second
  // implementation to keep in sync).
  imports: [StorageModule, ProfileModule, AuthModule],
  controllers: [AdminController, AdminMapController],
  providers: [AdminService, AdminMapService],
})
export class AdminModule {}
