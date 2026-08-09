import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlockService } from '../social/block.service';
import { DiasporaPolicyService } from '../social/diaspora-policy.service';
import { NotificationService } from '../notification/notification.service';
import { PostsService } from './posts.service';

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlockService,
    private readonly notifications: NotificationService,
    private readonly posts: PostsService,
    private readonly diaspora: DiasporaPolicyService,
  ) {}

  /**
   * Set / switch / clear the viewer's reaction on a post (Instagram/Facebook
   * style). `emoji` defaults to ❤️ so the legacy "like" call still works.
   * - no reaction yet → create (count +1, notify author)
   * - same emoji again → remove (toggle off, count -1)
   * - different emoji → switch in place (count unchanged, no re-notify)
   */
  async toggleLike(
    userId: string,
    postId: string,
    emoji = '❤️',
  ): Promise<{ liked: boolean; count: number; myReaction: string | null }> {
    // Visibility gate first — without it, a non-friend could like a
    // friends-only post and surface their identity in the author's
    // notifications, working around the privacy setting entirely.
    await this.posts.assertCanViewPost(userId, postId);
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true, likeCount: true },
    });
    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.prisma.like.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      if (existing.emoji === emoji) {
        // Same reaction tapped again → remove it. The count comes back from the
        // UPDATE itself (same idiom as CommentsService): deriving it from the
        // pre-transaction read returns a stale number whenever someone else
        // reacted concurrently.
        const [, updated] = await this.prisma.$transaction([
          this.prisma.like.delete({ where: { userId_postId: { userId, postId } } }),
          this.prisma.post.update({
            where: { id: postId },
            data: { likeCount: { decrement: 1 } },
            select: { likeCount: true },
          }),
        ]);
        await this.invalidateCaches(userId, post.authorId);
        return { liked: false, count: updated.likeCount, myReaction: null };
      }
      // Switch reaction in place — count unchanged, no fresh notification.
      await this.prisma.like.update({
        where: { userId_postId: { userId, postId } },
        data: { emoji },
      });
      await this.invalidateCaches(userId, post.authorId);
      return { liked: true, count: post.likeCount, myReaction: emoji };
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.like.create({ data: { userId, postId, emoji } }),
      this.prisma.post.update({
        where: { id: postId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      }),
    ]);

    // Notify post author (skip if reacting to own post)
    if (post.authorId !== userId) {
      const liker = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, firstName: true },
      });
      const likerName = liker?.displayName || liker?.firstName || 'Un membre';
      await this.notifications.create({
        userId: post.authorId,
        actorId: userId,
        type: 'like',
        title: `${likerName} a réagi ${emoji} à votre publication`,
        data: { postId },
      });
    }

    await this.invalidateCaches(userId, post.authorId);
    return { liked: true, count: updated.likeCount, myReaction: emoji };
  }

  private async invalidateCaches(likerId: string, authorId: string): Promise<void> {
    // Author's friends feed (counter change) + liker's feed (isLikedByMe flip).
    await this.posts.invalidateFeedCache(authorId);
    if (likerId !== authorId) {
      await this.posts.invalidateFeedForUsers([likerId]);
    }
  }

  async listLikers(viewerId: string, postId: string, cursor?: string, limit = 30) {
    // Likers are publicly named on the post — but only to viewers who can
    // see the post. Without this gate, a stranger could enumerate which
    // diaspora members liked a friends-only or association-only post.
    await this.posts.assertCanViewPost(viewerId, postId);
    // Diaspora split: a reaction names its author, so the same rule applies —
    // otherwise the list of likers is a back door onto the other side's members.
    const authorScope = await this.diaspora.authorScope(viewerId);
    const likes = await this.prisma.like.findMany({
      where: { postId, ...(authorScope ? { user: authorScope } : {}) },
      take: limit + 1,
      ...(cursor
        ? { cursor: { userId_postId: { userId: cursor, postId } }, skip: 1 }
        : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });
    const hasMore = likes.length > limit;
    const items = hasMore ? likes.slice(0, limit) : likes;
    return {
      items: items.map((l) => l.user),
      nextCursor: hasMore ? items[items.length - 1]!.userId : null,
    };
  }
}
