import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';

const PRESENCE_KEY = 'presence:online';
const PRESENCE_TTL_SECONDS = 60;

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  async markOnline(userId: string): Promise<void> {
    await this.redis.client.set(`presence:user:${userId}`, '1', 'EX', PRESENCE_TTL_SECONDS);
    await this.redis.client.sadd(PRESENCE_KEY, userId);
  }

  async heartbeat(userId: string): Promise<void> {
    await this.redis.client.expire(`presence:user:${userId}`, PRESENCE_TTL_SECONDS);
  }

  async markOfflineDelayed(userId: string, delayMs = 10_000): Promise<void> {
    setTimeout(() => {
      void (async () => {
        const stillConnected = await this.redis.client.get(`presence:user:${userId}`);
        if (!stillConnected) {
          await this.redis.client.srem(PRESENCE_KEY, userId);
        }
      })();
    }, delayMs).unref?.();
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.client.exists(`presence:user:${userId}`)) > 0;
  }

  async onlineAmong(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const id of userIds) pipeline.exists(`presence:user:${id}`);
    const results = await pipeline.exec();
    const online: string[] = [];
    results?.forEach(([err, value], i) => {
      if (!err && value === 1) online.push(userIds[i]!);
    });
    return online;
  }
}
