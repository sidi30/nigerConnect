import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PushService } from './push.service';

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
  }) {
    if (params.actorId === params.userId) return null;
    const notification = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body ?? null,
        data: params.data ?? {},
        actorId: params.actorId ?? null,
      },
    });

    // Fire & forget push — real-time delivery
    void this.push
      .sendToUser(params.userId, params.title, params.body ?? null, {
        notificationId: notification.id,
        type: params.type,
      })
      .catch((e) => this.logger.warn(`Push send failed: ${String(e)}`));

    return notification;
  }

  async list(userId: string, cursor?: string, limit = 30) {
    const items = await this.prisma.notification.findMany({
      where: { userId },
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
    return this.prisma.notification.count({ where: { userId, read: false } });
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
