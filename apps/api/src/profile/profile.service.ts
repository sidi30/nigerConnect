import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { S3Service } from '../common/storage/s3.service';
import {
  USER_PUBLIC_SELECT,
  USER_SELF_SELECT,
  type PublicUser,
  type SelfUser,
} from '../common/prisma/user-select';
import { BlockService } from '../social/block.service';
import { geocode } from '../common/geo/city-coords';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { CreatePhotoDto, SearchDto } from './dto/photo.dto';

const CACHE_TTL_SECONDS = 300;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly s3: S3Service,
    private readonly blocks: BlockService,
  ) {}

  async getMe(userId: string): Promise<SelfUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELF_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<SelfUser> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.showOnMap !== undefined) data.showOnMap = dto.showOnMap;
    if (dto.proximityAlerts !== undefined) data.proximityAlerts = dto.proximityAlerts;
    if (dto.proximityRadius !== undefined) data.proximityRadius = dto.proximityRadius;
    if (dto.languages !== undefined) data.languages = dto.languages;
    if (dto.privacyLevel !== undefined) data.privacyLevel = dto.privacyLevel;

    // When the user moves (city or country changes) but doesn't send explicit
    // coordinates, recompute lat/lon from the resolved city/country — otherwise
    // their pin on the map stays at the old location. We need the *effective*
    // values: a field the DTO doesn't touch keeps its stored value, so fetch
    // the current row when only one of the two is being updated.
    const locationChanged =
      (dto.city !== undefined || dto.countryCode !== undefined) &&
      dto.latitude === undefined &&
      dto.longitude === undefined;
    if (locationChanged) {
      const current =
        dto.city !== undefined && dto.countryCode !== undefined
          ? null
          : await this.prisma.user.findUnique({
              where: { id: userId },
              select: { city: true, countryCode: true },
            });
      const city = dto.city !== undefined ? dto.city : current?.city ?? null;
      const countryCode =
        dto.countryCode !== undefined ? dto.countryCode : current?.countryCode ?? null;
      const coords = geocode(city, countryCode);
      if (coords) {
        data.latitude = coords.lat;
        data.longitude = coords.lon;
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: USER_SELF_SELECT,
    });
    await this.invalidateProfileCache(userId);
    return user;
  }

  async updateAvatar(userId: string, avatarUrl: string | null): Promise<SelfUser> {
    // Never trust the client URL: it must point at an object this user uploaded
    // to our public bucket (users/<id>/...). Returns the canonical CDN URL.
    const canonicalUrl =
      avatarUrl === null ? null : await this.s3.assertOwnedPublicImage(avatarUrl, userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: canonicalUrl },
      select: USER_SELF_SELECT,
    });
    await this.invalidateProfileCache(userId);
    return user;
  }

  async updateCover(userId: string, coverUrl: string | null): Promise<SelfUser> {
    const canonicalUrl =
      coverUrl === null ? null : await this.s3.assertOwnedPublicImage(coverUrl, userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { coverUrl: canonicalUrl },
      select: USER_SELF_SELECT,
    });
    await this.invalidateProfileCache(userId);
    return user;
  }

  /**
   * Returns a viewer-safe view of another user's profile, respecting privacy.
   *
   * Uses USER_PUBLIC_SELECT: no email, no phone, no role, no internal counters.
   * Cached in Redis under a public-shape-only key so we never replicate secrets
   * outside Postgres.
   */
  async getById(viewerId: string, targetId: string): Promise<SelfUser | PublicUser> {
    if (viewerId === targetId) return this.getMe(targetId);
    if (await this.blocks.isBlocked(viewerId, targetId)) throw new NotFoundException('User not found');

    const cached = await this.redis.client.get(this.cacheKey(targetId));
    let target: PublicUser | null = null;
    if (cached) target = this.deserializePublic(cached);
    if (!target) {
      target = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: USER_PUBLIC_SELECT,
      });
      if (!target) throw new NotFoundException('User not found');
      await this.redis.client.set(
        this.cacheKey(targetId),
        this.serializePublic(target),
        'EX',
        CACHE_TTL_SECONDS,
      );
    }

    if (target.privacyLevel === 'private') throw new NotFoundException('User not found');

    // `friends`-only users still appear in search and on the map, so 404ing
    // their *profile header* (avatar, name, city, country) when a stranger
    // taps a search hit is misleading: the UI shows them in the list one
    // moment, then claims they no longer exist the next. Detail surfaces —
    // posts (gated in posts.service.ts) and the friends list (gated in
    // listFriendsOf below) — remain restricted; what we expose here is the
    // same set of fields already visible in the search/map response, so no
    // new information leaks.
    return target;
  }

  /**
   * Return the friend list of `targetId` if the viewer is allowed to see it.
   * Rules: same as viewing the profile itself — private → 404, friends-only → only friends, public → anyone.
   */
  async listFriendsOf(
    viewerId: string,
    targetId: string,
    cursor?: string,
    limit = 30,
  ): Promise<{
    items: Array<{
      id: string;
      displayName: string | null;
      firstName: string | null;
      lastName: string | null;
      avatarUrl: string | null;
      city: string | null;
      countryCode: string | null;
      identityStatus: string;
    }>;
    nextCursor: string | null;
  }> {
    // `getById` no longer 404s on friends-only profiles (the header is
    // visible to anyone who could already see them in search), so the
    // friend-list privacy gate has to run here instead. Rules:
    //   - private  → 404 (also applied by getById, kept for defense in depth)
    //   - friends  → 404 unless viewer is the target or an accepted friend
    //   - public   → visible to anyone
    //   - blocked  → 404 (getById throws first)
    const target = await this.getById(viewerId, targetId);
    if (target.privacyLevel === 'friends' && viewerId !== targetId) {
      const friendCount = await this.prisma.friendship.count({
        where: {
          status: 'accepted',
          OR: [
            { requesterId: viewerId, addresseeId: targetId },
            { requesterId: targetId, addresseeId: viewerId },
          ],
        },
      });
      if (friendCount === 0) throw new NotFoundException('User not found');
    }

    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: targetId }, { addresseeId: targetId }],
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { updatedAt: 'desc' },
      include: {
        requester: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            city: true,
            countryCode: true,
            identityStatus: true,
            privacyLevel: true,
          },
        },
        addressee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            city: true,
            countryCode: true,
            identityStatus: true,
            privacyLevel: true,
          },
        },
      },
    });

    // Exclude users who have blocked the viewer (or vice versa).
    const blockedRows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = new Set<string>();
    for (const b of blockedRows) {
      blockedIds.add(b.blockerId === viewerId ? b.blockedId : b.blockerId);
    }

    // Keep each surviving friendship paired with its row id so the cursor
    // can point at the LAST emitted row — not at the limit-th raw row, which
    // breaks (re-emits the same user on the next page) when post-filter shrinks
    // the window and the +1 sentinel slides into view.
    const visiblePairs = friendships
      .map((f) => ({
        friendshipId: f.id,
        user: f.requesterId === targetId ? f.addressee : f.requester,
      }))
      .filter(
        ({ user }) =>
          user.id !== viewerId && !blockedIds.has(user.id) && user.privacyLevel !== 'private',
      );

    const hasMore = friendships.length > limit;
    const pagePairs = hasMore ? visiblePairs.slice(0, limit) : visiblePairs;
    const items = pagePairs.map(({ user: { privacyLevel: _pl, ...rest } }) => rest);
    return {
      items,
      nextCursor:
        hasMore && pagePairs.length > 0 ? pagePairs[pagePairs.length - 1]!.friendshipId : null,
    };
  }

  async getPhotos(viewerId: string, ownerId: string, cursor?: string, limit = 20) {
    // Anyone could previously list ANY user's photos by guessing a UUID,
    // including users who set their profile to private and users who blocked
    // the viewer. Reuse `getById`'s gate — same rules: private → 404,
    // friends-only → header-shape user (so photos visible to anyone who
    // could already see them in search), blocks → 404.
    await this.getById(viewerId, ownerId);
    const photos = await this.prisma.userPhoto.findMany({
      where: { userId: ownerId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    const hasMore = photos.length > limit;
    const items = hasMore ? photos.slice(0, limit) : photos;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  async addPhoto(userId: string, dto: CreatePhotoDto) {
    // Validate both the main image and (when present) the thumbnail point at
    // objects this user uploaded to our public bucket; store canonical URLs.
    const url = await this.s3.assertOwnedPublicImage(dto.url, userId);
    const thumbnailUrl = dto.thumbnailUrl
      ? await this.s3.assertOwnedPublicImage(dto.thumbnailUrl, userId)
      : null;
    return this.prisma.userPhoto.create({
      data: {
        userId,
        url,
        thumbnailUrl,
        caption: dto.caption ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async deletePhoto(userId: string, photoId: string): Promise<void> {
    const photo = await this.prisma.userPhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Photo not found');
    if (photo.userId !== userId) throw new ForbiddenException('Not your photo');
    await this.prisma.userPhoto.delete({ where: { id: photoId } });
  }

  async presignUpload(userId: string, contentType: string, kind: string) {
    const folder = `users/${userId}/${kind}`;
    // Identity documents land in the private bucket — no CDN, reads go through
    // a moderator-only presigned GET. Everything else stays public.
    const visibility = kind === 'identity' ? 'private' : 'public';
    return this.s3.createPresignedUpload({ folder, contentType, visibility });
  }

  /**
   * Cursor-based search. Returns only public profiles OR friends of viewer.
   * Excludes blocked users (once Phase 4 ships the blocks table).
   */
  async search(viewerId: string, dto: SearchDto) {
    const limit = dto.limit;
    const conditions: Prisma.Sql[] = [
      this.prisma.$queryRawUnsafe('TRUE') as unknown as Prisma.Sql,
    ];
    // Simpler: use findMany with where
    const where: Prisma.UserWhereInput = {
      AND: [
        { id: { not: viewerId } },
        { status: 'active' },
        { privacyLevel: { in: ['public', 'friends'] } },
      ],
    };
    if (dto.q) {
      where.AND = [
        ...(where.AND as Prisma.UserWhereInput[]),
        {
          // Match on names only. Matching `email` here let anyone confirm an
          // address belongs to a registered user (and partial-match it),
          // which is a user/email enumeration leak — email is never exposed
          // in the search response, so it must not be searchable either.
          OR: [
            { firstName: { contains: dto.q, mode: 'insensitive' } },
            { lastName: { contains: dto.q, mode: 'insensitive' } },
            { displayName: { contains: dto.q, mode: 'insensitive' } },
          ],
        },
      ];
    }
    if (dto.country) {
      where.AND = [...(where.AND as Prisma.UserWhereInput[]), { countryCode: dto.country }];
    }
    if (dto.city) {
      where.AND = [
        ...(where.AND as Prisma.UserWhereInput[]),
        { city: { equals: dto.city, mode: 'insensitive' } },
      ];
    }

    // Exclude users blocked by viewer (either direction)
    const blockedRows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = new Set<string>();
    for (const b of blockedRows) {
      blockedIds.add(b.blockerId === viewerId ? b.blockedId : b.blockerId);
    }
    if (blockedIds.size > 0) {
      where.AND = [
        ...(where.AND as Prisma.UserWhereInput[]),
        { id: { notIn: Array.from(blockedIds) } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      take: limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        displayName: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        city: true,
        countryCode: true,
        identityStatus: true,
        privacyLevel: true,
      },
    });
    const hasMore = users.length > limit;
    const items = hasMore ? users.slice(0, limit) : users;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  /**
   * RGPD article 20 — produce a portable JSON dump of every row we hold for
   * the user. Excludes credentials (password hash, MFA secret, OAuth provider
   * IDs) — those would let someone with the dump impersonate the user. Avoids
   * dumping other users' messages: the user sees their own messages but the
   * peer's content is referenced by sender ID + display name only (the peer
   * has their own export route).
   */
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const [
      user,
      photos,
      friendships,
      blocksMade,
      posts,
      likes,
      comments,
      conversationMembers,
      messages,
      serviceRequests,
      serviceResponses,
      associationMemberships,
      notifications,
      reportsMade,
      identityDocuments,
      pushTokens,
      refreshTokens,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          displayName: true,
          bio: true,
          avatarUrl: true,
          coverUrl: true,
          city: true,
          countryCode: true,
          latitude: true,
          longitude: true,
          showOnMap: true,
          languages: true,
          privacyLevel: true,
          emailVerified: true,
          phoneVerified: true,
          identityStatus: true,
          role: true,
          status: true,
          mfaEnabled: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.userPhoto.findMany({ where: { userId } }),
      this.prisma.friendship.findMany({
        where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      }),
      this.prisma.block.findMany({ where: { blockerId: userId } }),
      this.prisma.post.findMany({ where: { authorId: userId } }),
      this.prisma.like.findMany({ where: { userId } }),
      this.prisma.comment.findMany({ where: { authorId: userId } }),
      this.prisma.conversationMember.findMany({ where: { userId } }),
      this.prisma.message.findMany({ where: { senderId: userId } }),
      this.prisma.serviceRequest.findMany({ where: { authorId: userId } }),
      this.prisma.serviceResponse.findMany({ where: { responderId: userId } }),
      this.prisma.associationMember.findMany({ where: { userId } }),
      this.prisma.notification.findMany({ where: { userId } }),
      this.prisma.report.findMany({ where: { reporterId: userId } }),
      this.prisma.identityDocument.findMany({
        where: { userId },
        // Don't include `fileUrl` — it's a presigned-URL handle that becomes
        // useless after expiry anyway, and exposing the bucket key in a JSON
        // file the user might forward is bad hygiene.
        select: { id: true, documentType: true, status: true, createdAt: true, reviewedAt: true },
      }),
      this.prisma.pushToken.findMany({
        where: { userId },
        select: { id: true, platform: true, createdAt: true },
      }),
      this.prisma.refreshToken.findMany({
        where: { userId },
        select: { id: true, deviceName: true, createdAt: true, expiresAt: true, revokedAt: true },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');

    return {
      _meta: {
        exportedAt: new Date().toISOString(),
        format: 'nigerconnect-rgpd-v1',
        notes:
          'RGPD article 20 export. Credentials (password, MFA secret, OAuth IDs) are never exported.',
      },
      profile: user,
      photos,
      friendships,
      blocksMade,
      posts,
      likes,
      comments,
      conversationMemberships: conversationMembers,
      messagesIAuthored: messages,
      serviceRequests,
      serviceResponses,
      associationMemberships,
      notifications,
      reportsMade,
      identityDocuments,
      activeDevices: pushTokens,
      activeSessions: refreshTokens,
    };
  }

  /**
   * RGPD — hard-delete the user account and cascading data.
   *
   * Cascades via FK `onDelete: Cascade` for posts, comments, likes, photos,
   * refresh tokens, push tokens, email tokens, friendships, blocks, conversation
   * memberships, messages, service requests/responses, association memberships,
   * notifications, reports. Identity documents are handled by the cleanup cron.
   *
   * We DO NOT keep a "tombstone" row — deletion is total, as required by RGPD.
   */
  async deleteAccount(userId: string): Promise<void> {
    // Gather S3 keys before the cascading delete removes the rows.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, coverUrl: true },
    });
    const photos = await this.prisma.userPhoto.findMany({
      where: { userId },
      select: { url: true, thumbnailUrl: true },
    });
    const identityDocs = await this.prisma.identityDocument.findMany({
      where: { userId },
      select: { fileUrl: true },
    });

    await this.prisma.user.delete({ where: { id: userId } });
    await this.invalidateProfileCache(userId);

    // Best-effort S3 cleanup — failure must not leak the user's data back
    // into the DB (the row is already gone). Public-bucket assets vs identity
    // docs go to different buckets, so route each to the right delete.
    const publicUrls = [
      user?.avatarUrl,
      user?.coverUrl,
      ...photos.flatMap((p) => [p.url, p.thumbnailUrl]),
    ].filter((u): u is string => !!u);
    const privateUrls = identityDocs.map((d) => d.fileUrl).filter((u): u is string => !!u);
    await Promise.allSettled([
      ...publicUrls.map((u) => this.s3.deleteObject(this.extractS3Key(u))),
      ...privateUrls.map((u) => this.s3.deletePrivateObject(this.extractS3Key(u))),
    ]);
  }

  private extractS3Key(url: string): string {
    try {
      if (url.startsWith('s3://')) {
        return url.replace('s3://', '').split('/').slice(1).join('/');
      }
      return new URL(url).pathname.replace(/^\//, '');
    } catch {
      return url;
    }
  }

  private cacheKey(userId: string): string {
    return `profile:${userId}`;
  }

  private async invalidateProfileCache(userId: string): Promise<void> {
    await this.redis.client.del(this.cacheKey(userId));
  }

  private serializePublic(user: PublicUser): string {
    return JSON.stringify(user, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  }

  private deserializePublic(raw: string): PublicUser {
    const parsed = JSON.parse(raw) as PublicUser;
    if (parsed.createdAt) parsed.createdAt = new Date(parsed.createdAt);
    return parsed;
  }
}
