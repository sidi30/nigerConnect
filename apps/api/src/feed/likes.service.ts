import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlockService } from '../social/block.service';
import { NotificationService } from '../notification/notification.service';
import { PostsService } from './posts.service';

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlockService,
    private readonly notifications: NotificationService,
    private readonly posts: PostsService,
  ) {}

  async toggleLike(userId: string, postId: string): Promise<{ liked: boolean; count: number }> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true, likeCount: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (await this.blocks.isBlocked(userId, post.authorId)) {
      throw new NotFoundException('Post not found');
    }

    const existing = await this.prisma.like.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await this.prisma.$transaction([
        this.prisma.like.delete({ where: { userId_postId: { userId, postId } } }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
      await this.invalidateCaches(userId, post.authorId);
      return { liked: false, count: post.likeCount - 1 };
    }

    await this.prisma.$transaction([
      this.prisma.like.create({ data: { userId, postId } }),
      this.prisma.post.update({
        where: { id: postId },
        data: { likeCount: { increment: 1 } },
      }),
    ]);

    // Notify post author (skip if liking own post)
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
        title: `${likerName} a aimé votre publication`,
        data: { postId },
      });
    }

    await this.invalidateCaches(userId, post.authorId);
    return { liked: true, count: post.likeCount + 1 };
  }

  private async invalidateCaches(likerId: string, authorId: string): Promise<void> {
    // Author's friends feed (counter change) + liker's feed (isLikedByMe flip).
    await this.posts.invalidateFeedCache(authorId);
    if (likerId !== authorId) {
      await this.posts.invalidateFeedForUsers([likerId]);
    }
  }

  async listLikers(postId: string, cursor?: string, limit = 30) {
    const likes = await this.prisma.like.findMany({
      where: { postId },
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
