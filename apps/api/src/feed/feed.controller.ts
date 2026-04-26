import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PostsService } from './posts.service';
import { LikesService } from './likes.service';
import { CommentsService } from './comments.service';
import {
  createCommentSchema,
  createPostSchema,
  createStorySchema,
  feedQuerySchema,
  updatePostSchema,
  type CreateCommentDto,
  type CreatePostDto,
  type CreateStoryDto,
  type FeedQueryDto,
  type UpdatePostDto,
} from './dto/post.dto';

@Controller()
export class FeedController {
  constructor(
    private readonly posts: PostsService,
    private readonly likes: LikesService,
    private readonly comments: CommentsService,
  ) {}

  @Post('posts')
  createPost(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createPostSchema)) dto: CreatePostDto,
  ) {
    return this.posts.create(me.sub, dto);
  }

  @Get('posts/:id')
  getPost(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.posts.getById(me.sub, id);
  }

  @Patch('posts/:id')
  updatePost(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updatePostSchema)) dto: UpdatePostDto,
  ) {
    return this.posts.update(me.sub, id, dto);
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePost(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.posts.softDelete(me.sub, id);
  }

  @Get('feed')
  getFeed(
    @CurrentUser() me: JwtUserPayload,
    @Query(new ZodValidationPipe(feedQuerySchema)) query: FeedQueryDto,
  ) {
    return this.posts.getFeed(me.sub, query.cursor, query.limit);
  }

  @Get('users/:userId/posts')
  getUserPosts(
    @CurrentUser() me: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(50, Math.max(1, Number(limit))) : 20;
    return this.posts.getUserPosts(me.sub, userId, cursor, lim);
  }

  @Post('posts/:id/like')
  like(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.likes.toggleLike(me.sub, id);
  }

  @Get('posts/:id/likes')
  listLikers(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 30;
    return this.likes.listLikers(id, cursor, lim);
  }

  @Post('posts/:id/comments')
  comment(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(createCommentSchema)) dto: CreateCommentDto,
  ) {
    return this.comments.create(me.sub, id, dto.content, dto.parentId);
  }

  @Get('posts/:id/comments')
  listComments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(50, Math.max(1, Number(limit))) : 20;
    return this.comments.list(id, cursor, lim);
  }

  @Patch('comments/:id')
  editComment(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(createCommentSchema.pick({ content: true }))) dto: { content: string },
  ) {
    return this.comments.edit(me.sub, id, dto.content);
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.comments.softDelete(me.sub, id);
  }

  @Post('posts/:id/share')
  share(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body('content') content?: string,
  ) {
    return this.posts.share(me.sub, id, content);
  }

  // ── Stories ────────────────────────────────────────────────
  @Post('stories')
  createStory(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createStorySchema)) dto: CreateStoryDto,
  ) {
    return this.posts.createStory(me.sub, dto);
  }

  @Get('stories/feed')
  storiesFeed(@CurrentUser() me: JwtUserPayload) {
    return this.posts.getStoriesFeed(me.sub);
  }

  @Delete('stories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStory(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.posts.deleteStory(me.sub, id);
  }
}
