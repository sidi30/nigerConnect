import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PushService } from './push.service';

/** Notification history retention (Feature: 24h history). */
const DEFAULT_TTL_HOURS = 24;

/**
 * Colonne `users.notify_*` qui commande le PUSH de chaque type. Un type absent
 * de cette table n'est pas réglable : il part toujours (identité approuvée /
 * refusée, `system`, `announcement` — ces deux derniers passent déjà par
 * newsletterOptIn / digestOptIn en amont).
 *
 * Seul le push est filtré : la ligne d'historique, elle, est toujours écrite.
 */
const PUSH_PREFERENCE_BY_TYPE: Partial<Record<NotificationType, NotificationPreferenceKey>> = {
  message: 'notifyMessages',
  friend_request: 'notifySocial',
  friend_accepted: 'notifySocial',
  invite_accepted: 'notifySocial',
  like: 'notifyReactions',
  comment: 'notifyReactions',
  mention: 'notifyReactions',
  poll_new: 'notifyReactions',
  association_invite: 'notifyGroups',
  association_join_request: 'notifyGroups',
  association_join_approved: 'notifyGroups',
  association_join_rejected: 'notifyGroups',
  page_follow: 'notifyGroups',
  review_received: 'notifyGroups',
  service_response: 'notifyGroups',
  proximity: 'notifyProximity',
};

type NotificationPreferenceKey =
  | 'notifyMessages'
  | 'notifySocial'
  | 'notifyReactions'
  | 'notifyGroups'
  | 'notifyProximity';

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
    // Fire & forget push — real-time delivery, sauf si le membre a coupé cette
    // catégorie dans ses réglages (l'historique ci-dessus, lui, reste complet).
    void this.shouldPush(params.userId, params.type)
      .then((allowed) => {
        if (!allowed) return;
        return this.push.sendToUser(params.userId, params.title, params.body ?? null, pushData);
      })
      .catch((e) => this.logger.warn(`Push send failed: ${String(e)}`));

    return notification;
  }

  /**
   * Le membre veut-il être notifié sur son téléphone pour ce type ? Un type
   * hors table est réputé non réglable → toujours vrai. Un utilisateur
   * introuvable (course avec une suppression de compte) → vrai aussi : le push
   * partira dans le vide, ce qui est sans conséquence, et on ne veut pas
   * qu'une lecture ratée fasse taire des notifications légitimes.
   */
  private async shouldPush(userId: string, type: NotificationType): Promise<boolean> {
    const key = PUSH_PREFERENCE_BY_TYPE[type];
    if (!key) return true;
    const prefs = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { [key]: true } as Record<NotificationPreferenceKey, true>,
    });
    return prefs ? prefs[key] !== false : true;
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

  /**
   * Attacher l'appareil au compte — en le RÉCLAMANT aux autres. Un téléphone
   * appartient à la dernière session qui s'y est connectée, et à elle seule.
   *
   * Sans cette revendication, le détachement était purement client : une
   * session expirée, une déconnexion hors ligne, un téléphone prêté ou revendu
   * laissaient la ligne de l'ancien compte en base. Le fan-out lisant par
   * `userId`, ses messages privés continuaient d'arriver sur l'appareil du
   * compte suivant — aperçu compris, sur l'écran verrouillé.
   */
  async registerPushToken(userId: string, token: string, platform: 'ios' | 'android' | 'web') {
    return this.prisma.$transaction(async (tx) => {
      await tx.pushToken.deleteMany({ where: { token, userId: { not: userId } } });
      return tx.pushToken.upsert({
        where: { token },
        create: { userId, token, platform },
        update: { platform },
      });
    });
  }

  async deletePushToken(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }
}
