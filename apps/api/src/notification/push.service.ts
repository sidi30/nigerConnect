import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import admin from 'firebase-admin';
import type { PrismaService } from '../common/prisma/prisma.service';
import { PrismaService as PrismaServiceImpl } from '../common/prisma/prisma.service';
import type { Env } from '../common/config/env.validation';

/**
 * Firebase Cloud Messaging wrapper.
 *
 * Provisioning:
 *   1. Firebase console → new project → add Android/iOS app
 *   2. Generate a service account JSON (Settings → Service accounts → Generate key)
 *   3. Base64-encode it and set FCM_SERVICE_ACCOUNT_JSON env var
 *
 * If unset, push notifications are silently skipped (dev mode).
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private app: admin.app.App | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaServiceImpl,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get('FCM_SERVICE_ACCOUNT_JSON', { infer: true });
    if (!raw) {
      this.logger.warn('FCM disabled — set FCM_SERVICE_ACCOUNT_JSON (base64 JSON) to enable');
      return;
    }
    try {
      const credentials = JSON.parse(
        Buffer.from(raw, 'base64').toString('utf8'),
      ) as admin.ServiceAccount;
      this.app = admin.initializeApp({ credential: admin.credential.cert(credentials) });
      this.logger.log('FCM initialized');
    } catch (error) {
      this.logger.error('Failed to initialize FCM', error as Error);
    }
  }

  /**
   * Fan out a push to every device registered for the user.
   * Silently drops if FCM not configured or user has no devices.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string | null,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.app) return;
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId },
      select: { token: true, id: true },
    });
    if (tokens.length === 0) return;

    const messaging = admin.messaging(this.app);
    const response = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title, body: body ?? undefined },
      data: data ?? {},
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    });

    // Clean up invalid tokens (unregistered / invalid-argument)
    const staleIds: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const code = r.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          staleIds.push(tokens[i]!.id);
        }
      }
    });
    if (staleIds.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { id: { in: staleIds } } });
      this.logger.log(`Removed ${staleIds.length} stale push tokens for user ${userId}`);
    }
  }
}
