import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { PostsService } from './posts.service';
import { LikesService } from './likes.service';
import { CommentsService } from './comments.service';
import { StoriesCron } from './stories.cron';

@Module({
  controllers: [FeedController],
  providers: [PostsService, LikesService, CommentsService, StoriesCron],
  exports: [PostsService, LikesService, CommentsService],
})
export class FeedModule {}
