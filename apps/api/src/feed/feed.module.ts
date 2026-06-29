import { Module } from '@nestjs/common';
import { StorageModule } from '../common/storage/storage.module';
import { FeedController } from './feed.controller';
import { PostsService } from './posts.service';
import { LikesService } from './likes.service';
import { CommentsService } from './comments.service';
import { MentionsService } from './mentions.service';
import { StoriesCron } from './stories.cron';

@Module({
  imports: [StorageModule],
  controllers: [FeedController],
  providers: [PostsService, LikesService, CommentsService, MentionsService, StoriesCron],
  exports: [PostsService, LikesService, CommentsService],
})
export class FeedModule {}
