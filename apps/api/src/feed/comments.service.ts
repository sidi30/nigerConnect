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
import { MentionsService } from './mentions.service';

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
    private readonly mentions: MentionsService,
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
      // Bounded walk: stop as soon as we know the parent is at depth ≥ 3.
      // Beyond rejecting deep replies, the cap also guarantees termination if
      // a corrupted ancestor cycle ever exists in the data — an unbounded walk
      // would otherwise loop forever.
      while (ancestorId && parentDepth < 3) {
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

    // Ping any friends @mentioned in the comment (deduped against the author/
    // parent-author notifications above is not needed — they get a 'comment'
    // notif, mentioned friends get a distinct 'mention' one).
    await this.mentions
      .notify({
        authorId: userId,
        authorName: commenterName,
        content,
        preview: 'vous a mentionné dans un commentaire',
        data: { postId, commentId: comment.id, ...(parentId ? { parentId } : {}) },
      })
      .catch(() => undefined);

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

    // Annotate every comment in the (≤3-level) tree with isLikedByMe in a single
    // query: collect all ids, fetch the viewer's likes, then map onto the tree.
    const ids: string[] = [];
    for (const root of items) {
      ids.push(root.id);
      for (const lvl2 of root.replies) {
        ids.push(lvl2.id);
        for (const lvl3 of lvl2.replies) ids.push(lvl3.id);
      }
    }
    const reactions = await this.myCommentReactions(viewerId, ids);
    const decorate = <T extends { id: string }>(c: T) => ({
      ...c,
      isLikedByMe: reactions.has(c.id),
      myReaction: reactions.get(c.id) ?? null,
    });
    const decorated = items.map((root) => ({
      ...decorate(root),
      replies: root.replies.map((lvl2) => ({
        ...decorate(lvl2),
        replies: lvl2.replies.map((lvl3) => decorate(lvl3)),
      })),
    }));

    return {
      items: decorated,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /** Map of commentId → the viewer's reaction emoji, for the given comment ids. */
  private async myCommentReactions(
    viewerId: string,
    commentIds: string[],
  ): Promise<Map<string, string>> {
    if (commentIds.length === 0) return new Map();
    const rows = await this.prisma.commentLike.findMany({
      where: { userId: viewerId, commentId: { in: commentIds } },
      select: { commentId: true, emoji: true },
    });
    return new Map(rows.map((r) => [r.commentId, r.emoji ?? '❤️']));
  }

  /**
   * Toggle the viewer's like on a comment. Visibility-gated like everything else
   * (you must be able to see the parent post). Atomic: the CommentLike row and
   * the denormalised likeCount move together, so the counter can't drift.
   */
  async toggleLike(
    userId: string,
    commentId: string,
    emoji = '❤️',
  ): Promise<{ liked: boolean; count: number; myReaction: string | null }> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, postId: true, authorId: true, deletedAt: true },
    });
    if (!comment || comment.deletedAt) throw new NotFoundException('Comment not found');
    await this.posts.assertCanViewPost(userId, comment.postId);

    const existing = await this.prisma.commentLike.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });

    if (existing) {
      if (existing.emoji === emoji) {
        const [, updated] = await this.prisma.$transaction([
          this.prisma.commentLike.delete({
            where: { userId_commentId: { userId, commentId } },
          }),
          this.prisma.comment.update({
            where: { id: commentId },
            data: { likeCount: { decrement: 1 } },
            select: { likeCount: true },
          }),
        ]);
        return { liked: false, count: updated.likeCount, myReaction: null };
      }
      const updated = await this.prisma.comment.update({
        where: { id: commentId },
        data: {}, // count unchanged on a switch
        select: { likeCount: true },
      });
      await this.prisma.commentLike.update({
        where: { userId_commentId: { userId, commentId } },
        data: { emoji },
      });
      return { liked: true, count: updated.likeCount, myReaction: emoji };
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.commentLike.create({ data: { userId, commentId, emoji } }),
      this.prisma.comment.update({
        where: { id: commentId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      }),
    ]);

    // Notify the comment author (engagement), never self.
    if (comment.authorId !== userId) {
      const liker = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, firstName: true },
      });
      const likerName = liker?.displayName || liker?.firstName || 'Un membre';
      await this.notifications
        .create({
          userId: comment.authorId,
          actorId: userId,
          type: 'like',
          title: `${likerName} a aimé votre commentaire`,
          data: { postId: comment.postId, commentId },
        })
        .catch(() => undefined);
    }
    return { liked: true, count: updated.likeCount, myReaction: emoji };
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
