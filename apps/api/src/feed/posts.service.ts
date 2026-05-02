import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { BlockService } from '../social/block.service';
import type { CreatePostDto, CreateStoryDto, UpdatePostDto } from './dto/post.dto';

const FEED_CACHE_TTL = 120;
// Only the default-limit start page is cached. Caching arbitrary limits would
// require multi-key invalidation; non-default limits skip the cache instead.
const FEED_CACHE_LIMIT = 20;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const AUTHOR_SELECT = {
  id: true,
  displayName: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  city: true,
  countryCode: true,
  identityStatus: true,
} as const satisfies Prisma.UserSelect;

/**
 * Includes for the *original* post a share refers back to. We pull the same
 * columns the feed needs (author + media) but don't recurse — a share of a
 * share just shows the immediate parent.
 */
const SHARED_POST_INCLUDE = {
  media: { orderBy: { sortOrder: 'asc' } },
  author: { select: AUTHOR_SELECT },
} as const satisfies Prisma.PostInclude;

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly blocks: BlockService,
  ) {}

  async create(authorId: string, dto: CreatePostDto) {
    if (dto.visibility === 'association' && !dto.associationId) {
      throw new BadRequestException('associationId required for association posts');
    }

    const post = await this.prisma.post.create({
      data: {
        authorId,
        content: dto.content ?? null,
        visibility: dto.visibility,
        associationId: dto.associationId ?? null,
        media: dto.media
          ? {
              create: dto.media.map((m, i) => ({
                mediaUrl: m.mediaUrl,
                thumbnailUrl: m.thumbnailUrl ?? null,
                mediaType: m.mediaType,
                width: m.width ?? null,
                height: m.height ?? null,
                blurhash: m.blurhash ?? null,
                sortOrder: m.sortOrder ?? i,
              })),
            }
          : undefined,
      },
      include: {
        media: true,
        author: { select: AUTHOR_SELECT },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
    });

    await this.invalidateFeedCache(authorId);
    return post;
  }

  async createStory(authorId: string, dto: CreateStoryDto) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return this.prisma.post.create({
      data: {
        authorId,
        content: dto.content ?? null,
        visibility: 'friends',
        isStory: true,
        storyExpiresAt: expiresAt,
        media: {
          create: {
            mediaUrl: dto.media.mediaUrl,
            thumbnailUrl: dto.media.thumbnailUrl ?? null,
            mediaType: dto.media.mediaType,
            width: dto.media.width ?? null,
            height: dto.media.height ?? null,
            blurhash: dto.media.blurhash ?? null,
            sortOrder: 0,
          },
        },
      },
      include: {
        media: true,
        author: { select: AUTHOR_SELECT },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
    });
  }

  /**
   * Authoritative gate every "read or write something on a post" surface MUST
   * call before doing anything else. Centralises the visibility rules so a
   * future fanout (likes, comments, share, attach-to-thread, …) can't forget
   * one of them.
   *
   * 404 (not 403) is intentional: existence-of-resource is itself privileged
   * info — we don't want to confirm "post X exists but you can't see it" to
   * an attacker fishing UUIDs.
   */
  async assertCanViewPost(
    viewerId: string,
    postId: string,
  ): Promise<{ id: string; authorId: string; visibility: string; associationId: string | null }> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true, visibility: true, associationId: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId === viewerId) return post;
    if (await this.blocks.isBlocked(viewerId, post.authorId)) {
      throw new NotFoundException('Post not found');
    }
    if (post.visibility === 'public') return post;
    if (post.visibility === 'friends') {
      const isFriend =
        (await this.prisma.friendship.count({
          where: {
            status: 'accepted',
            OR: [
              { requesterId: viewerId, addresseeId: post.authorId },
              { requesterId: post.authorId, addresseeId: viewerId },
            ],
          },
        })) > 0;
      if (!isFriend) throw new NotFoundException('Post not found');
      return post;
    }
    if (post.visibility === 'association') {
      if (!post.associationId) throw new NotFoundException('Post not found');
      const isMember =
        (await this.prisma.associationMember.count({
          where: {
            userId: viewerId,
            associationId: post.associationId,
            status: 'approved',
          },
        })) > 0;
      if (!isMember) throw new NotFoundException('Post not found');
      return post;
    }
    // Unknown visibility value — refuse rather than expose.
    throw new NotFoundException('Post not found');
  }

  async getById(viewerId: string, postId: string) {
    await this.assertCanViewPost(viewerId, postId);
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        author: { select: AUTHOR_SELECT },
        likes: { where: { userId: viewerId }, select: { userId: true } },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    return this.decoratePost(post, viewerId);
  }

  async update(authorId: string, postId: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.deletedAt) throw new NotFoundException('Post not found');
    if (post.authorId !== authorId) throw new ForbiddenException('Not your post');
    if (Date.now() - post.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new ForbiddenException('Edit window expired (24h)');
    }
    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: { content: dto.content ?? post.content, visibility: dto.visibility ?? post.visibility },
      include: {
        media: true,
        author: { select: AUTHOR_SELECT },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
    });
    await this.invalidateFeedCache(authorId);
    return updated;
  }

  async softDelete(authorId: string, postId: string): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.deletedAt) throw new NotFoundException('Post not found');
    if (post.authorId !== authorId) throw new ForbiddenException('Not your post');
    await this.prisma.post.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });
    await this.invalidateFeedCache(authorId);
  }

  /**
   * Soft-delete a story. Only the author can delete. Same rule as posts,
   * but we treat stories as their own resource since the UX is distinct.
   */
  async deleteStory(authorId: string, storyId: string): Promise<void> {
    const story = await this.prisma.post.findUnique({ where: { id: storyId } });
    if (!story || story.deletedAt || !story.isStory) {
      throw new NotFoundException('Story not found');
    }
    if (story.authorId !== authorId) throw new ForbiddenException('Not your story');
    await this.prisma.post.update({
      where: { id: storyId },
      data: { deletedAt: new Date() },
    });
  }

  async share(sharerId: string, postId: string, content?: string) {
    // Same visibility rules as viewing — you can't share something you
    // shouldn't be able to see in the first place.
    await this.assertCanViewPost(sharerId, postId);

    const [share] = await this.prisma.$transaction([
      this.prisma.post.create({
        data: {
          authorId: sharerId,
          content: content ?? null,
          visibility: 'friends',
          sharedPostId: postId,
        },
        include: {
          author: { select: AUTHOR_SELECT },
          sharedPost: { include: SHARED_POST_INCLUDE },
        },
      }),
      this.prisma.post.update({
        where: { id: postId },
        data: { shareCount: { increment: 1 } },
      }),
    ]);
    return share;
  }

  // ── Feed ──────────────────────────────────────────────────────
  async getFeed(userId: string, cursor?: string, limit = 20) {
    const cacheable = !cursor && limit === FEED_CACHE_LIMIT;
    const cacheKey = `feed:${userId}:start`;
    if (cacheable) {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const friendRows = await this.prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = friendRows.map((f) =>
      f.requesterId === userId ? f.addresseeId : f.requesterId,
    );

    const blockedRows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = Array.from(
      new Set(blockedRows.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId))),
    );

    // Association posts are only visible to approved members of the
    // association — being friends with the author is NOT enough. Without
    // this set, friends-of-association-author would see association-only
    // posts they were never meant to read.
    const memberAssocIds = (
      await this.prisma.associationMember.findMany({
        where: { userId, status: 'approved' },
        select: { associationId: true },
      })
    ).map((m) => m.associationId);

    const cursorDate = cursor ? new Date(cursor) : null;

    const posts = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        isStory: false,
        AND: [
          blockedIds.length
            ? { authorId: { notIn: blockedIds } }
            : {},
          cursorDate ? { createdAt: { lt: cursorDate } } : {},
          {
            OR: [
              // Self always sees their own posts regardless of visibility.
              { authorId: userId },
              // Public: visible to anyone (subject to the block filter above).
              { visibility: 'public' },
              // Friends-only: only when the author is actually a friend.
              { visibility: 'friends', authorId: { in: friendIds } },
              // Association: only when viewer is an approved member of the
              // post's association — friendship with the author is irrelevant.
              ...(memberAssocIds.length > 0
                ? [
                    {
                      visibility: 'association' as const,
                      associationId: { in: memberAssocIds },
                    },
                  ]
                : []),
            ],
          },
        ],
      },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        author: { select: AUTHOR_SELECT },
        likes: { where: { userId }, select: { userId: true } },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = posts.length > limit;
    const items = (hasMore ? posts.slice(0, limit) : posts).map((p) => this.decoratePost(p, userId));
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null;
    const result = { items, nextCursor };

    if (cacheable) {
      await this.redis.client.set(cacheKey, JSON.stringify(result), 'EX', FEED_CACHE_TTL);
    }
    return result;
  }

  /**
   * Posts authored by a single user, filtered by the viewer's access rights.
   * - Viewer sees a post if it's public, OR they are friends with the author, OR the viewer is the author.
   * - Stories excluded.
   * - Blocked in either direction → empty.
   */
  async getUserPosts(viewerId: string, authorId: string, cursor?: string, limit = 20) {
    if (viewerId !== authorId && (await this.blocks.isBlocked(viewerId, authorId))) {
      return { items: [], nextCursor: null };
    }

    const isOwn = viewerId === authorId;
    const isFriend = isOwn
      ? true
      : (
          await this.prisma.friendship.count({
            where: {
              status: 'accepted',
              OR: [
                { requesterId: viewerId, addresseeId: authorId },
                { requesterId: authorId, addresseeId: viewerId },
              ],
            },
          })
        ) > 0;

    // Association-scoped posts must additionally be gated on viewer membership
    // of post.associationId — being a friend of the author is not enough.
    const memberAssocIds = isOwn || !isFriend
      ? []
      : (
          await this.prisma.associationMember.findMany({
            where: { userId: viewerId, status: 'approved' },
            select: { associationId: true },
          })
        ).map((m) => m.associationId);

    const visibilityFilter: Prisma.PostWhereInput = isOwn
      ? {}
      : isFriend
        ? {
            OR: [
              { visibility: { in: ['public', 'friends'] } },
              ...(memberAssocIds.length > 0
                ? [{ visibility: 'association' as const, associationId: { in: memberAssocIds } }]
                : []),
            ],
          }
        : { visibility: 'public' };

    const cursorDate = cursor ? new Date(cursor) : null;
    const posts = await this.prisma.post.findMany({
      where: {
        authorId,
        deletedAt: null,
        isStory: false,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        ...visibilityFilter,
      },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        author: { select: AUTHOR_SELECT },
        likes: { where: { userId: viewerId }, select: { userId: true } },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = posts.length > limit;
    const items = (hasMore ? posts.slice(0, limit) : posts).map((p) => this.decoratePost(p, viewerId));
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]!.createdAt.toISOString() : null,
    };
  }

  async getStoriesFeed(userId: string) {
    const friendRows = await this.prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = friendRows.map((f) =>
      f.requesterId === userId ? f.addresseeId : f.requesterId,
    );

    const stories = await this.prisma.post.findMany({
      where: {
        isStory: true,
        deletedAt: null,
        storyExpiresAt: { gt: new Date() },
        authorId: { in: [...friendIds, userId] },
      },
      include: {
        media: true,
        author: { select: AUTHOR_SELECT },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
      orderBy: { createdAt: 'desc' },
    });

    const grouped = new Map<string, { author: typeof stories[number]['author']; stories: typeof stories }>();
    for (const s of stories) {
      const entry = grouped.get(s.authorId);
      if (entry) entry.stories.push(s);
      else grouped.set(s.authorId, { author: s.author, stories: [s] });
    }
    return Array.from(grouped.values());
  }

  async deleteExpiredStories(): Promise<number> {
    const result = await this.prisma.post.updateMany({
      where: { isStory: true, deletedAt: null, storyExpiresAt: { lt: new Date() } },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  async invalidateFeedCache(authorId: string): Promise<void> {
    // Best-effort: delete the "start" cache entries for the author and any friends.
    const friendRows = await this.prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ requesterId: authorId }, { addresseeId: authorId }] },
      select: { requesterId: true, addresseeId: true },
    });
    const keys = [authorId, ...friendRows.map((f) => (f.requesterId === authorId ? f.addresseeId : f.requesterId))];
    await this.invalidateFeedForUsers(keys);
  }

  /** Invalidate the cached start-page of the feed for a specific set of users. */
  async invalidateFeedForUsers(userIds: readonly string[]): Promise<void> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) return;
    const pipeline = this.redis.client.pipeline();
    for (const uid of unique) pipeline.del(`feed:${uid}:start`);
    await pipeline.exec();
  }

  private decoratePost<T extends { likes?: { userId: string }[] }>(
    post: T,
    viewerId: string,
  ): Omit<T, 'likes'> & { isLikedByMe: boolean } {
    const { likes, ...rest } = post as T & { likes: { userId: string }[] };
    return {
      ...(rest as Omit<T, 'likes'>),
      isLikedByMe: (likes ?? []).some((l) => l.userId === viewerId),
    };
  }
}
