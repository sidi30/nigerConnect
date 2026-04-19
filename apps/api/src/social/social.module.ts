import { Global, Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { FriendsService } from './friends.service';
import { BlockService } from './block.service';

@Global()
@Module({
  controllers: [SocialController],
  providers: [FriendsService, BlockService],
  exports: [FriendsService, BlockService],
})
export class SocialModule {}
