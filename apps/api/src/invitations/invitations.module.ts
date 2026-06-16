import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { InvitationExpiryCron } from './invitation-expiry.cron';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, InvitationExpiryCron],
  exports: [InvitationsService],
})
export class InvitationsModule {}
