import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { S3Service } from '../common/storage/s3.service';
import { BlockService } from '../social/block.service';
import { MentionsService } from './mentions.service';
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
  isAmbassador: true,
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
    private readonly s3: S3Service,
    private readonly mentions: MentionsService,
  ) {}

  async create(authorId: string, dto: CreatePostDto) {
    if (dto.visibility === 'association' && !dto.associationId) {
      throw new BadRequestException('associationId required for association posts');
    }
    if (dto.visibility === 'association') {
      const isMember = await this.prisma.associationMember.count({
        where: { userId: authorId, associationId: dto.associationId, status: 'approved' },
      });
      if (!isMember) throw new ForbiddenException('Not a member of this association');
    }

    // Client-supplied media URLs are only validated as well-formed URLs by the
    // DTO. Bind each one to our own public bucket and confirm it exists / is an
    // image within size caps; persist the canonical URL the helper returns.
    const media = dto.media
      ? await Promise.all(
          dto.media.map(async (m, i) => ({
            mediaUrl: await this.s3.assertOwnedPublicImage(m.mediaUrl, authorId),
            thumbnailUrl: m.thumbnailUrl ?? null,
            mediaType: m.mediaType,
            width: m.width ?? null,
            height: m.height ?? null,
            blurhash: m.blurhash ?? null,
            sortOrder: m.sortOrder ?? i,
          })),
        )
      : undefined;

    const post = await this.prisma.post.create({
      data: {
        authorId,
        content: dto.content ?? null,
        visibility: dto.visibility,
        associationId: dto.associationId ?? null,
        media: media ? { create: media } : undefined,
      },
      include: {
        media: true,
        author: { select: AUTHOR_SELECT },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
    });

    await this.invalidateFeedCache(authorId);
    // invalidateFeedCache only busts the author + their friends. Association
    // posts also surface in the main feed of approved co-members who may NOT be
    // friends, so bust their cached start-page too — otherwise they'd miss the
    // post for up to the feed-cache TTL.
    if (post.visibility === 'association' && post.associationId) {
      const memberRows = await this.prisma.associationMember.findMany({
        where: { associationId: post.associationId, status: 'approved' },
        select: { userId: true },
      });
      await this.invalidateFeedForUsers(memberRows.map((m) => m.userId));
    }

    // Ping any friends @mentioned in the body — best-effort: a notification
    // failure must never 500 a post that's already been written.
    await this.mentions
      .notify({
        authorId,
        authorName: post.author?.displayName || post.author?.firstName || 'Un membre',
        content: post.content,
        preview: 'vous a mentionné dans une publication',
        data: { postId: post.id },
      })
      .catch(() => undefined);
    return post;
  }

  async createStory(authorId: string, dto: CreateStoryDto) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Same host-binding guard as posts — never persist an unvalidated URL.
    const mediaUrl = await this.s3.assertOwnedPublicImage(dto.media.mediaUrl, authorId);
    return this.prisma.post.create({
      data: {
        authorId,
        content: dto.content ?? null,
        visibility: 'friends',
        isStory: true,
        storyExpiresAt: expiresAt,
        media: {
          create: {
            mediaUrl,
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
      select: {
        id: true,
        authorId: true,
        visibility: true,
        associationId: true,
        author: { select: { privacyLevel: true } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId === viewerId) return post;
    if (await this.blocks.isBlocked(viewerId, post.authorId)) {
      throw new NotFoundException('Post not found');
    }
    const isFriend = async (): Promise<boolean> =>
      (await this.prisma.friendship.count({
        where: {
          status: 'accepted',
          OR: [
            { requesterId: viewerId, addresseeId: post.authorId },
            { requesterId: post.authorId, addresseeId: viewerId },
          ],
        },
      })) > 0;
    if (post.visibility === 'public') {
      // Mirror the feed rule: a private profile's public posts are NOT visible
      // to strangers via the single-post / comments / share side channels —
      // only the owner (handled above) and accepted friends may read them.
      if (post.author?.privacyLevel === 'private' && !(await isFriend())) {
        throw new NotFoundException('Post not found');
      }
      return post;
    }
    if (post.visibility === 'friends') {
      if (!(await isFriend())) throw new NotFoundException('Post not found');
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
    // `associationId` is immutable and not validated here, so any visibility
    // change that involves 'association' is rejected: converting TO association
    // would orphan the post (associationId stays null → invisible to all), and
    // converting an association post AWAY would leak members-only content to
    // public/friends. The association composer is the only path in/out.
    if (
      dto.visibility &&
      dto.visibility !== post.visibility &&
      (dto.visibility === 'association' || post.visibility === 'association')
    ) {
      throw new BadRequestException('Cannot change the association visibility of a post');
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
    const original = await this.assertCanViewPost(sharerId, postId);
    // The shared post is embedded for the sharer's (friends) audience without
    // re-checking each viewer against the original's visibility. Restrict
    // sharing to public posts so a friends-only/association post can never be
    // re-exposed to people who couldn't see the original.
    if (original.visibility !== 'public') {
      throw new ForbiddenException('Only public posts can be shared');
    }

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
              // Public posts surface in the global feed ONLY from non-private
              // profiles. A private profile's content stays restricted to the
              // owner + their friends (handled by the friends branch below) —
              // it never leaks to strangers via the public feed.
              { visibility: 'public', author: { privacyLevel: { not: 'private' } } },
              // Friends see a friend's public AND friends-only posts (incl. when
              // that friend keeps a private profile).
              { authorId: { in: friendIds }, visibility: { in: ['public', 'friends'] } },
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
   * The wall of a single association: every `association`-visibility post tied
   * to it. Read access is members-only — a non-approved viewer gets 403 (same
   * rule `assertCanViewPost` enforces per-post, applied once here for the
   * dedicated feed). Blocked authors are filtered out in both directions.
   */
  async getAssociationFeed(viewerId: string, associationId: string, cursor?: string, limit = 20) {
    const isMember =
      (await this.prisma.associationMember.count({
        where: { userId: viewerId, associationId, status: 'approved' },
      })) > 0;
    if (!isMember) throw new ForbiddenException('Not a member of this association');

    const blockedRows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = Array.from(
      new Set(blockedRows.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId))),
    );

    const cursorDate = cursor ? new Date(cursor) : null;

    const posts = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        isStory: false,
        visibility: 'association',
        associationId,
        ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
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
    const items = (hasMore ? posts.slice(0, limit) : posts).map((p) =>
      this.decoratePost(p, viewerId),
    );
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null;
    return { items, nextCursor };
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

    // Private profile: only the owner and accepted friends may read the wall.
    // Strangers get nothing (the profile chose not to be public).
    if (!isOwn && !isFriend) {
      const author = await this.prisma.user.findUnique({
        where: { id: authorId },
        select: { privacyLevel: true },
      });
      if (author?.privacyLevel === 'private') return { items: [], nextCursor: null };
    }

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
