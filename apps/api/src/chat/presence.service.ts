import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';

const PRESENCE_KEY = 'presence:online';
const PRESENCE_TTL_SECONDS = 60;
// How long a user is considered "actively viewing" a conversation after their
// last focus/heartbeat. Generous enough to survive brief socket blips, short
// enough that a backgrounded app (socket dropped → no refresh) resumes getting
// push notifications quickly. Refreshed on focus and on every message:read.
const ACTIVE_CONV_TTL_SECONDS = 120;

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  private activeConvKey(userId: string): string {
    return `active_conv:${userId}`;
  }

  /** Mark `userId` as actively viewing `conversationId` (refreshes the TTL). */
  async setActiveConversation(userId: string, conversationId: string): Promise<void> {
    await this.redis.client.set(
      this.activeConvKey(userId),
      conversationId,
      'EX',
      ACTIVE_CONV_TTL_SECONDS,
    );
  }

  /**
   * Clear the active-conversation marker. When `conversationId` is given we only
   * clear if it still matches — so a stale "blur" from a screen the user already
   * left doesn't wipe a newer focus on another conversation.
   */
  async clearActiveConversation(userId: string, conversationId?: string): Promise<void> {
    if (conversationId) {
      const current = await this.redis.client.get(this.activeConvKey(userId));
      if (current && current !== conversationId) return;
    }
    await this.redis.client.del(this.activeConvKey(userId));
  }

  /**
   * Of `userIds`, return those currently viewing `conversationId`. Used to skip
   * a push/notification for recipients who are already looking at the thread.
   */
  async activeInConversation(userIds: string[], conversationId: string): Promise<string[]> {
    if (userIds.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const id of userIds) pipeline.get(this.activeConvKey(id));
    const results = await pipeline.exec();
    const active: string[] = [];
    results?.forEach(([err, value], i) => {
      if (!err && value === conversationId) active.push(userIds[i]!);
    });
    return active;
  }

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
