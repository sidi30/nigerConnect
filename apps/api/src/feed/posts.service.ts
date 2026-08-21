import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// Value import (not `import type`): `Prisma.sql` is used at runtime by the
// country-volume query below.
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { S3Service, type PresignedUpload } from '../common/storage/s3.service';
import { SettingsService } from '../common/settings/settings.service';
import { ASSOCIATION_MEDIA_QUOTA_BYTES } from '../association/association-storage';
import { BlockService } from '../social/block.service';
import { DiasporaPolicyService, HOME_COUNTRY } from '../social/diaspora-policy.service';
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
  isOfficial: true,
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
    private readonly diaspora: DiasporaPolicyService,
  ) {}

  /**
   * Bind one image of a post to a space its author is allowed to draw from.
   *
   * ADR-002: an association's media live under `associations/{id}/`, a space
   * shared by its officers — the caller's role was already checked when the
   * upload was signed (association.service presignMedia) and again by the
   * publish gate above. The author's own `users/{authorId}/` space stays
   * accepted for association posts too: that is where the MOBILE app still
   * uploads, and refusing it would break posting a photo from the phone the
   * day this ships. Both are surfaces the author legitimately controls.
   *
   * An image sitting under ANOTHER association's prefix matches neither branch
   * and is refused — the fallback re-checks it against `users/{authorId}/`.
   */
  private async bindPostImage(
    url: string,
    authorId: string,
    associationId: string | null,
  ): Promise<{ url: string; bytes: number }> {
    if (associationId) {
      const prefix = `associations/${associationId}/`;
      const key = this.s3.parsePublicKey(url);
      if (key?.startsWith(prefix)) {
        // Only THIS branch is metered (B5). The fallback below lands in the
        // author's personal space, which is not the association's disk — the
        // day the mobile app uploads to the association prefix, its photos
        // start counting too, with no further change here.
        const bound = await this.s3.assertOwnedPublicMediaDetailed(url, 'image', prefix);
        return { url: bound.url, bytes: bound.bytes };
      }
    }
    return { url: await this.s3.assertOwnedPublicImage(url, authorId), bytes: 0 };
  }

  async create(authorId: string, dto: CreatePostDto) {
    if (dto.visibility === 'association' && !dto.associationId) {
      throw new BadRequestException('associationId required for association posts');
    }
    if (dto.visibility === 'association') {
      // Publishing under an association's name is reserved to the people who
      // run it (owner decision, 2026-08-21). Same three roles that may already
      // announce an event (association.service.ts createEvent): an association
      // post reaches every approved member's feed, so it IS the association
      // speaking — not one member addressing the others. Mere membership used
      // to be enough here.
      const isOfficer = await this.prisma.associationMember.count({
        where: {
          userId: authorId,
          associationId: dto.associationId,
          status: 'approved',
          role: { in: ['admin', 'moderator', 'owner'] },
        },
      });
      if (!isOfficer) {
        throw new ForbiddenException(
          "Only this association's officers can publish in its name",
        );
      }
    }

    // Client-supplied media URLs are only validated as well-formed URLs by the
    // DTO. Bind each one to our own public bucket and confirm it exists / is an
    // image within size caps; persist the canonical URL the helper returns.
    // The thumbnail needs the exact same treatment: it is rendered as an image
    // for every viewer, so an unbound one turns an attacker-chosen URL into a
    // beacon collecting the audience's IP and User-Agent.
    const scopedAssociationId =
      dto.visibility === 'association' ? (dto.associationId ?? null) : null;
    let associationBytes = 0;
    const media = dto.media
      ? await Promise.all(
          dto.media.map(async (m, i) => {
            const main = await this.bindPostImage(m.mediaUrl, authorId, scopedAssociationId);
            const thumb = m.thumbnailUrl
              ? await this.bindPostImage(m.thumbnailUrl, authorId, scopedAssociationId)
              : null;
            associationBytes += main.bytes + (thumb?.bytes ?? 0);
            return {
              mediaUrl: main.url,
              thumbnailUrl: thumb?.url ?? null,
              mediaType: m.mediaType,
              width: m.width ?? null,
              height: m.height ?? null,
              blurhash: m.blurhash ?? null,
              sortOrder: m.sortOrder ?? i,
            };
          }),
        )
      : undefined;

    const createArgs = {
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
    };

    // B5 — quand il y a de la place à réclamer, la réclamation et la création
    // vivent dans la MÊME transaction, et la réclamation est CONDITIONNELLE :
    // `updateMany` avec `mediaBytes <= quota - delta` ne touche la ligne que si
    // la place existe encore au moment du UPDATE. Deux dirigeants qui publient
    // au même instant ne peuvent donc pas franchir le plafond chacun de leur
    // côté après avoir lu la même valeur — c'est Postgres qui arbitre, pas un
    // test lu-puis-écrit.
    //
    // Sans octets à réclamer (l'immense majorité des publications), on écrit
    // directement : ouvrir une transaction pour une seule écriture coûterait
    // un aller-retour de plus à chaque publication du réseau.
    const post =
      scopedAssociationId && associationBytes > 0
        ? await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.association.updateMany({
              where: {
                id: scopedAssociationId,
                mediaBytes: { lte: ASSOCIATION_MEDIA_QUOTA_BYTES - associationBytes },
              },
              data: { mediaBytes: { increment: associationBytes } },
            });
            if (claimed.count === 0) {
              throw new HttpException(
                {
                  code: 'ASSOCIATION_STORAGE_FULL',
                  message:
                    "L'espace de stockage de l'association est plein. Supprimez d'anciennes publications pour libérer de la place.",
                },
                HttpStatus.PAYLOAD_TOO_LARGE,
              );
            }
            return tx.post.create(createArgs);
          })
        : await this.prisma.post.create(createArgs);

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

    // The video poster is a client-supplied URL like any other. The app uploads it
    // through the owned image presign (so it lands under `users/{id}/`), but nothing
    // forces a caller to do that — and the poster is displayed to every viewer of
    // the story, so leaving it unbound hands an attacker a beacon on the whole
    // audience. Bind it exactly like the clip itself.
    const thumbnailUrl = dto.media.thumbnailUrl
      ? await this.s3.assertOwnedPublicImage(dto.media.thumbnailUrl, authorId)
      : null;

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
            thumbnailUrl,
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
        author: { select: { privacyLevel: true, isOfficial: true } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId === viewerId) return post;
    if (await this.blocks.isBlocked(viewerId, post.authorId)) {
      throw new NotFoundException('Post not found');
    }
    // Everything the official account publishes is addressed to the whole
    // community — including its stories, which are stored with `friends`
    // visibility like any other story. Without this, tapping the push that
    // announced the story would 404 for everyone.
    if (post.author?.isOfficial) return post;
    // Diaspora split. This is the choke point for the single-post view, the
    // comment list and the liker list — without it, three side channels would
    // serve content the feed deliberately hides. Association posts stay exempt,
    // as in the feed. 404 rather than 403: the other side's content should read
    // as absent, not as forbidden.
    if (post.associationId === null && !(await this.diaspora.sharesContentScope(viewerId, post.authorId))) {
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
      // The community-wide visibility override lifts this profile-level gate
      // (the per-post `visibility` choice above stays untouched).
      if (
        post.author?.privacyLevel === 'private' &&
        !(await this.settings.isGlobalFullVisibility()) &&
        !(await isFriend())
      ) {
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
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { media: { select: { mediaUrl: true, thumbnailUrl: true } } },
    });
    if (!post || post.deletedAt) throw new NotFoundException('Post not found');
    if (post.authorId !== authorId) throw new ForbiddenException('Not your post');

    // B5 — un quota qui ne se libère jamais n'est pas un quota, c'est une date
    // de péremption. Les objets déposés dans l'espace de l'association sont
    // donc purgés ici, et les octets rendus. Purge AVANT le soft-delete, comme
    // pour les stories : un crash laisse un objet orphelin purgeable plutôt
    // qu'une ligne vivante qui pointe vers rien.
    //
    // Volontairement limité à l'espace de l'association : les médias d'une
    // publication ordinaire ne sont pas purgés aujourd'hui, et changer ça
    // dépasse le sujet du quota.
    const freed = await this.freeAssociationMedia(post.associationId, post.media);

    await this.prisma.post.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });
    if (post.associationId && freed > 0) {
      // `decrement` puis plancher à 0 : un compteur négatif serait un mensonge
      // plus grave que quelques octets perdus si un objet a été purgé deux fois.
      await this.prisma.association.updateMany({
        where: { id: post.associationId, mediaBytes: { gte: freed } },
        data: { mediaBytes: { decrement: freed } },
      });
      await this.prisma.association.updateMany({
        where: { id: post.associationId, mediaBytes: { lt: freed } },
        data: { mediaBytes: 0 },
      });
    }
    await this.invalidateFeedCache(authorId);
  }

  /**
   * Purge the objects of this post that live in the association's own space
   * and return how many bytes were freed. Objects outside that space (the
   * author's personal `users/{id}/` prefix, where the mobile app still
   * uploads) are left alone: they were never counted, so freeing them would
   * make the counter drift below reality.
   */
  private async freeAssociationMedia(
    associationId: string | null,
    media: ReadonlyArray<{ mediaUrl: string; thumbnailUrl?: string | null }>,
  ): Promise<number> {
    if (!associationId || media.length === 0) return 0;
    const prefix = `associations/${associationId}/`;
    let freed = 0;
    for (const m of media) {
      for (const url of [m.mediaUrl, m.thumbnailUrl]) {
        if (!url) continue;
        const key = this.s3.parsePublicKey(url);
        if (!key?.startsWith(prefix)) continue;
        freed += await this.s3.objectSize(key);
        await this.s3.deleteObject(key);
      }
    }
    return freed;
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

  async getFeed(userId: string, cursor?: string, limit = 20, country?: string) {
    // Only the DEFAULT view is cached (no explicit country asked for). Caching
    // each filter variant would mean tracking every key to bust on write; the
    // filtered views are the rare path, so they read through to Postgres and
    // the invalidation logic below stays exactly as it was.
    const cacheable = !cursor && limit === FEED_CACHE_LIMIT && country === undefined;
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

    // Diaspora split: the feed carries only content from the viewer's own side.
    // Association posts are exempt — an association is a shared resource open to
    // both sides, and filtering its wall would leave half its members looking at
    // a group that is visible but permanently empty.
    //
    // Country: defaults to the viewer's own (resolved server-side), 'all' lifts
    // it. It narrows the side, never widens it — see DiasporaPolicyService.
    const countryFilter = await this.diaspora.resolveFeedCountry(userId, country);
    const authorScope = await this.diaspora.authorScope(userId, countryFilter);

    const posts = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        isStory: false,
        AND: [
          blockedIds.length
            ? { authorId: { notIn: blockedIds } }
            : {},
          authorScope
            ? { OR: [{ associationId: { not: null } }, { author: authorScope }] }
            : {},
          cursorDate ? { createdAt: { lt: cursorDate } } : {},
          {
            OR: [
              // Self always sees their own posts regardless of visibility.
              { authorId: userId },
              // Public posts surface in the global feed ONLY from non-private
              // profiles. A private profile's content stays restricted to the
              // owner + their friends (handled by the friends branch below) —
              // it never leaks to strangers via the public feed. The
              // community-wide visibility override lifts that profile gate.
              (await this.settings.isGlobalFullVisibility())
                ? { visibility: 'public' as const }
                : { visibility: 'public' as const, author: { privacyLevel: { not: 'private' } } },
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
   * Countries the viewer can switch their feed to, ordered by how much content
   * actually sits behind each one.
   *
   * Volume-ordered, not alphabetical, and countries with nothing to show are
   * left out entirely: a chip that opens an empty feed reads as a broken app,
   * not as an empty country. The viewer's own country is always included even
   * at zero posts — it is the default view, so it has to be reachable to come
   * back to.
   *
   * Restricted to the viewer's side of the diaspora split, so the list can
   * never advertise a country whose posts {@link getFeed} would then refuse.
   */
  async listFeedCountries(viewerId: string) {
    const own = await this.diaspora.countryOf(viewerId);
    // Le côté ne borne la liste QUE si la séparation est active. Sans cette
    // condition, la liste et le fil se contredisent quand l'admin coupe le
    // split : les pastilles n'en proposent qu'un, alors que `?country=FR`
    // renvoie bien des publications françaises.
    const split = await this.settings.isDiasporaContentSplit();
    const sideFilter = !split
      ? Prisma.sql`TRUE`
      : (await this.diaspora.isHomeBased(viewerId))
        ? Prisma.sql`u.country_code = ${HOME_COUNTRY}`
        : Prisma.sql`u.country_code <> ${HOME_COUNTRY}`;

    type Row = { countryCode: string; posts: bigint; authors: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT u.country_code AS "countryCode",
             COUNT(*) AS posts,
             COUNT(DISTINCT p.author_id) AS authors
      FROM posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.deleted_at IS NULL
        AND p.is_story = false
        AND p.visibility = 'public'
        AND u.is_official = false
        AND u.country_code IS NOT NULL
        AND ${sideFilter}
      GROUP BY u.country_code
      ORDER BY posts DESC, u.country_code ASC
    `);

    const items = rows.map((r) => ({
      countryCode: r.countryCode,
      posts: Number(r.posts),
      authors: Number(r.authors),
    }));
    if (own && !items.some((i) => i.countryCode === own)) {
      items.push({ countryCode: own, posts: 0, authors: 0 });
    }
    return { items, ownCountry: own };
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
    // Diaspora split: the member stays findable — profiles, search and the map
    // are never filtered — but their wall belongs to the other side's feed.
    if (!(await this.diaspora.sharesContentScope(viewerId, authorId))) {
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
    // Strangers get nothing (the profile chose not to be public) — unless the
    // community-wide visibility override is on (they then get the stranger
    // view: public posts only, per the visibilityFilter below).
    if (!isOwn && !isFriend && !(await this.settings.isGlobalFullVisibility())) {
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

    // Same split as the feed. No association exemption here: a story is personal,
    // it never belongs to an association wall.
    const authorScope = await this.diaspora.authorScope(userId);

    // Blocks were never filtered here because the ring only ever showed friends,
    // and blocking drops the friendship. The official account is neither — a
    // member who blocked it must stop seeing its stories too.
    const blockedRows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = Array.from(
      new Set(blockedRows.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId))),
    );

    const stories = await this.prisma.post.findMany({
      where: {
        isStory: true,
        deletedAt: null,
        storyExpiresAt: { gt: new Date() },
        // Friends + self, PLUS the official NigerConnect account: an official
        // story is an announcement, everyone sees it without being "friends"
        // with the platform.
        OR: [
          { authorId: { in: [...friendIds, userId] } },
          { author: { isOfficial: true } },
        ],
        ...(blockedIds.length ? { authorId: { notIn: blockedIds } } : {}),
        ...(authorScope ? { author: authorScope } : {}),
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
    // The official ring comes first: an announcement that lands seventh in the
    // row is an announcement nobody opens.
    return Array.from(grouped.values()).sort((a, b) =>
      Number(b.author?.isOfficial ?? false) - Number(a.author?.isOfficial ?? false),
    );
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
