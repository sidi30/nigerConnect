import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlockService } from '../social/block.service';
import { NotificationService } from '../notification/notification.service';
import { PostsService } from './posts.service';

const AUTHOR_SELECT = {
  id: true,
  displayName: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
} as const;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlockService,
    private readonly notifications: NotificationService,
    private readonly posts: PostsService,
  ) {}

  async create(userId: string, postId: string, content: string, parentId?: string) {
    // Visibility gate first — anything weaker (just blocks) lets a user
    // comment on a friends-only post by a non-friend, which simultaneously
    // confirms the post exists AND inserts the commenter into the author's
    // notifications.
    const post = await this.posts.assertCanViewPost(userId, postId);

    if (parentId) {
      const parent = await this.prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, postId: true, parentId: true },
      });
      if (!parent || parent.postId !== postId) {
        throw new NotFoundException('Parent comment not found');
      }
      // Allow up to 3 levels of nesting (root → reply → reply-to-reply). Walk
      // the parent's ancestor chain: the parent must be at depth ≤ 2 so the new
      // reply lands at depth ≤ 3.
      let parentDepth = 1;
      let ancestorId = parent.parentId;
      while (ancestorId) {
        parentDepth++;
        const ancestor = await this.prisma.comment.findUnique({
          where: { id: ancestorId },
          select: { parentId: true },
        });
        ancestorId = ancestor?.parentId ?? null;
      }
      if (parentDepth >= 3) {
        throw new BadRequestException('Maximum 3 niveaux de réponses');
      }
    }

    const [comment] = await this.prisma.$transaction([
      this.prisma.comment.create({
        data: { postId, authorId: userId, content, parentId: parentId ?? null },
        include: { author: { select: AUTHOR_SELECT } },
      }),
      this.prisma.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      }),
    ]);

    // Notify post author (and parent comment author if reply) — skip self-notifications
    const commenter = comment.author;
    const commenterName =
      commenter.displayName || commenter.firstName || 'Un membre';

    if (post.authorId !== userId) {
      await this.notifications.create({
        userId: post.authorId,
        actorId: userId,
        type: 'comment',
        title: `${commenterName} a commenté votre publication`,
        body: content.slice(0, 140),
        data: { postId, commentId: comment.id },
      });
    }
    if (parentId) {
      const parentAuthorRow = await this.prisma.comment.findUnique({
        where: { id: parentId },
        select: { authorId: true },
      });
      if (parentAuthorRow && parentAuthorRow.authorId !== userId && parentAuthorRow.authorId !== post.authorId) {
        await this.notifications.create({
          userId: parentAuthorRow.authorId,
          actorId: userId,
          type: 'comment',
          title: `${commenterName} a répondu à votre commentaire`,
          body: content.slice(0, 140),
          data: { postId, commentId: comment.id, parentId },
        });
      }
    }

    await this.posts.invalidateFeedCache(post.authorId);
    if (userId !== post.authorId) {
      await this.posts.invalidateFeedForUsers([userId]);
    }
    return comment;
  }

  async list(viewerId: string, postId: string, cursor?: string, limit = 20) {
    // Same visibility gate as viewing the post itself: you must be allowed
    // to see the post to read its comments, otherwise comments leak content
    // through the side channel.
    await this.posts.assertCanViewPost(viewerId, postId);
    const roots = await this.prisma.comment.findMany({
      where: { postId, parentId: null, deletedAt: null },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: AUTHOR_SELECT },
        // Level 2 replies, each with their level 3 replies nested (3 levels total).
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: AUTHOR_SELECT },
            replies: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
              include: { author: { select: AUTHOR_SELECT } },
            },
          },
        },
      },
    });
    const hasMore = roots.length > limit;
    const items = hasMore ? roots.slice(0, limit) : roots;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async edit(userId: string, commentId: string, content: string) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c || c.deletedAt) throw new NotFoundException('Comment not found');
    if (c.authorId !== userId) throw new ForbiddenException('Not your comment');
    // 15-minute edit window — avoids rewriting history on already-read replies.
    if (Date.now() - c.createdAt.getTime() > 15 * 60 * 1000) {
      throw new ForbiddenException('Edit window expired (15min)');
    }
    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: { author: { select: AUTHOR_SELECT } },
    });
  }

  async softDelete(userId: string, commentId: string): Promise<void> {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c || c.deletedAt) throw new NotFoundException('Comment not found');
    if (c.authorId !== userId) throw new ForbiddenException('Not your comment');

    // Cascade: deleting a comment removes its nested replies too (max 3 levels),
    // otherwise live children would be orphaned (their root is filtered out of
    // `list`) and commentCount would drift. Collect the whole live subtree.
    const lvl2 = await this.prisma.comment.findMany({
      where: { parentId: commentId, deletedAt: null },
      select: { id: true },
    });
    const lvl2Ids = lvl2.map((r) => r.id);
    const lvl3Ids = lvl2Ids.length
      ? (
          await this.prisma.comment.findMany({
            where: { parentId: { in: lvl2Ids }, deletedAt: null },
            select: { id: true },
          })
        ).map((r) => r.id)
      : [];
    const allIds = [commentId, ...lvl2Ids, ...lvl3Ids];

    const [, updatedPost] = await this.prisma.$transaction([
      this.prisma.comment.updateMany({
        where: { id: { in: allIds }, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      this.prisma.post.update({
        where: { id: c.postId },
        data: { commentCount: { decrement: allIds.length } },
        select: { authorId: true },
      }),
    ]);
    await this.posts.invalidateFeedCache(updatedPost.authorId);
    if (userId !== updatedPost.authorId) {
      await this.posts.invalidateFeedForUsers([userId]);
    }
  }
}
