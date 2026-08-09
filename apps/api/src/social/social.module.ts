import { Global, Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { FriendsService } from './friends.service';
import { BlockService } from './block.service';
import { DiasporaPolicyService } from './diaspora-policy.service';

@Global()
@Module({
  controllers: [SocialController],
  providers: [FriendsService, BlockService, DiasporaPolicyService],
  exports: [FriendsService, BlockService, DiasporaPolicyService],
})
export class SocialModule {}
