import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../common/settings/settings.service';
import { NotificationService } from '../notification/notification.service';

/** Sliding window (ms) for both the "dormant" test and the at-most-once digest cadence. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Max members handled per tick — bounds cron cost independently of table size (AC-F2-03). */
const BATCH_SIZE = 200;

/** A single member's region-scoped aggregate counters (privacy-safe: numbers only). */
export interface DigestAggregates {
  eventsCount: number;
  annoncesCount: number;
  newMembersCount: number;
}

/** Minimal member shape needed to compute a digest — no PII beyond the recipient's own region. */
interface DigestCandidate {
  id: string;
  city: string | null;
  countryCode: string | null;
}

/**
 * E-DIGEST — weekly regional retention digest.
 *
 * Selects DORMANT, opt-in members whose 7-day window is due, computes three
 * AGGREGATE-ONLY counters scoped to their region, and sends at most one push per
 * member per sliding 7-day window via NotificationService (Expo push, free).
 *
 * PRIVACY: the "new members" counter counts ONLY `privacyLevel='public'` +
 * `status='active'` accounts (already discoverable by their own choice). A
 * `private` or `friends` account is NEVER counted and NEVER named — the payload
 * carries plain numbers, never a third-party id/name/avatar.
 *
 * IDEMPOTENCE (at-most-once): `lastDigestSentAt` is stamped BEFORE the push is
 * fired, so a relaunch / restart / manual re-run cannot double-send. A crash right
 * after the stamp can at worst drop one send — acceptable for a retention nudge.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Process one bounded batch of due members. Fail-closed on the kill-switch.
   * Returns the number of digests actually pushed (0-counter members are skipped
   * but still stamped so they aren't re-scanned before their next window).
   */
  async processBatch(now: Date = new Date()): Promise<number> {
    // Kill-switch read first — fail-closed (getSetting returns 'false' on outage).
    if (!(await this.settings.isDigestEnabled())) return 0;

    const dormantBefore = new Date(now.getTime() - WINDOW_MS);
    const candidates = (await this.prisma.user.findMany({
      where: {
        status: 'active',
        digestOptIn: true,
        // Region is mandatory — no meaningful aggregate without a country (AC-F1-04).
        countryCode: { not: null },
        AND: [
          // Dormant = neither SEEN nor logged in within the window. `lastLoginAt`
          // alone is not a dormancy signal: refresh tokens are long-lived, so a
          // member who opens the app daily can keep a month-old lastLoginAt and
          // would have been nudged with "come back" while actively using it.
          // `lastSeenAt` is null for accounts predating the column, which simply
          // falls back to the login test — conservative, never over-sends.
          { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: dormantBefore } }] },
          { OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: dormantBefore } }] },
          // Due: never digested, or last digest older than the 7-day window (idempotence).
          { OR: [{ lastDigestSentAt: null }, { lastDigestSentAt: { lt: dormantBefore } }] },
        ],
      },
      select: { id: true, city: true, countryCode: true },
      // Prioritise the longest-dormant (never-digested first) so coverage is fair.
      orderBy: { lastDigestSentAt: { sort: 'asc', nulls: 'first' } },
      take: BATCH_SIZE,
    })) as DigestCandidate[];

    let sent = 0;
    for (const member of candidates) {
      try {
        const aggregates = await this.computeAggregates(member, now);
        // Stamp BEFORE sending (at-most-once). Done only after a successful
        // aggregate read: a DB failure above leaves the member un-stamped so the
        // next tick retries them (AC-F1 error case).
        await this.prisma.user.update({
          where: { id: member.id },
          data: { lastDigestSentAt: now },
        });

        const total =
          aggregates.eventsCount + aggregates.annoncesCount + aggregates.newMembersCount;
        // Skip a hollow 0/0/0 digest (perceived as noise) — member stays stamped.
        if (total === 0) continue;

        await this.notification.create({
          userId: member.id,
          type: 'weekly_digest',
          title: 'Cette semaine dans ta région',
          body: this.buildBody(aggregates),
          // AGGREGATE-ONLY payload: numbers + a safe deep-link hint, never a
          // third-party identity. `screen` powers the mobile deep-link fallback.
          data: {
            screen: 'home',
            eventsCount: aggregates.eventsCount,
            annoncesCount: aggregates.annoncesCount,
            newMembersCount: aggregates.newMembersCount,
          },
        });
        sent += 1;
      } catch (error) {
        // Per-member failure must not abort the batch; the un-stamped member is
        // retried next tick.
        this.logger.warn(`Digest failed for member ${member.id}: ${String(error)}`);
      }
    }
    return sent;
  }

  /**
   * Three region-scoped counters over their respective windows. Region = country
   * (mandatory) refined by city when the recipient has one set.
   */
  async computeAggregates(member: DigestCandidate, now: Date): Promise<DigestAggregates> {
    const countryCode = member.countryCode as string; // batch filters out null country
    const cityFilter = member.city ? { city: member.city } : {};
    const windowStart = new Date(now.getTime() - WINDOW_MS);
    const windowEnd = new Date(now.getTime() + WINDOW_MS);

    const [eventsCount, annoncesCount, newMembersCount] = await Promise.all([
      // (1) Events happening in the NEXT 7 days for a same-region association
      //     (prospective window — what will happen, not what was created).
      this.prisma.associationEvent.count({
        where: {
          eventDate: { gte: now, lte: windowEnd },
          association: { countryCode, ...cityFilter },
        },
      }),
      // (2) Open help requests created in the LAST 7 days in the region.
      this.prisma.serviceRequest.count({
        where: {
          status: 'open',
          createdAt: { gte: windowStart, lte: now },
          countryCode,
          ...cityFilter,
        },
      }),
      // (3) New members in the LAST 7 days in the region — PUBLIC accounts ONLY,
      //     active, excluding the recipient. private/friends are NEVER counted
      //     (privacy: no small-number oracle on who just joined).
      this.prisma.user.count({
        where: {
          createdAt: { gte: windowStart, lte: now },
          status: 'active',
          privacyLevel: 'public',
          countryCode,
          ...cityFilter,
          id: { not: member.id },
        },
      }),
    ]);

    return { eventsCount, annoncesCount, newMembersCount };
  }

  /** Human body — plural-aware, numbers only. */
  private buildBody(a: DigestAggregates): string {
    const evt = `${a.eventsCount} ${a.eventsCount > 1 ? 'événements' : 'événement'}`;
    const ann = `${a.annoncesCount} ${a.annoncesCount > 1 ? 'annonces entraide' : 'annonce entraide'}`;
    const mem = `${a.newMembersCount} ${a.newMembersCount > 1 ? 'nouveaux membres' : 'nouveau membre'}`;
    return `${evt}, ${ann}, ${mem} près de toi.`;
  }
}
