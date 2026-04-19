import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

const CACHE_TTL = 300;

@Injectable()
export class BlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Returns true if either user has blocked the other.
   * Cached 5min in Redis to avoid hitting the DB on every request.
   */
  async isBlocked(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const key = this.cacheKey(a, b);
    const cached = await this.redis.client.get(key);
    if (cached !== null) return cached === '1';

    const row = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { blockerId: true },
    });
    const value = row ? '1' : '0';
    await this.redis.client.set(key, value, 'EX', CACHE_TTL);
    return value === '1';
  }

  async block(blockerId: string, targetId: string): Promise<void> {
    if (blockerId === targetId) throw new BadRequestException('Cannot block yourself');

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!target) throw new NotFoundException('User not found');

      await tx.friendship.deleteMany({
        where: {
          OR: [
            { requesterId: blockerId, addresseeId: targetId },
            { requesterId: targetId, addresseeId: blockerId },
          ],
        },
      });
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId: targetId } },
        create: { blockerId, blockedId: targetId },
        update: {},
      });
    });

    await this.invalidateCache(blockerId, targetId);
  }

  async unblock(blockerId: string, targetId: string): Promise<void> {
    await this.prisma.block.deleteMany({
      where: { blockerId, blockedId: targetId },
    });
    await this.invalidateCache(blockerId, targetId);
  }

  async listBlocked(blockerId: string) {
    return this.prisma.block.findMany({
      where: { blockerId },
      include: {
        blocked: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private cacheKey(a: string, b: string): string {
    const [x, y] = [a, b].sort();
    return `block:${x}:${y}`;
  }

  private async invalidateCache(a: string, b: string): Promise<void> {
    await this.redis.client.del(this.cacheKey(a, b));
  }
}
