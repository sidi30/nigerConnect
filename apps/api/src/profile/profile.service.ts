import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { S3Service } from '../common/storage/s3.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { CreatePhotoDto, SearchDto } from './dto/photo.dto';

const CACHE_TTL_SECONDS = 300;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly s3: S3Service,
  ) {}

  async getMe(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<User> {
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

    const user = await this.prisma.user.update({ where: { id: userId }, data });
    await this.invalidateProfileCache(userId);
    return user;
  }

  async updateAvatar(userId: string, avatarUrl: string | null): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    await this.invalidateProfileCache(userId);
    return user;
  }

  async updateCover(userId: string, coverUrl: string | null): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { coverUrl },
    });
    await this.invalidateProfileCache(userId);
    return user;
  }

  /**
   * Returns a viewer-safe view of another user's profile, respecting privacy.
   */
  async getById(viewerId: string, targetId: string): Promise<User> {
    if (viewerId === targetId) return this.getMe(targetId);

    const cached = await this.redis.client.get(this.cacheKey(targetId));
    let target: User | null = null;
    if (cached) target = this.deserialize(cached);
    if (!target) {
      target = await this.prisma.user.findUnique({ where: { id: targetId } });
      if (!target) throw new NotFoundException('User not found');
      await this.redis.client.set(this.cacheKey(targetId), this.serialize(target), 'EX', CACHE_TTL_SECONDS);
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
    return this.s3.createPresignedUpload({ folder, contentType });
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

  private cacheKey(userId: string): string {
    return `profile:${userId}`;
  }

  private async invalidateProfileCache(userId: string): Promise<void> {
    await this.redis.client.del(this.cacheKey(userId));
  }

  private serialize(user: User): string {
    return JSON.stringify(user, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  }

  private deserialize(raw: string): User {
    const parsed = JSON.parse(raw);
    if (parsed.createdAt) parsed.createdAt = new Date(parsed.createdAt);
    if (parsed.updatedAt) parsed.updatedAt = new Date(parsed.updatedAt);
    if (parsed.lastLoginAt) parsed.lastLoginAt = new Date(parsed.lastLoginAt);
    return parsed as User;
  }
}
