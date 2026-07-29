import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { S3Service, type PresignedUpload } from '../common/storage/s3.service';
import { SettingsService } from '../common/settings/settings.service';
import { BlockService } from '../social/block.service';
import { MentionsService } from './mentions.service';
import type { CreatePostDto, CreateStoryDto, PresignVideoDto, UpdatePostDto } from './dto/post.dto';

const FEED_CACHE_TTL = 120;
// Only the default-limit start page is cached. Caching arbitrary limits would
// require multi-key invalidation; non-default limits skip the cache instead.
const FEED_CACHE_LIMIT = 20;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Stories-video quota (ADR-005 — deployable INERTE, enforced only for videos) ──
/** Max simultaneously-active (unexpired) videos a user may keep. DB-authoritative. */
const VIDEO_MAX_ACTIVE_PER_USER = 10;
/** Max uploaded video bytes per rolling UTC day (Redis counter). 200 Mo. */
const VIDEO_MAX_BYTES_PER_DAY = 200 * 1024 * 1024;
/** Max video CREATE/presign operations per UTC day (Redis counter). Anti-flood. */
const VIDEO_MAX_UPLOADS_PER_DAY = 5;
/** TTL of the daily Redis counters (24h). Counters are per-UTC-day, not sliding. */
const VIDEO_COUNTER_TTL_SECONDS = 24 * 60 * 60;
/** TTL of a story-video presigned PUT (900 s — slow NE/diaspora uplinks). */
const VIDEO_PRESIGN_TTL_SECONDS = 900;

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
    private readonly settings: SettingsService,
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

  // ── Stories video: kill-switch + verified-only gate + daily/byte quota ──────
  //
  // The whole path is INERTE until `video_enabled` is armed (fail-closed). Image
  // stories are untouched (they keep the existing users/ prefix binding), so a
  // dark deploy can't regress the current photo-story flow.

  /** UTC day bucket 'YYYYMMDD' for the per-day Redis counters (reset at UTC midnight). */
  private videoDay(now = new Date()): string {
    return now.toISOString().slice(0, 10).replace(/-/g, '');
  }

  /**
   * Gate shared by presign + create: the kill-switch must be ON and the caller
   * must be identity-approved (read DB FRESH, never the JWT claim — a token
   * minted before approval/revocation must not decide this). Fail-closed.
   */
  private async assertVideoAllowed(userId: string): Promise<void> {
    if (!(await this.settings.isVideoEnabled())) {
      throw new ForbiddenException({
        code: 'VIDEO_DISABLED',
        message: 'La vidéo est temporairement indisponible.',
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { identityStatus: true },
    });
    if (user?.identityStatus !== 'approved') {
      throw new ForbiddenException({
        code: 'IDENTITY_NOT_APPROVED',
        message: 'Publier une vidéo est réservé aux comptes vérifiés.',
      });
    }
  }

  private tooManyRequests(code: string, message: string): HttpException {
    return new HttpException({ code, message }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * POST /stories/presign — hand out a presigned PUT for a story video, but only
   * AFTER the gates so we never sign an upload for an object that would be
   * refused (wasted disk / trivial disk-DoS). Enforces the daily upload cap in
   * READ mode here (the create is the hard INCR enforcement).
   */
  async presignStoryVideo(userId: string, dto: PresignVideoDto): Promise<PresignedUpload> {
    await this.assertVideoAllowed(userId);

    // Read-only daily-cap check (create does the authoritative INCR). Blocks
    // early so a user at their cap doesn't even get an upload URL.
    const uploadsKey = `video:uploads:${userId}:${this.videoDay()}`;
    const uploads = Number((await this.redis.get(uploadsKey)) ?? '0');
    if (uploads >= VIDEO_MAX_UPLOADS_PER_DAY) {
      throw this.tooManyRequests(
        'UPLOAD_QUOTA_EXCEEDED',
        'Limite quotidienne de vidéos atteinte. Réessayez demain.',
      );
    }

    return this.s3.createPresignedUpload({
      folder: `stories/${userId}`,
      contentType: dto.contentType,
      expiresIn: VIDEO_PRESIGN_TTL_SECONDS,
      visibility: 'public',
    });
  }

  async createStory(authorId: string, dto: CreateStoryDto) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const isVideo = dto.media.mediaType === 'video';

    let mediaUrl: string;
    let boundBytes = 0;
    if (isVideo) {
      // Kill-switch + verified gate FIRST (fail-closed, INERTE by default).
      await this.assertVideoAllowed(authorId);

      // Active-video ceiling — DB-authoritative (auto-decremented by expiry).
      const activeVideos = await this.prisma.post.count({
        where: {
          authorId,
          isStory: true,
          deletedAt: null,
          storyExpiresAt: { gt: new Date() },
          media: { some: { mediaType: 'video' } },
        },
      });
      if (activeVideos >= VIDEO_MAX_ACTIVE_PER_USER) {
        throw this.tooManyRequests(
          'ACTIVE_VIDEO_QUOTA_EXCEEDED',
          'Vous avez trop de vidéos actives. Attendez leur expiration.',
        );
      }

      // Bind to our bucket under the caller's stories/ prefix, HEAD it, confront
      // the REAL content-type to the declared 'video' (anti-spoof), cap 25 Mo.
      const day = this.videoDay();
      const uploadsKey = `video:uploads:${authorId}:${day}`;
      const bytesKey = `video:bytes:${authorId}:${day}`;

      // Enforce the daily upload cap (read → reject) before the byte check.
      const uploads = Number((await this.redis.get(uploadsKey)) ?? '0');
      if (uploads >= VIDEO_MAX_UPLOADS_PER_DAY) {
        throw this.tooManyRequests(
          'UPLOAD_QUOTA_EXCEEDED',
          'Limite quotidienne de vidéos atteinte. Réessayez demain.',
        );
      }

      const bound = await this.s3.assertOwnedPublicMediaDetailed(
        dto.media.mediaUrl,
        'video',
        `stories/${authorId}/`,
      );
      mediaUrl = bound.url;
      boundBytes = bound.bytes;

      // Byte quota over the rolling UTC day. Reject if this upload would push the
      // running total past the cap (counter is INCRBY'd only after create succeeds).
      const usedBytes = Number((await this.redis.get(bytesKey)) ?? '0');
      if (usedBytes + boundBytes > VIDEO_MAX_BYTES_PER_DAY) {
        throw this.tooManyRequests(
          'BYTES_QUOTA_EXCEEDED',
          'Quota vidéo journalier atteint (200 Mo). Réessayez demain.',
        );
      }
    } else {
      // Image story: unchanged binding (users/ prefix). assertOwnedPublicImage
      // already confronts the real content-type to the image allowlist, so a
      // client declaring 'image' while uploading a video is still rejected.
      mediaUrl = await this.s3.assertOwnedPublicImage(dto.media.mediaUrl, authorId);
    }

    const post = await this.prisma.post.create({
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

    // Bump the daily counters AFTER a successful create so a rejected/failed
    // create never burns quota. Best-effort — a Redis blip must not 500 a story
    // that's already persisted (the disk guard + lifecycle are the real backstop).
    if (isVideo) {
      const day = this.videoDay();
      try {
        await this.redis.incrementCounter(`video:uploads:${authorId}:${day}`, VIDEO_COUNTER_TTL_SECONDS);
        await this.redis.client.incrby(`video:bytes:${authorId}:${day}`, boundBytes);
        await this.redis.client.expire(`video:bytes:${authorId}:${day}`, VIDEO_COUNTER_TTL_SECONDS);
      } catch {
        // Swallow — quota accounting is advisory; the hard disk ceiling is the guard.
      }
    }

    return post;
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
        likes: { where: { userId: viewerId }, select: { userId: true, emoji: true } },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    const rc = await this.reactionCountsFor([post.id]);
    return this.decoratePost(post, viewerId, rc.get(post.id) ?? []);
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
    const story = await this.prisma.post.findUnique({
      where: { id: storyId },
      include: { media: { select: { mediaUrl: true, thumbnailUrl: true } } },
    });
    if (!story || story.deletedAt || !story.isStory) {
      throw new NotFoundException('Story not found');
    }
    if (story.authorId !== authorId) throw new ForbiddenException('Not your story');
    // Free the disk BEFORE the soft-delete: once deletedAt is set the media rows
    // are still there, but doing it in this order means a crash leaves an
    // orphaned-but-purgeable object rather than a live row pointing at nothing.
    await this.purgePostMedia(story.media);
    await this.prisma.post.update({
      where: { id: storyId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Best-effort S3 purge for a set of PostMedia rows. Each object (and its
   * thumbnail, if it lives on our bucket too) is deleteObject'd; a failure on one
   * never blocks the others. Returns the count of delete attempts issued.
   *
   * This is the primary disk-reclamation mechanism (ADR-004 layer a): the MinIO
   * lifecycle is only a 48h backstop for the stories/ prefix.
   */
  private async purgePostMedia(
    media: ReadonlyArray<{ mediaUrl: string; thumbnailUrl?: string | null }>,
  ): Promise<number> {
    let purged = 0;
    for (const m of media) {
      for (const url of [m.mediaUrl, m.thumbnailUrl]) {
        if (!url) continue;
        const key = this.s3.parsePublicKey(url);
        if (!key) continue;
        await this.s3.deleteObject(key);
        purged += 1;
      }
    }
    return purged;
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

  /**
   * Feed cursors are the previous page's last `createdAt`, ISO-encoded. A
   * malformed one used to reach Prisma as an Invalid Date and surface as a 500;
   * it is a caller error, so say so.
   */
  private parseCursorDate(cursor?: string): Date | null {
    if (!cursor) return null;
    const date = new Date(cursor);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid cursor');
    }
    return date;
  }

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

    const cursorDate = this.parseCursorDate(cursor);

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
        likes: { where: { userId }, select: { userId: true, emoji: true } },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;
    const rc = await this.reactionCountsFor(page.map((p) => p.id));
    const items = page.map((p) => this.decoratePost(p, userId, rc.get(p.id) ?? []));
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

    const cursorDate = this.parseCursorDate(cursor);

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
        likes: { where: { userId: viewerId }, select: { userId: true, emoji: true } },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;
    const rc = await this.reactionCountsFor(page.map((p) => p.id));
    const items = page.map((p) => this.decoratePost(p, viewerId, rc.get(p.id) ?? []));
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

    const cursorDate = this.parseCursorDate(cursor);
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
        likes: { where: { userId: viewerId }, select: { userId: true, emoji: true } },
        sharedPost: { include: SHARED_POST_INCLUDE },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;
    const rc = await this.reactionCountsFor(page.map((p) => p.id));
    const items = page.map((p) => this.decoratePost(p, viewerId, rc.get(p.id) ?? []));
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

  /**
   * Purge expired stories: reclaim the S3 objects THEN soft-delete the rows.
   * Batched (≤200/pass) so a large backlog can't blow the heap. Returns the
   * number of stories soft-deleted. S3 deletes are best-effort (a purge failure
   * is logged inside deleteObject and never blocks the DB soft-delete — the
   * MinIO lifecycle sweeps any residue at 48h).
   */
  async deleteExpiredStories(): Promise<number> {
    const BATCH = 200;
    let total = 0;
    for (;;) {
      const expired = await this.prisma.post.findMany({
        where: { isStory: true, deletedAt: null, storyExpiresAt: { lt: new Date() } },
        select: { id: true, media: { select: { mediaUrl: true, thumbnailUrl: true } } },
        take: BATCH,
      });
      if (expired.length === 0) break;

      for (const story of expired) {
        await this.purgePostMedia(story.media);
      }
      const result = await this.prisma.post.updateMany({
        where: { id: { in: expired.map((s) => s.id) } },
        data: { deletedAt: new Date() },
      });
      total += result.count;
      if (expired.length < BATCH) break;
    }
    return total;
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

  private decoratePost<T extends { id: string; likes?: { userId: string; emoji?: string }[] }>(
    post: T,
    viewerId: string,
    reactionCounts: { emoji: string; count: number }[] = [],
  ): Omit<T, 'likes'> & {
    isLikedByMe: boolean;
    myReaction: string | null;
    reactionCounts: { emoji: string; count: number }[];
  } {
    const { likes, ...rest } = post as T & { likes: { userId: string; emoji?: string }[] };
    const mine = (likes ?? []).find((l) => l.userId === viewerId);
    return {
      ...(rest as Omit<T, 'likes'>),
      isLikedByMe: !!mine,
      // The viewer's chosen reaction emoji (defaults to ❤️ for legacy likes).
      myReaction: mine ? mine.emoji ?? '❤️' : null,
      reactionCounts,
    };
  }

  /**
   * Top reaction emojis (with counts) per post, for the "reaction pile" under a
   * post. One grouped query for the whole page; returns the 3 most-used emojis
   * per post, count-desc.
   */
  private async reactionCountsFor(
    postIds: string[],
  ): Promise<Map<string, { emoji: string; count: number }[]>> {
    const map = new Map<string, { emoji: string; count: number }[]>();
    if (postIds.length === 0) return map;
    const rows = await this.prisma.like.groupBy({
      by: ['postId', 'emoji'],
      where: { postId: { in: postIds } },
      _count: { emoji: true },
    });
    for (const r of rows) {
      const arr = map.get(r.postId) ?? [];
      arr.push({ emoji: r.emoji, count: r._count.emoji });
      map.set(r.postId, arr);
    }
    for (const [k, arr] of map) {
      arr.sort((a, b) => b.count - a.count);
      map.set(k, arr.slice(0, 3));
    }
    return map;
  }
}
