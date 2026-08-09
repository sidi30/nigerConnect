import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '../common/mail/mailer.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../common/settings/settings.service';

/** Grace period after signup before nudging — let onboarding finish naturally. */
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** Max members handled per tick — bounds cron cost independently of table size. */
const BATCH_SIZE = 200;

/**
 * P-REMINDER — one-shot "complète ton profil" email nudge.
 *
 * Targets verified accounts still missing a countryCode a few days after
 * signup. In practice that means OAuth (Google/Apple) signups: the password
 * registration form always collects city/country, and the mobile app defines
 * "profile incomplete" exactly as `verified && !countryCode` (the
 * complete-profile gate in app/_layout.tsx) — this email mirrors that test.
 *
 * IDEMPOTENCE (at-most-once): `profileReminderSentAt` is stamped BEFORE the
 * email is fired, so a relaunch / restart / manual re-run cannot double-send.
 * A crash right after the stamp can at worst drop one send — acceptable for a
 * nudge. The stamp is never reset: one reminder per account, ever.
 *
 * Respects `newsletterOptIn` — this is a non-critical engagement email, so a
 * member who opted out of NigerConnect news never receives it.
 */
@Injectable()
export class ProfileReminderService {
  private readonly logger = new Logger(ProfileReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Process one bounded batch of due members. Fail-closed on the kill-switch.
   * Returns the number of reminders actually sent.
   */
  async processBatch(now: Date = new Date()): Promise<number> {
    // Kill-switch read first — fail-closed (getSetting returns 'false' on outage).
    if (!(await this.settings.isProfileReminderEnabled())) return 0;

    const createdBefore = new Date(now.getTime() - GRACE_MS);
    const candidates = await this.prisma.user.findMany({
      where: {
        status: 'active',
        emailVerified: true,
        email: { not: null },
        // The app's own "profile incomplete" definition — see class doc.
        countryCode: null,
        // Non-critical email → honour the news/announcements opt-out.
        newsletterOptIn: true,
        // Grace period: only accounts older than the window are nudged.
        createdAt: { lt: createdBefore },
        // One-shot: never reminded before.
        profileReminderSentAt: null,
      },
      select: { id: true, email: true, firstName: true },
      // Oldest signups first so coverage is fair across restarts.
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    let sent = 0;
    for (const member of candidates) {
      try {
        // Stamp BEFORE sending (at-most-once) — see class doc.
        await this.prisma.user.update({
          where: { id: member.id },
          data: { profileReminderSentAt: now },
        });
        await this.mailer.sendProfileReminder(member.email as string, member.firstName);
        sent += 1;
      } catch (error) {
        // Per-member failure must not abort the batch; an un-stamped member is
        // retried next tick, a stamped one is dropped (at-most-once).
        this.logger.warn(`Profile reminder failed for member ${member.id}: ${String(error)}`);
      }
    }
    return sent;
  }
}
