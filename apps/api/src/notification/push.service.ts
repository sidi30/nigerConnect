import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import admin from 'firebase-admin';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { PrismaService as PrismaServiceImpl } from '../common/prisma/prisma.service';
import type { Env } from '../common/config/env.validation';

/**
 * Push notification fan-out.
 *
 * Two transports are supported, picked per token at send time:
 *   - **Expo Push Service** for tokens shaped like `ExponentPushToken[…]`
 *     (what `expo-notifications.getExpoPushTokenAsync()` returns). Works in
 *     Expo Go AND in EAS builds — Expo routes to FCM / APNs internally.
 *   - **Firebase Cloud Messaging** for raw FCM device tokens (only emitted by
 *     bare React Native / detached builds). Requires FCM_SERVICE_ACCOUNT_JSON.
 *
 * Either transport can be unconfigured; the service silently skips that path.
 * If both are unconfigured, all push fan-out is a no-op (dev mode).
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private fcm: admin.app.App | null = null;
  private readonly expo = new Expo();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaServiceImpl,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get('FCM_SERVICE_ACCOUNT_JSON', { infer: true });
    if (!raw) {
      this.logger.log('FCM disabled — using Expo Push Service for all tokens');
      return;
    }
    try {
      const credentials = JSON.parse(
        Buffer.from(raw, 'base64').toString('utf8'),
      ) as admin.ServiceAccount;
      this.fcm = admin.initializeApp({ credential: admin.credential.cert(credentials) });
      this.logger.log('FCM initialized (raw FCM tokens will be routed via Firebase)');
    } catch (error) {
      this.logger.error('Failed to initialize FCM — falling back to Expo only', error as Error);
    }
  }

  /**
   * Fan out a push to every device registered for the user.
   * Routes each token to the right transport. Drops invalid tokens.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string | null,
    data?: Record<string, string>,
  ): Promise<void> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId },
      select: { token: true, id: true },
    });
    if (tokens.length === 0) return;

    const expoTokens: { id: string; token: string }[] = [];
    const fcmTokens: { id: string; token: string }[] = [];
    for (const t of tokens) {
      if (Expo.isExpoPushToken(t.token)) expoTokens.push(t);
      else fcmTokens.push(t);
    }

    const staleIds: string[] = [];

    if (expoTokens.length > 0) {
      const stale = await this.sendViaExpo(expoTokens, title, body, data);
      staleIds.push(...stale);
    }
    if (fcmTokens.length > 0 && this.fcm) {
      const stale = await this.sendViaFcm(fcmTokens, title, body, data);
      staleIds.push(...stale);
    }

    if (staleIds.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { id: { in: staleIds } } });
      this.logger.log(`Removed ${staleIds.length} stale push tokens for user ${userId}`);
    }
  }

  /** Returns IDs of tokens that the receipt API marked as invalid / unregistered. */
  private async sendViaExpo(
    tokens: { id: string; token: string }[],
    title: string,
    body: string | null,
    data?: Record<string, string>,
  ): Promise<string[]> {
    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      sound: 'default',
      title,
      body: body ?? undefined,
      data: data ?? {},
      priority: 'high',
    }));

    const stale: string[] = [];
    const chunks = this.expo.chunkPushNotifications(messages);
    let messageIdx = 0;
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        this.logger.warn(`Expo push send failed for a chunk: ${String(err)}`);
        messageIdx += chunk.length;
        continue;
      }
      tickets.forEach((ticket) => {
        const tokenInfo = tokens[messageIdx]!;
        if (ticket.status === 'error') {
          const code = ticket.details?.error;
          if (code === 'DeviceNotRegistered' || code === 'InvalidCredentials') {
            stale.push(tokenInfo.id);
          } else {
            this.logger.warn(
              `Expo push error for token ${tokenInfo.id}: ${ticket.message ?? code}`,
            );
          }
        }
        messageIdx += 1;
      });
    }
    return stale;
  }

  private async sendViaFcm(
    tokens: { id: string; token: string }[],
    title: string,
    body: string | null,
    data?: Record<string, string>,
  ): Promise<string[]> {
    if (!this.fcm) return [];
    const messaging = admin.messaging(this.fcm);
    const response = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title, body: body ?? undefined },
      data: data ?? {},
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    });
    const stale: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const code = r.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          stale.push(tokens[i]!.id);
        }
      }
    });
    return stale;
  }
}
