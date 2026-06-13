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
        createdById,
      },
    });
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

    const totalRecipients = await this.prisma.newsletterSubscriber.count({
      where: { status: 'subscribed' },
    });
    if (totalRecipients === 0) {
      throw new BadRequestException('Aucun abonné à qui envoyer');
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

    let sent = 0;
    let failed = 0;
    let cursor: string | undefined;

    try {
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
          where: { id: campaignId },
          data: { sentCount: sent, failedCount: failed },
        });

        if (batch.length < BATCH_SIZE) break;
        await this.delay(BATCH_DELAY_MS);
      }

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
          data: { status: 'failed', sentCount: sent, failedCount: failed },
        })
        .catch(() => undefined);
    }
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
