import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { FeedModule } from '../feed/feed.module';
import { SocialModule } from '../social/social.module';
import { AnimationAdminController } from './animation.admin.controller';
import { AnimationChatService } from './animation-chat.service';
import { AnimationEngagementService } from './animation-engagement.service';
import { AnimationWriterService } from './animation-writer.service';
import { AnimationCron } from './animation.cron';
import { AnimationService } from './animation.service';

/**
 * Animation éditoriale. Comme le compte officiel, ce module ne réécrit pas la
 * publication : il passe par PostsService, donc il hérite du binding S3, de
 * l'invalidation du cache de fil et des mentions, au lieu de dupliquer des
 * écritures Prisma qui rateraient tout ça.
 */
@Module({
  imports: [AuthModule, ChatModule, FeedModule, SocialModule],
  controllers: [AnimationAdminController],
  providers: [
    AnimationService,
    AnimationChatService,
    AnimationEngagementService,
    AnimationWriterService,
    AnimationCron,
  ],
  exports: [
    AnimationService,
    AnimationChatService,
    AnimationEngagementService,
    AnimationWriterService,
  ],
})
export class AnimationModule {}
