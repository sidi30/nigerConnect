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
import { MailerService, type SendMailInput } from '../common/mail/mailer.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';
import { NotificationService } from '../notification/notification.service';
import type {
  CreateCampaignDto,
  PreviewRecipientsDto,
  SegmentDto,
  SubscribeDto,
  UpdateCampaignDto,
  UploadNewsletterMediaDto,
} from './dto/newsletter.dto';

/** Recipients are streamed in pages of this size, one mail per recipient. */
const BATCH_SIZE = 50;
/** Pause between batches — keeps us under SMTP provider per-second send caps. */
const BATCH_DELAY_MS = 1_000;

/** Image content-types the campaign upload endpoint accepts. */
const ALLOWED_UPLOAD_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Attachments we deliver are fetched server-side; cap each one to bound memory. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Shape held on the campaign row for the JSON `attachments` column. */
type StoredAttachment = { url: string; filename: string; contentType: string };

/**
 * Fields the dispatcher needs from a campaign row. `segment`/`attachments` are
 * Prisma `Json` (typed unknown here — parsed defensively at read time).
 */
interface DispatchCampaign {
  id: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  audience: string;
  critical: boolean;
  segment: unknown;
  includeEmails: string[];
  excludeEmails: string[];
  attachments: unknown;
}

/** Mutable per-dispatch state threaded through every send path. */
interface DispatchCtx {
  campaign: DispatchCampaign;
  attachments?: SendMailInput['attachments'];
  /** Lower-cased emails already mailed — global dedup across every source. */
  seen: Set<string>;
  /** Lower-cased emails to never mail (individual removals). */
  excluded: Set<string>;
  sent: number;
  failed: number;
}

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);
  private readonly apiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly notifications: NotificationService,
    private readonly s3: S3Service,
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
    const audience = dto.audience ?? 'subscribers';
    return this.prisma.newsletterCampaign.create({
      data: {
        subject: dto.subject,
        // Admin-authored HTML (rich editor) — lightly sanitized before storage.
        bodyHtml: this.sanitizeAdminHtml(dto.bodyHtml),
        bodyText: dto.bodyText,
        audience,
        // critical (opt-out bypass) only makes sense for account-based audiences.
        critical: this.isUserAudience(audience) ? dto.critical ?? false : false,
        // segment only meaningful for the 'segment' audience.
        segment: audience === 'segment' ? dto.segment ?? undefined : undefined,
        includeEmails: dto.includeEmails ?? [],
        excludeEmails: dto.excludeEmails ?? [],
        attachments: this.normalizeAttachments(dto.attachments),
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
    // Copy only the provided fields; sanitize HTML and normalize JSON columns so
    // a PATCH can't inject raw markup or persist a malformed attachments blob.
    const data: Record<string, unknown> = {};
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.bodyHtml !== undefined) data.bodyHtml = this.sanitizeAdminHtml(dto.bodyHtml);
    if (dto.bodyText !== undefined) data.bodyText = dto.bodyText;
    if (dto.audience !== undefined) {
      data.audience = dto.audience;
      // Re-gate critical/segment against the (possibly changed) audience.
      if (!this.isUserAudience(dto.audience)) {
        data.critical = false;
        if (dto.audience !== 'segment') data.segment = undefined;
      }
    }
    if (dto.critical !== undefined) {
      const aud = dto.audience ?? campaign.audience;
      data.critical = this.isUserAudience(aud) ? dto.critical : false;
    }
    if (dto.segment !== undefined) data.segment = dto.segment;
    if (dto.includeEmails !== undefined) data.includeEmails = dto.includeEmails;
    if (dto.excludeEmails !== undefined) data.excludeEmails = dto.excludeEmails;
    if (dto.attachments !== undefined) {
      data.attachments = this.normalizeAttachments(dto.attachments);
    }
    return this.prisma.newsletterCampaign.update({ where: { id }, data });
  }

  /**
   * Presign an image upload for a campaign. Images embedded in the body are
   * referenced by their absolute CDN URL; attachments are delivered from the
   * same bucket. Admin-only + throttled at the controller; content-type is
   * restricted to images and the size is bounded by the presign policy + the
   * attach-time HEAD (see {@link loadAttachments}).
   */
  async uploadMedia(dto: UploadNewsletterMediaDto) {
    const contentType = dto.contentType.toLowerCase();
    if (!ALLOWED_UPLOAD_TYPES.has(contentType)) {
      throw new BadRequestException('Type de fichier non supporté (images uniquement)');
    }
    const presigned = await this.s3.createPresignedUpload({
      folder: 'newsletter',
      contentType,
      visibility: 'public',
    });
    return {
      uploadUrl: presigned.uploadUrl,
      publicUrl: presigned.publicUrl,
      key: presigned.key,
      contentType,
      sseRequired: presigned.sseRequired,
      expiresIn: presigned.expiresIn,
    };
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

    const totalRecipients = await this.estimateRecipients(campaign);
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

  // ── Recipient estimation (preview) ───────────────────────────────────────

  /**
   * Estimate the recipient count for a saved draft (progress-bar denominator &
   * the pre-send confirmation). The exact deduped/excluded set is computed by
   * the dispatcher; this is intentionally an approximation:
   *   total ≈ max(0, baseAudience − excluded) + individuallyIncluded.
   */
  private async estimateRecipients(campaign: DispatchCampaign): Promise<number> {
    const include = campaign.includeEmails?.length ?? 0;
    const exclude = campaign.excludeEmails?.length ?? 0;
    let base = 0;
    if (this.isUserAudience(campaign.audience)) {
      base = await this.prisma.user.count({ where: this.buildAppUserWhere(campaign) });
    } else if (campaign.audience !== 'custom') {
      // 'subscribers' (and any legacy/unknown value) → the public email list.
      base = await this.prisma.newsletterSubscriber.count({
        where: { status: 'subscribed' },
      });
    }
    return Math.max(0, base - exclude) + include;
  }

  /** Preview a recipient count for an UNSAVED targeting draft (compose screen). */
  previewRecipients(dto: PreviewRecipientsDto): Promise<number> {
    return this.estimateRecipients({
      id: '',
      subject: '',
      bodyHtml: '',
      bodyText: '',
      audience: dto.audience,
      critical: dto.critical,
      segment: dto.segment ?? null,
      includeEmails: dto.includeEmails ?? [],
      excludeEmails: dto.excludeEmails ?? [],
      attachments: null,
    });
  }

  // ── Background dispatcher ────────────────────────────────────────────────

  /**
   * Drive a campaign to completion. Resolves the recipient set from
   * audience + segment, applies the individual exclusions, dedupes by email
   * (so someone present as BOTH a subscriber and an app account — or added
   * manually — is mailed exactly once), then persists progress. In-process
   * (no broker): the bottleneck is the SMTP rate limit. Known limitation: a
   * restart mid-send leaves the campaign in `sending` — acceptable at launch
   * volume, swappable for BullMQ (Redis already present) if it grows.
   */
  private async dispatch(campaignId: string): Promise<void> {
    const campaign = (await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
    })) as DispatchCampaign | null;
    if (!campaign) return;

    const ctx: DispatchCtx = {
      campaign,
      attachments: await this.loadAttachments(campaign),
      seen: new Set<string>(),
      excluded: new Set((campaign.excludeEmails ?? []).map((e) => e.toLowerCase())),
      sent: 0,
      failed: 0,
    };

    try {
      if (this.isUserAudience(campaign.audience)) {
        await this.dispatchAppUsers(ctx);
      } else if (campaign.audience !== 'custom') {
        await this.dispatchSubscribers(ctx);
      }
      // Hand-picked extras (all audiences, incl. 'custom'): plain branded email.
      await this.dispatchExtraEmails(ctx);

      await this.prisma.newsletterCampaign.update({
        where: { id: campaignId },
        data: {
          status: 'sent',
          sentCount: ctx.sent,
          failedCount: ctx.failed,
          sentAt: new Date(),
        },
      });
      this.logger.log(`Campaign ${campaignId} sent: ${ctx.sent} ok, ${ctx.failed} failed`);
    } catch (err) {
      this.logger.error(`Campaign ${campaignId} dispatch crashed`, err as Error);
      await this.prisma.newsletterCampaign
        .update({ where: { id: campaignId }, data: { status: 'failed' } })
        .catch(() => undefined);
    }
  }

  /** Persist running counters to the campaign row (progress polling). */
  private persistProgress(ctx: DispatchCtx): Promise<unknown> {
    return this.prisma.newsletterCampaign.update({
      where: { id: ctx.campaign.id },
      data: { sentCount: ctx.sent, failedCount: ctx.failed },
    });
  }

  /** Legacy email-list path: one branded mail per subscribed address. */
  private async dispatchSubscribers(ctx: DispatchCtx): Promise<void> {
    const { campaign } = ctx;
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
        const key = sub.email.toLowerCase();
        if (ctx.excluded.has(key) || ctx.seen.has(key)) continue;
        ctx.seen.add(key);
        try {
          await this.mailer.sendNewsletter(
            sub.email,
            campaign.subject,
            campaign.bodyHtml,
            campaign.bodyText,
            this.unsubscribeUrl(sub.unsubscribeToken),
            ctx.attachments,
          );
          ctx.sent++;
        } catch (err) {
          ctx.failed++;
          this.logger.warn(`Newsletter send failed for ${sub.email}: ${String(err)}`);
        }
      }

      await this.persistProgress(ctx);
      if (batch.length < BATCH_SIZE) break;
      await this.delay(BATCH_DELAY_MS);
    }
  }

  /**
   * Account path (audience 'app_users' or 'segment'): each recipient gets an
   * in-app notification (which fans out a push) and, if their address is
   * verified, a branded email with a one-click opt-out link. `critical`
   * campaigns reach every active account and ignore the per-user opt-out;
   * regular ones respect newsletterOptIn. Individually excluded addresses are
   * skipped entirely (no notif, no email).
   */
  private async dispatchAppUsers(ctx: DispatchCtx): Promise<void> {
    const { campaign } = ctx;
    let cursor: string | undefined;
    // Newsletter notices fade after two weeks; critical ones never auto-expire.
    const expiresInHours = campaign.critical ? null : 24 * 14;
    const preview = campaign.bodyText.slice(0, 140);
    const where = this.buildAppUserWhere(campaign);

    for (;;) {
      const batch = await this.prisma.user.findMany({
        where,
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
        const key = user.email ? user.email.toLowerCase() : null;
        // Individual removal takes the whole person out of the send.
        if (key && ctx.excluded.has(key)) continue;
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
          // Email only verified addresses (sender reputation) and dedupe by email.
          if (user.email && user.emailVerified && key && !ctx.seen.has(key)) {
            ctx.seen.add(key);
            const token = await this.ensureNewsletterToken(user.id, user.newsletterToken);
            await this.mailer.sendNewsletter(
              user.email,
              campaign.subject,
              campaign.bodyHtml,
              campaign.bodyText,
              this.appUnsubscribeUrl(token),
              ctx.attachments,
            );
          }
          ctx.sent++;
        } catch (err) {
          ctx.failed++;
          this.logger.warn(`Announcement send failed for user ${user.id}: ${String(err)}`);
        }
      }

      await this.persistProgress(ctx);
      if (batch.length < BATCH_SIZE) break;
      await this.delay(BATCH_DELAY_MS);
    }
  }

  /**
   * Hand-picked recipients (`includeEmails`) delivered as a plain branded email
   * on top of whatever the base audience resolved to — deduped against everyone
   * already mailed and against the exclusion list. These addresses aren't in any
   * opt-out table, so the unsubscribe link carries a harmless placeholder token.
   */
  private async dispatchExtraEmails(ctx: DispatchCtx): Promise<void> {
    const { campaign } = ctx;
    const emails = campaign.includeEmails ?? [];
    if (emails.length === 0) return;

    let progressed = false;
    for (const email of emails) {
      const key = email.toLowerCase();
      if (ctx.excluded.has(key) || ctx.seen.has(key)) continue;
      ctx.seen.add(key);
      try {
        await this.mailer.sendNewsletter(
          email,
          campaign.subject,
          campaign.bodyHtml,
          campaign.bodyText,
          this.unsubscribeUrl('manual'),
          ctx.attachments,
        );
        ctx.sent++;
      } catch (err) {
        ctx.failed++;
        this.logger.warn(`Newsletter send failed for ${email}: ${String(err)}`);
      }
      progressed = true;
    }
    if (progressed) await this.persistProgress(ctx);
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

  /** Account-based audiences (in-app notif + email, opt-out honoured). */
  private isUserAudience(audience: string): boolean {
    return audience === 'app_users' || audience === 'segment';
  }

  /**
   * Recipient WHERE for an account-based campaign. Critical messages reach every
   * active account; regular ones honour the per-user opt-out (default ON). For
   * the 'segment' audience, the stored segment further narrows the set — but the
   * opt-out is ALWAYS enforced on a non-critical send (privacy rule), whatever
   * `segment.optInOnly` says.
   */
  private buildAppUserWhere(campaign: {
    critical: boolean;
    audience?: string;
    segment?: unknown;
  }): Record<string, unknown> {
    const where: Record<string, unknown> = { status: 'active' };
    if (!campaign.critical) where.newsletterOptIn = true;

    const seg = this.parseSegment(campaign.segment);
    if (campaign.audience === 'segment' && seg) {
      if (seg.countryCode) where.countryCode = seg.countryCode;
      if (seg.city) where.city = { equals: seg.city, mode: 'insensitive' };
      if (seg.verifiedOnly) where.identityStatus = 'approved';
      if (seg.ambassadorOnly) where.isAmbassador = true;
      if (seg.optInOnly) where.newsletterOptIn = true;
      if (seg.activeSince) where.lastLoginAt = { gte: new Date(seg.activeSince) };
    }
    return where;
  }

  /** Defensive parse of the stored JSON segment (unknown at the type level). */
  private parseSegment(raw: unknown): SegmentDto | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as SegmentDto;
  }

  /**
   * Light server-side sanitation of admin-authored HTML. The composer is a
   * trusted-admin surface, but we still strip script/style/iframe blocks, inline
   * event handlers, and javascript:/data: URLs so a stored draft can't smuggle
   * active content into the email layout. Inline styles (email-safe) are kept.
   */
  private sanitizeAdminHtml(html: string): string {
    return html
      .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
      .replace(/(href|src)\s*=\s*("|')\s*data:(?!image\/)[^"']*\2/gi, '$1=$2#$2');
  }

  /**
   * Normalize the attachments list to the stored shape, dropping any URL that
   * doesn't point at our own public bucket (defence: we later fetch these bytes
   * server-side, so we never dereference a third-party URL).
   */
  private normalizeAttachments(
    list: StoredAttachment[] | undefined,
  ): StoredAttachment[] | undefined {
    if (!list || list.length === 0) return undefined;
    const clean = list.filter((a) => this.s3.parsePublicKey(a.url) !== null);
    return clean.length ? clean : undefined;
  }

  /**
   * Fetch each stored attachment ONCE per dispatch (not per recipient) into a
   * Buffer suitable for nodemailer. Only our own bucket URLs are dereferenced;
   * anything oversized or unreachable is skipped (logged) rather than failing
   * the whole campaign.
   */
  private async loadAttachments(
    campaign: DispatchCampaign,
  ): Promise<SendMailInput['attachments']> {
    const raw = campaign.attachments;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const out: NonNullable<SendMailInput['attachments']> = [];
    for (const item of raw as StoredAttachment[]) {
      if (!item?.url || this.s3.parsePublicKey(item.url) === null) {
        this.logger.warn(`Skipping foreign attachment URL: ${String(item?.url)}`);
        continue;
      }
      try {
        const res = await fetch(item.url);
        if (!res.ok) {
          this.logger.warn(`Attachment fetch ${item.url} → HTTP ${res.status}`);
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_ATTACHMENT_BYTES) {
          this.logger.warn(`Attachment ${item.url} too large (${buf.length} bytes) — skipped`);
          continue;
        }
        out.push({
          filename: item.filename,
          content: buf,
          contentType: item.contentType,
        });
      } catch (err) {
        this.logger.warn(`Attachment fetch failed for ${item.url}: ${String(err)}`);
      }
    }
    return out.length ? out : undefined;
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
