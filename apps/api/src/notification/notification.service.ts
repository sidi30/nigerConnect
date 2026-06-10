import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PushService } from './push.service';

/** Notification history retention (Feature: 24h history). */
const DEFAULT_TTL_HOURS = 24;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async create(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    data?: Prisma.InputJsonValue;
    actorId?: string;
    /** Override the 24h default. Pass 0 / null for a non-expiring notification. */
    expiresInHours?: number | null;
  }) {
    if (params.actorId === params.userId) return null;
    const ttl = params.expiresInHours === undefined ? DEFAULT_TTL_HOURS : params.expiresInHours;
    const expiresAt = ttl ? new Date(Date.now() + ttl * 3_600_000) : null;
    const notification = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body ?? null,
        data: params.data ?? {},
        actorId: params.actorId ?? null,
        expiresAt,
      },
    });

    // Forward the original `data` payload (postId, conversationId, friendshipId,
    // …) so the mobile deep-link handler can route the tap to the right screen.
    // Push payloads only carry strings — flatten any non-string value.
    const pushData: Record<string, string> = {
      notificationId: notification.id,
      type: params.type,
    };
    if (params.data && typeof params.data === 'object' && !Array.isArray(params.data)) {
      for (const [key, value] of Object.entries(params.data as Record<string, unknown>)) {
        if (value === null || value === undefined) continue;
        pushData[key] =
          typeof value === 'string' ? value : JSON.stringify(value);
      }
    }
    // Fire & forget push — real-time delivery
    void this.push
      .sendToUser(params.userId, params.title, params.body ?? null, pushData)
      .catch((e) => this.logger.warn(`Push send failed: ${String(e)}`));

    return notification;
  }

  async list(userId: string, cursor?: string, limit = 30) {
    // Opportunistic GLOBAL purge: each time anyone opens their history we drop
    // every expired row (indexed on expiresAt). No cron dependency — the read
    // path keeps the whole table bounded even for users who only check badges.
    await this.purgeExpired();

    const items = await this.prisma.notification.findMany({
      where: { userId, ...this.notExpired() },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, read: false, ...this.notExpired() },
    });
  }

  /** Delete a single notification owned by the user. */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
  }

  /** Clear the user's entire notification history. */
  async clearAll(userId: string): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { userId } });
  }

  private async purgeExpired(): Promise<void> {
    await this.prisma.notification.deleteMany({
      where: { expiresAt: { not: null, lte: new Date() } },
    });
  }

  /** Where-clause fragment matching rows that have NOT expired. */
  private notExpired(): Prisma.NotificationWhereInput {
    return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
  }

  async registerPushToken(userId: string, token: string, platform: 'ios' | 'android' | 'web') {
    return this.prisma.pushToken.upsert({
      where: { userId_token: { userId, token } },
      create: { userId, token, platform },
      update: { platform },
    });
  }

  async deletePushToken(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }
}
