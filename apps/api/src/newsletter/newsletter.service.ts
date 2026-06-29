import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.validation';
import { MailerService } from '../common/mail/mailer.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import type {
  CreateCampaignDto,
  SubscribeDto,
  UpdateCampaignDto,
} from './dto/newsletter.dto';

/** Recipients are streamed in pages of this size, one mail per recipient. */
const BATCH_SIZE = 50;
/** Pause between batches — keeps us under SMTP provider per-second send caps. */
const BATCH_DELAY_MS = 1_000;

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);
  private readonly apiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly notifications: NotificationService,
    config: ConfigService<Env, true>,
  ) {
    this.apiUrl = config.get('API_URL', { infer: true });
  }

  // ── Public ─────────────────────────────────────────────────────────────

  /**
   * Single opt-in subscribe. Idempotent: re-subscribing an unsubscribed address
   * reactivates it; an already-subscribed address is a no-op. Never throws on
   * duplicates so the public endpoint can't be used to enumerate addresses.
   */
  async subscribe(dto: SubscribeDto): Promise<void> {
    await this.prisma.newsletterSubscriber.upsert({
      where: { email: dto.email },
      create: {
        email: dto.email,
        source: dto.source ?? null,
        locale: dto.locale ?? null,
        unsubscribeToken: this.newToken(),
      },
      // Reactivate if previously unsubscribed; leave original source/token intact.
      update: { status: 'subscribed', unsubscribedAt: null },
    });
  }

  /** One-click unsubscribe by token. Returns false if the token is unknown. */
  async unsubscribe(token: string): Promise<boolean> {
    const res = await this.prisma.newsletterSubscriber.updateMany({
      where: { unsubscribeToken: token, status: 'subscribed' },
      data: { status: 'unsubscribed', unsubscribedAt: new Date() },
    });
    // 0 rows can mean unknown token OR already unsubscribed — treat the latter as
    // success so a second click still shows the confirmation page.
    if (res.count > 0) return true;
    const exists = await this.prisma.newsletterSubscriber.findUnique({
      where: { unsubscribeToken: token },
      select: { id: true },
    });
    return exists !== null;
  }

  // ── Admin: subscribers ──────────────────────────────────────────────────

  async listSubscribers(
    status: 'subscribed' | 'unsubscribed' | undefined,
    limit: number,
    cursor?: string,
  ) {
    const where = status ? { status } : {};
    const rows = await this.prisma.newsletterSubscriber.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        status: true,
        source: true,
        locale: true,
        createdAt: true,
        unsubscribedAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  async subscriberStats() {
    const [subscribed, unsubscribed] = await Promise.all([
      this.prisma.newsletterSubscriber.count({ where: { status: 'subscribed' } }),
      this.prisma.newsletterSubscriber.count({ where: { status: 'unsubscribed' } }),
    ]);
    return { subscribed, unsubscribed, total: subscribed + unsubscribed };
  }

  // ── Admin: campaigns ────────────────────────────────────────────────────

  listCampaigns() {
    return this.prisma.newsletterCampaign.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getCampaign(id: string) {
    const campaign = await this.prisma.newsletterCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campagne introuvable');
    return campaign;
  }

  createCampaign(dto: CreateCampaignDto, createdById: string) {
    return this.prisma.newsletterCampaign.create({
      data: {
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText,
        audience: dto.audience ?? 'subscribers',
        // critical only applies to app_users; ignored for the email list.
        critical: dto.audience === 'app_users' ? dto.critical ?? false : false,
        createdById,
      },
    });
  }

  /**
   * One-click unsubscribe for an app user (turns off newsletterOptIn) via the
   * token embedded in their announcement emails. Critical messages ignore the
   * flag, so this never blocks security/outage notices.
   */
  async appUnsubscribe(token: string): Promise<boolean> {
    const res = await this.prisma.user.updateMany({
      where: { newsletterToken: token, newsletterOptIn: true },
      data: { newsletterOptIn: false },
    });
    if (res.count > 0) return true;
    const exists = await this.prisma.user.findFirst({
      where: { newsletterToken: token },
      select: { id: true },
    });
    return exists !== null;
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto) {
    const campaign = await this.getCampaign(id);
    if (campaign.status !== 'draft') {
      throw new ConflictException('Seules les campagnes en brouillon sont modifiables');
    }
    return this.prisma.newsletterCampaign.update({ where: { id }, data: dto });
  }

  async deleteCampaign(id: string): Promise<void> {
    const campaign = await this.getCampaign(id);
    if (campaign.status !== 'draft') {
      throw new ConflictException('Seules les campagnes en brouillon sont supprimables');
    }
    await this.prisma.newsletterCampaign.delete({ where: { id } });
  }

  /** Send one test copy of a campaign to an arbitrary address. */
  async testCampaign(id: string, email: string): Promise<void> {
    const campaign = await this.getCampaign(id);
    // Tests use a throwaway token so the link is harmless if it leaks.
    await this.mailer.sendNewsletter(
      email,
      `[TEST] ${campaign.subject}`,
      campaign.bodyHtml,
      campaign.bodyText,
      this.unsubscribeUrl('test'),
    );
  }

  /**
   * Start sending a draft campaign. The draft→sending transition is atomic
   * (updateMany guarded by status) so a double-click can't launch two senders.
   * The actual delivery runs in the background (see {@link dispatch}).
   */
  async sendCampaign(id: string): Promise<{ totalRecipients: number }> {
    const campaign = await this.getCampaign(id);
    if (campaign.status !== 'draft') {
      throw new ConflictException(`Campagne déjà ${campaign.status}`);
    }

    const totalRecipients =
      campaign.audience === 'app_users'
        ? await this.prisma.user.count({ where: this.appUserWhere(campaign.critical) })
        : await this.prisma.newsletterSubscriber.count({ where: { status: 'subscribed' } });
    if (totalRecipients === 0) {
      throw new BadRequestException('Aucun destinataire à qui envoyer');
    }

    // Atomic claim: only the request that flips draft→sending proceeds.
    const claimed = await this.prisma.newsletterCampaign.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'sending', totalRecipients, sentCount: 0, failedCount: 0 },
    });
    if (claimed.count === 0) throw new ConflictException('Campagne déjà en cours');

    // Fire-and-forget: the HTTP request returns immediately.
    void this.dispatch(id);
    return { totalRecipients };
  }

  // ── Background dispatcher ────────────────────────────────────────────────

  /**
   * Streams subscribers in batches, sends one mail each, and persists progress
   * to the campaign row. In-process (no broker): the bottleneck is the SMTP
   * provider's rate limit, not queueing. Known limitation: a process restart
   * mid-send leaves the campaign in `sending` — acceptable for launch volume,
   * swappable for BullMQ (Redis already present) if it ever grows.
   */
  private async dispatch(campaignId: string): Promise<void> {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) return;

    try {
      const { sent, failed } =
        campaign.audience === 'app_users'
          ? await this.dispatchAppUsers(campaign)
          : await this.dispatchSubscribers(campaign);

      await this.prisma.newsletterCampaign.update({
        where: { id: campaignId },
        data: { status: 'sent', sentCount: sent, failedCount: failed, sentAt: new Date() },
      });
      this.logger.log(`Campaign ${campaignId} sent: ${sent} ok, ${failed} failed`);
    } catch (err) {
      this.logger.error(`Campaign ${campaignId} dispatch crashed`, err as Error);
      await this.prisma.newsletterCampaign
        .update({
          where: { id: campaignId },
          data: { status: 'failed' },
        })
        .catch(() => undefined);
    }
  }

  /** Legacy email-list path: one branded mail per subscribed address. */
  private async dispatchSubscribers(
    campaign: { id: string; subject: string; bodyHtml: string; bodyText: string },
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    let cursor: string | undefined;

    for (;;) {
      const batch = await this.prisma.newsletterSubscriber.findMany({
        where: { status: 'subscribed' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, email: true, unsubscribeToken: true },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      for (const sub of batch) {
        try {
          await this.mailer.sendNewsletter(
            sub.email,
            campaign.subject,
            campaign.bodyHtml,
            campaign.bodyText,
            this.unsubscribeUrl(sub.unsubscribeToken),
          );
          sent++;
        } catch (err) {
          failed++;
          this.logger.warn(`Newsletter send failed for ${sub.email}: ${String(err)}`);
        }
      }

      await this.prisma.newsletterCampaign.update({
        where: { id: campaign.id },
        data: { sentCount: sent, failedCount: failed },
      });

      if (batch.length < BATCH_SIZE) break;
      await this.delay(BATCH_DELAY_MS);
    }
    return { sent, failed };
  }

  /**
   * App-user path: each recipient gets an in-app notification (which fans out a
   * push) and, if their address is verified, a branded email with a one-click
   * opt-out link. `critical` campaigns reach every active account and ignore the
   * per-user opt-out; regular ones respect newsletterOptIn.
   */
  private async dispatchAppUsers(
    campaign: {
      id: string;
      subject: string;
      bodyHtml: string;
      bodyText: string;
      critical: boolean;
    },
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    let cursor: string | undefined;
    // Newsletter notices fade after two weeks; critical ones never auto-expire.
    const expiresInHours = campaign.critical ? null : 24 * 14;
    const preview = campaign.bodyText.slice(0, 140);

    for (;;) {
      const batch = await this.prisma.user.findMany({
        where: this.appUserWhere(campaign.critical),
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          newsletterToken: true,
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;

      for (const user of batch) {
        try {
          // In-app bell + push (NotificationService dispatches the push itself).
          await this.notifications.create({
            userId: user.id,
            type: 'announcement',
            title: campaign.subject,
            body: preview,
            data: { campaignId: campaign.id, critical: campaign.critical },
            expiresInHours,
          });
          // Email only verified addresses to protect sender reputation.
          if (user.email && user.emailVerified) {
            const token = await this.ensureNewsletterToken(user.id, user.newsletterToken);
            await this.mailer.sendNewsletter(
              user.email,
              campaign.subject,
              campaign.bodyHtml,
              campaign.bodyText,
              this.appUnsubscribeUrl(token),
            );
          }
          sent++;
        } catch (err) {
          failed++;
          this.logger.warn(`Announcement send failed for user ${user.id}: ${String(err)}`);
        }
      }

      await this.prisma.newsletterCampaign.update({
        where: { id: campaign.id },
        data: { sentCount: sent, failedCount: failed },
      });

      if (batch.length < BATCH_SIZE) break;
      await this.delay(BATCH_DELAY_MS);
    }
    return { sent, failed };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private newToken(): string {
    return randomBytes(32).toString('hex');
  }

  /** Absolute API URL for the public unsubscribe endpoint (global prefix /api). */
  private unsubscribeUrl(token: string): string {
    const base = this.apiUrl.replace(/\/+$/, '');
    return `${base}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  /** Absolute API URL for the app-user opt-out endpoint. */
  private appUnsubscribeUrl(token: string): string {
    const base = this.apiUrl.replace(/\/+$/, '');
    return `${base}/api/newsletter/app-unsubscribe?token=${encodeURIComponent(token)}`;
  }

  /**
   * Recipient set for an app-user campaign. Critical messages reach every active
   * account; regular ones honour the per-user opt-out (default ON).
   */
  private appUserWhere(critical: boolean) {
    return critical
      ? { status: 'active' as const }
      : { status: 'active' as const, newsletterOptIn: true };
  }

  /**
   * Lazily mint a stable per-user unsubscribe token. Reuses the existing one so
   * links in older emails keep working. Concurrent batches can race the unique
   * index — on conflict we re-read the row that won.
   */
  private async ensureNewsletterToken(
    userId: string,
    existing: string | null,
  ): Promise<string> {
    if (existing) return existing;
    const token = this.newToken();
    // Guarded write: only set if still null, so a concurrent campaign that already
    // minted a token for this user isn't clobbered (its emails keep a live link).
    await this.prisma.user
      .updateMany({
        where: { id: userId, newsletterToken: null },
        data: { newsletterToken: token },
      })
      .catch(() => undefined);
    // Re-read the winning value (ours, or the one a concurrent write installed).
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { newsletterToken: true },
    });
    return row?.newsletterToken ?? token;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
