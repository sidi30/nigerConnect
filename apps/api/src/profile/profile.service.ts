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
    if (dto.languages !== undefined) data.languages = dto.languages;
    if (dto.privacyLevel !== undefined) data.privacyLevel = dto.privacyLevel;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: USER_SELF_SELECT,
    });
    await this.invalidateProfileCache(userId);
    return user;
  }

  async updateAvatar(userId: string, avatarUrl: string | null): Promise<SelfUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: USER_SELF_SELECT,
    });
    await this.invalidateProfileCache(userId);
    return user;
  }

  async updateCover(userId: string, coverUrl: string | null): Promise<SelfUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { coverUrl },
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

    if (target.privacyLevel === 'friends') {
      const friend = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM friendships
        WHERE status = 'accepted'
          AND (
            (requester_id = ${viewerId}::uuid AND addressee_id = ${targetId}::uuid)
            OR (requester_id = ${targetId}::uuid AND addressee_id = ${viewerId}::uuid)
          )
      `.catch(() => [{ count: 0n }]);
      if ((friend[0]?.count ?? 0n) === 0n) throw new NotFoundException('User not found');
    }

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
    // Reuse the privacy gate of getById (throws 404 if forbidden).
    await this.getById(viewerId, targetId);

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

  async getPhotos(userId: string, cursor?: string, limit = 20) {
    const photos = await this.prisma.userPhoto.findMany({
      where: { userId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    const hasMore = photos.length > limit;
    const items = hasMore ? photos.slice(0, limit) : photos;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  async addPhoto(userId: string, dto: CreatePhotoDto) {
    return this.prisma.userPhoto.create({
      data: {
        userId,
        url: dto.url,
        thumbnailUrl: dto.thumbnailUrl ?? null,
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
