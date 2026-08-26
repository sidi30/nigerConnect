import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Env } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';
import { SettingsService } from '../common/settings/settings.service';
import { AdminAuditService } from '../common/audit/audit.service';
import { MailerService } from '../common/mail/mailer.service';
import { NotificationService } from '../notification/notification.service';
import { ProfileService } from '../profile/profile.service';

// The "full visibility" support override auto-expires after this long so it's
// never left on by accident. The admin re-toggles it for a fresh window.
const FULL_VIS_TTL_HOURS = 2;

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 10;
const INVITE_URL_BASE = 'https://nigerconnect.app/invite';
const MAX_CODE_RETRIES = 5;

function generateBase62Code(length = CODE_LENGTH): string {
  const bytes = randomBytes(length * 2);
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    if (byte >= 62 * Math.floor(256 / 62)) continue;
    result += BASE62_CHARS[byte % 62];
  }
  if (result.length < length) return generateBase62Code(length);
  return result;
}

export interface AdminMetrics {
  users: {
    total: number;
    emailVerified: number;
    identityApproved: number;
    signups24h: number;
    signups7d: number;
    /** Users created in [now-14d, now-7d) — used by the frontend to compute delta %. */
    signups7dPrev: number;
    /** Users with lastLoginAt >= now-7d. */
    active7d: number;
    suspended: number;
    banned: number;
  };
  /**
   * Members who actually opened the app, from `lastSeenAt` (stamped hourly on
   * authenticated traffic). `active7d` above counts logins instead, which badly
   * under-reports: refresh tokens are long-lived, so a daily user may sign in
   * once a month. `stickiness` = DAU/MAU — the standard "is this a daily habit"
   * ratio (>20% is generally considered good).
   */
  activity: { dau: number; wau: number; mau: number; stickiness: number };
  identity: { pending: number; approved: number; rejected: number };
  content: { posts: number; posts7d: number; messages24h: number; comments: number };
  moderation: { reportsPending: number; resolved7d: number };
}

export interface TimeseriesPoint {
  /** UTC date string 'YYYY-MM-DD'. */
  date: string;
  signups: number;
  posts: number;
  messages: number;
  comments: number;
  reports: number;
}

export interface AdminTimeseries {
  days: number;
  series: TimeseriesPoint[];
}

/**
 * Une cohorte hebdomadaire d'inscrits et sa survie.
 *
 * PRECISION IMPORTANTE : ce n'est pas de la retention par evenements. On ne
 * garde qu'un `lastSeenAt` par membre, pas un journal de visites — on ne peut
 * donc pas dire « revenu le 7e jour », seulement « encore la au moins 7 jours
 * apres son inscription ». C'est une courbe de SURVIE, monotone decroissante,
 * et elle sous-estime toujours : un membre revenu a J+7 puis disparu compte
 * comme survivant a J+7, jamais l'inverse.
 *
 * `null` quand la fenetre n'est pas echue pour cette cohorte : afficher 0%
 * parce qu'une cohorte a trois jours n'a pas encore pu atteindre J+30 serait
 * une contre-verite, et c'est exactement l'erreur qu'un tableau de cohortes
 * rend invisible.
 */
export interface RetentionCohort {
  /** Lundi de la semaine d'inscription, 'YYYY-MM-DD' (UTC). */
  week: string;
  /** Membres inscrits cette semaine-la. */
  size: number;
  /** Part encore active au moins N jours apres inscription, 0-100. */
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export interface AdminRetention {
  weeks: number;
  cohorts: RetentionCohort[];
  /** Toutes cohortes confondues, sur la periode demandee. */
  overall: { size: number; d1: number | null; d7: number | null; d30: number | null };
}

export interface AdminBreakdowns {
  usersByCountry: Array<{ code: string; count: number }>;
  usersByStatus: Array<{ status: 'active' | 'suspended' | 'banned'; count: number }>;
  usersByRole: Array<{ role: 'user' | 'moderator' | 'admin'; count: number }>;
  identityDistribution: Array<{ status: 'not_submitted' | 'pending' | 'approved' | 'rejected'; count: number }>;
  reportsByReason: Array<{ reason: string; count: number }>;
  reportsByTarget: Array<{ targetType: string; count: number }>;
  authMethods: Array<{ method: 'password' | 'google' | 'facebook' | 'apple'; count: number }>;
  funnel: {
    registered: number;
    emailVerified: number;
    identitySubmitted: number;
    identityApproved: number;
  };
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly privateBucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly settings: SettingsService,
    private readonly profile: ProfileService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
    private readonly mailer: MailerService,
    config: ConfigService<Env, true>,
  ) {
    this.privateBucket = config.get('S3_PRIVATE_BUCKET', { infer: true });
  }

  /** Aggregate counters for the admin dashboard home. Cheap COUNT queries. */
  async metrics(): Promise<AdminMetrics> {
    const now = Date.now();
    const since24h = new Date(now - 24 * 3_600_000);
    const since7d = new Date(now - 7 * 24 * 3_600_000);
    const since14d = new Date(now - 14 * 24 * 3_600_000);
    const since30d = new Date(now - 30 * 24 * 3_600_000);

    const [
      usersTotal,
      emailVerified,
      identityApproved,
      identityPending,
      identityRejected,
      signups24h,
      signups7d,
      // Previous 7-day window [now-14d, now-7d) — used by the frontend for delta %.
      signups7dPrev,
      active7d,
      suspended,
      banned,
      posts,
      posts7d,
      messages24h,
      comments,
      reportsPending,
      // Reports with a terminal status (reviewed|resolved|dismissed) created in the last 7d.
      // Approximation: uses createdAt rather than resolvedAt because resolvedAt is sparse and
      // this is a cheap dashboard indicator, not an SLA metric.
      resolved7d,
      dau,
      wau,
      mau,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerified: true } }),
      this.prisma.user.count({ where: { identityStatus: 'approved' } }),
      this.prisma.user.count({ where: { identityStatus: 'pending' } }),
      this.prisma.user.count({ where: { identityStatus: 'rejected' } }),
      this.prisma.user.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since14d, lt: since7d } } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: since7d } } }),
      this.prisma.user.count({ where: { status: 'suspended' } }),
      this.prisma.user.count({ where: { status: 'banned' } }),
      this.prisma.post.count({ where: { deletedAt: null } }),
      this.prisma.post.count({ where: { deletedAt: null, createdAt: { gte: since7d } } }),
      this.prisma.message.count({ where: { createdAt: { gte: since24h }, deletedAt: null } }),
      this.prisma.comment.count({ where: { deletedAt: null } }),
      this.prisma.report.count({ where: { status: 'pending' } }),
      this.prisma.report.count({
        where: { status: { in: ['reviewed', 'resolved', 'dismissed'] }, createdAt: { gte: since7d } },
      }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: since24h } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: since7d } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: since30d } } }),
    ]);

    return {
      users: {
        total: usersTotal,
        emailVerified,
        identityApproved,
        signups24h,
        signups7d,
        signups7dPrev,
        active7d,
        suspended,
        banned,
      },
      activity: {
        dau,
        wau,
        mau,
        // Rounded to a whole percent — this is a dashboard tile, not an SLA.
        stickiness: mau > 0 ? Math.round((dau / mau) * 100) : 0,
      },
      identity: { pending: identityPending, approved: identityApproved, rejected: identityRejected },
      content: { posts, posts7d, messages24h, comments },
      moderation: { reportsPending, resolved7d },
    };
  }

  /**
   * Survie des cohortes hebdomadaires d'inscrits.
   *
   * Une seule requete : `date_trunc('week')` groupe les inscrits par semaine,
   * et chaque seuil compte ceux dont le dernier passage est au moins N jours
   * apres l'inscription. `FILTER (WHERE ...)` fait les trois comptes en un
   * balayage plutot qu'en trois requetes.
   *
   * Un seuil n'est calcule que si la cohorte a EU le temps de l'atteindre —
   * sinon `null`, jamais 0 : une cohorte de trois jours affichee a 0% de
   * retention a 30 jours est un chiffre faux qui se lit comme un echec.
   */
  async retention(weeks: number): Promise<AdminRetention> {
    const since = new Date(Date.now() - weeks * 7 * 24 * 3_600_000);

    type Row = {
      week: Date;
      size: bigint;
      d1: bigint;
      elig1: bigint;
      d7: bigint;
      elig7: bigint;
      d30: bigint;
      elig30: bigint;
    };

    // Chaque horizon a SON dénominateur : seuls les membres assez âgés pour
    // l'avoir atteint y comptent. Sans ça, les inscrits d'hier rejoignent le
    // dénominateur de J+30 et écrasent le taux de leur cohorte — un chiffre
    // faux qui se lit comme un effondrement.
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT date_trunc('week', created_at AT TIME ZONE 'UTC') AS week,
             COUNT(*)::bigint AS size,
             COUNT(*) FILTER (
               WHERE last_seen_at >= created_at + INTERVAL '1 day'
             )::bigint AS d1,
             COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day')::bigint AS elig1,
             COUNT(*) FILTER (
               WHERE last_seen_at >= created_at + INTERVAL '7 days'
             )::bigint AS d7,
             COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days')::bigint AS elig7,
             COUNT(*) FILTER (
               WHERE last_seen_at >= created_at + INTERVAL '30 days'
             )::bigint AS d30,
             COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days')::bigint AS elig30
      FROM   users
      WHERE  created_at >= ${since}
      GROUP  BY 1
      ORDER  BY 1 DESC
    `);

    /** Part en %, ou null quand personne n'est encore assez ancien pour compter. */
    const share = (hit: bigint, eligible: bigint) =>
      eligible === 0n ? null : Math.round((Number(hit) / Number(eligible)) * 100);

    const cohorts: RetentionCohort[] = rows.map((r) => ({
      week: r.week.toISOString().slice(0, 10),
      size: Number(r.size),
      d1: share(r.d1, r.elig1),
      d7: share(r.d7, r.elig7),
      d30: share(r.d30, r.elig30),
    }));

    /** Agregat toutes cohortes : meme regle, sur les eligibles cumules. */
    const totalFor = (pick: (r: Row) => bigint, eligPick: (r: Row) => bigint) => {
      const eligible = rows.reduce((acc, r) => acc + Number(eligPick(r)), 0);
      if (eligible === 0) return null;
      const hit = rows.reduce((acc, r) => acc + Number(pick(r)), 0);
      return Math.round((hit / eligible) * 100);
    };

    return {
      weeks,
      cohorts,
      overall: {
        size: rows.reduce((acc, r) => acc + Number(r.size), 0),
        d1: totalFor((r) => r.d1, (r) => r.elig1),
        d7: totalFor((r) => r.d7, (r) => r.elig7),
        d30: totalFor((r) => r.d30, (r) => r.elig30),
      },
    };
  }

  /**
   * Per-day time-series for the last `days` days (UTC days). Each table is
   * queried with a single date_trunc GROUP BY via $queryRaw, then the results
   * are merged into a gap-filled JS array so every calendar day has a row.
   *
   * `days` is validated to int 7..90 upstream (Zod), but we still pass it as a
   * parameterised value — never string-concatenated — so the DB sees a bind param.
   */
  async timeseries(days: number): Promise<AdminTimeseries> {
    // Build the UTC date axis once; we'll fill each metric series into it.
    const axis = this.buildDateAxis(days);
    const since = new Date(Date.now() - days * 24 * 3_600_000);

    type RawRow = { day: Date; cnt: bigint };

    // Five parallel raw queries — one per metric.
    const [signupRows, postRows, messageRows, commentRows, reportRows] = await Promise.all([
      this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
               COUNT(*)::bigint AS cnt
        FROM   users
        WHERE  created_at >= ${since}
        GROUP  BY 1
        ORDER  BY 1
      `),
      this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
               COUNT(*)::bigint AS cnt
        FROM   posts
        WHERE  deleted_at IS NULL
          AND  created_at >= ${since}
        GROUP  BY 1
        ORDER  BY 1
      `),
      this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
               COUNT(*)::bigint AS cnt
        FROM   messages
        WHERE  deleted_at IS NULL
          AND  created_at >= ${since}
        GROUP  BY 1
        ORDER  BY 1
      `),
      this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
               COUNT(*)::bigint AS cnt
        FROM   comments
        WHERE  deleted_at IS NULL
          AND  created_at >= ${since}
        GROUP  BY 1
        ORDER  BY 1
      `),
      this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
               COUNT(*)::bigint AS cnt
        FROM   reports
        WHERE  created_at >= ${since}
        GROUP  BY 1
        ORDER  BY 1
      `),
    ]);

    const toMap = (rows: RawRow[]): Map<string, number> =>
      new Map(rows.map((r) => [this.toDateKey(r.day), Number(r.cnt)]));

    const signups = toMap(signupRows);
    const posts = toMap(postRows);
    const messages = toMap(messageRows);
    const comments = toMap(commentRows);
    const reports = toMap(reportRows);

    const series: TimeseriesPoint[] = axis.map((date) => ({
      date,
      signups: signups.get(date) ?? 0,
      posts: posts.get(date) ?? 0,
      messages: messages.get(date) ?? 0,
      comments: comments.get(date) ?? 0,
      reports: reports.get(date) ?? 0,
    }));

    return { days, series };
  }

  /**
   * Distribution breakdowns for pie/bar charts on the admin dashboard.
   * Uses prisma.groupBy wherever Prisma supports it; falls back to $queryRaw
   * only for the NULL-coalescing authMethods breakdown where Prisma groupBy
   * returns null keys that we want to remap to 'password'.
   */
  async breakdowns(): Promise<AdminBreakdowns> {
    const [
      byCountryRaw,
      byStatus,
      byRole,
      byIdentityStatus,
      byReason,
      byTargetType,
      byOAuthProvider,
      usersTotal,
      emailVerifiedCount,
      identitySubmittedCount,
      identityApprovedCount,
    ] = await Promise.all([
      // countryCode: group, map null -> '', sort desc, top 8.
      this.prisma.user.groupBy({
        by: ['countryCode'],
        _count: { _all: true },
        orderBy: { _count: { countryCode: 'desc' } },
        take: 8,
      }),
      this.prisma.user.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['role'],
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['identityStatus'],
        _count: { _all: true },
      }),
      this.prisma.report.groupBy({
        by: ['reason'],
        _count: { _all: true },
        orderBy: { _count: { reason: 'desc' } },
      }),
      this.prisma.report.groupBy({
        by: ['targetType'],
        _count: { _all: true },
        orderBy: { _count: { targetType: 'desc' } },
      }),
      // oauthProvider is nullable; groupBy returns null for password accounts.
      this.prisma.user.groupBy({
        by: ['oauthProvider'],
        _count: { _all: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerified: true } }),
      // identitySubmitted = any status other than not_submitted.
      this.prisma.user.count({ where: { identityStatus: { in: ['pending', 'approved', 'rejected'] } } }),
      this.prisma.user.count({ where: { identityStatus: 'approved' } }),
    ]);

    return {
      usersByCountry: byCountryRaw.map((r) => ({
        code: r.countryCode ?? '',
        count: r._count._all,
      })),
      usersByStatus: byStatus.map((r) => ({
        status: r.status as 'active' | 'suspended' | 'banned',
        count: r._count._all,
      })),
      usersByRole: byRole.map((r) => ({
        role: r.role as 'user' | 'moderator' | 'admin',
        count: r._count._all,
      })),
      identityDistribution: byIdentityStatus.map((r) => ({
        status: r.identityStatus as 'not_submitted' | 'pending' | 'approved' | 'rejected',
        count: r._count._all,
      })),
      reportsByReason: byReason.map((r) => ({
        reason: r.reason as string,
        count: r._count._all,
      })),
      reportsByTarget: byTargetType.map((r) => ({
        targetType: r.targetType as string,
        count: r._count._all,
      })),
      authMethods: byOAuthProvider.map((r) => ({
        // null oauthProvider means the account was created with email+password.
        method: (r.oauthProvider ?? 'password') as 'password' | 'google' | 'facebook' | 'apple',
        count: r._count._all,
      })),
      funnel: {
        registered: usersTotal,
        emailVerified: emailVerifiedCount,
        identitySubmitted: identitySubmittedCount,
        identityApproved: identityApprovedCount,
      },
    };
  }

  // ── Invitation / Settings (§5.3) ──────────────────────────────────────────

  /**
   * GET /admin/settings
   * Reads the three invite-related settings from the write-through Redis cache.
   */
  async getSettings(): Promise<{
    registrationMode: string;
    defaultInviteQuota: number;
    inviteExpiryDays: number;
    adminMfaRequired: boolean;
    adminFullVisibility: boolean;
    adminFullVisibilityUntil: string | null;
    globalFullVisibility: boolean;
    videoEnabled: boolean;
    digestEnabled: boolean;
    profileReminderEnabled: boolean;
    diasporaContactRestriction: boolean;
    diasporaContentSplit: boolean;
    diasporaUnknownCountryRestricted: boolean;
  }> {
    const [
      registrationMode,
      defaultInviteQuota,
      inviteExpiryDays,
      adminMfaRequired,
      adminFullVisibility,
      adminFullVisibilityUntil,
      globalFullVisibility,
      videoEnabled,
      digestEnabled,
      profileReminderEnabled,
      diasporaContactRestriction,
      diasporaContentSplit,
      diasporaUnknownCountryRestricted,
    ] = await Promise.all([
      this.settings.getRegistrationMode(),
      this.settings.getDefaultInviteQuota(),
      this.settings.getInviteExpiryDays(),
      this.settings.getSetting('admin_mfa_required', 'false'),
      this.settings.isFullVisibilityActive(),
      this.settings.fullVisibilityUntil(),
      this.settings.isGlobalFullVisibility(),
      this.settings.isVideoEnabled(),
      this.settings.isDigestEnabled(),
      this.settings.isProfileReminderEnabled(),
      this.settings.isDiasporaContactRestricted(),
      this.settings.isDiasporaContentSplit(),
      this.settings.isDiasporaUnknownCountryRestricted(),
    ]);
    return {
      registrationMode,
      defaultInviteQuota,
      inviteExpiryDays,
      adminMfaRequired: adminMfaRequired === 'true',
      adminFullVisibility,
      adminFullVisibilityUntil,
      globalFullVisibility,
      videoEnabled,
      digestEnabled,
      profileReminderEnabled,
      diasporaContactRestriction,
      diasporaContentSplit,
      diasporaUnknownCountryRestricted,
    };
  }

  /**
   * PATCH /admin/settings
   * Writes one or more settings through SettingsService (DB + Redis write-through).
   */
  async patchSettings(
    dto: {
      registrationMode?: string;
      defaultInviteQuota?: number;
      inviteExpiryDays?: number;
      adminMfaRequired?: boolean;
      adminFullVisibility?: boolean;
      globalFullVisibility?: boolean;
      videoEnabled?: boolean;
      digestEnabled?: boolean;
      profileReminderEnabled?: boolean;
      diasporaContactRestriction?: boolean;
      diasporaContentSplit?: boolean;
      diasporaUnknownCountryRestricted?: boolean;
    },
    adminId: string,
  ): Promise<{
    registrationMode: string;
    defaultInviteQuota: number;
    inviteExpiryDays: number;
    adminMfaRequired: boolean;
    adminFullVisibility: boolean;
    adminFullVisibilityUntil: string | null;
    globalFullVisibility: boolean;
    videoEnabled: boolean;
    digestEnabled: boolean;
    profileReminderEnabled: boolean;
    diasporaContactRestriction: boolean;
    diasporaContentSplit: boolean;
    diasporaUnknownCountryRestricted: boolean;
  }> {
    // Anti-lockout: don't let an admin make MFA mandatory for staff unless THEY
    // have enrolled — otherwise their own next login is refused. Enforced
    // server-side (the web toggle is only a hint).
    if (dto.adminMfaRequired === true) {
      const me = await this.prisma.user.findUnique({
        where: { id: adminId },
        select: { mfaEnabled: true },
      });
      if (!me?.mfaEnabled) {
        throw new BadRequestException(
          "Active d'abord ta double authentification avant de la rendre obligatoire pour le staff.",
        );
      }
    }

    const writes: Promise<void>[] = [];
    if (dto.registrationMode !== undefined) {
      writes.push(this.settings.setSetting('registration_mode', dto.registrationMode, adminId));
    }
    if (dto.defaultInviteQuota !== undefined) {
      writes.push(this.settings.setSetting('default_invite_quota', String(dto.defaultInviteQuota), adminId));
    }
    if (dto.inviteExpiryDays !== undefined) {
      writes.push(this.settings.setSetting('invite_expiry_days', String(dto.inviteExpiryDays), adminId));
    }
    if (dto.adminMfaRequired !== undefined) {
      writes.push(
        this.settings.setSetting('admin_mfa_required', dto.adminMfaRequired ? 'true' : 'false', adminId),
      );
    }
    if (dto.adminFullVisibility !== undefined) {
      writes.push(
        this.settings.setSetting(
          'admin_full_visibility',
          dto.adminFullVisibility ? 'true' : 'false',
          adminId,
        ),
      );
      // Enabling stamps a fresh auto-expiry window; disabling clears it.
      const until = dto.adminFullVisibility
        ? new Date(Date.now() + FULL_VIS_TTL_HOURS * 3_600_000).toISOString()
        : '';
      writes.push(this.settings.setSetting('admin_full_visibility_until', until, adminId));
    }
    if (dto.globalFullVisibility !== undefined) {
      // Community-wide visibility policy (no auto-expiry — deliberate, this is
      // a durable community setting, not a support intervention). Audited via
      // the setting's updatedById.
      writes.push(
        this.settings.setSetting(
          'global_full_visibility',
          dto.globalFullVisibility ? 'true' : 'false',
          adminId,
        ),
      );
      // …et dans le journal des accès privilégiés, où l'on va chercher « qui a
      // levé une protection, et quand ». `updatedById` ne garde que l'état
      // courant : qui a remis le réglage à zéro effaçait qui l'avait activé.
      writes.push(
        this.audit.log(
          adminId,
          dto.globalFullVisibility ? 'global_full_visibility_on' : 'global_full_visibility_off',
        ),
      );
    }
    if (dto.diasporaContactRestriction !== undefined) {
      // Community policy: members living in Niger may not open contact with
      // diaspora members. ON by default — turning it OFF here lifts the rule
      // network-wide on the next request, without a deploy.
      writes.push(
        this.settings.setSetting(
          'diaspora_contact_restriction',
          dto.diasporaContactRestriction ? 'true' : 'false',
          adminId,
        ),
      );
    }
    if (dto.diasporaContentSplit !== undefined) {
      // Merges or splits the two feeds. Independent of the contact rule above:
      // one governs who may write, the other who sees what.
      writes.push(
        this.settings.setSetting(
          'diaspora_content_split',
          dto.diasporaContentSplit ? 'true' : 'false',
          adminId,
        ),
      );
    }
    if (dto.diasporaUnknownCountryRestricted !== undefined) {
      // Only affects members with NO country on file. ON closes the bypass,
      // OFF stops holding back OAuth signups that skipped the form.
      writes.push(
        this.settings.setSetting(
          'diaspora_unknown_country_restricted',
          dto.diasporaUnknownCountryRestricted ? 'true' : 'false',
          adminId,
        ),
      );
    }
    if (dto.videoEnabled !== undefined) {
      // Re-arming (or manually cutting) the stories-video kill-switch. Write-through
      // Redis makes it effective on the very next presign/create.
      writes.push(
        this.settings.setSetting('video_enabled', dto.videoEnabled ? 'true' : 'false', adminId),
      );
    }
    if (dto.digestEnabled !== undefined) {
      // Re-arming (or manually cutting) the weekly-digest kill-switch. Write-through
      // Redis makes it effective on the very next cron tick (isDigestEnabled).
      writes.push(
        this.settings.setSetting('digest_enabled', dto.digestEnabled ? 'true' : 'false', adminId),
      );
    }
    if (dto.profileReminderEnabled !== undefined) {
      // Kill-switch for the one-shot "complète ton profil" email nudge — effective
      // on the very next cron tick (isProfileReminderEnabled).
      writes.push(
        this.settings.setSetting(
          'profile_reminder_enabled',
          dto.profileReminderEnabled ? 'true' : 'false',
          adminId,
        ),
      );
    }
    await Promise.all(writes);
    return this.getSettings();
  }

  /**
   * POST /admin/invitations/root
   * Generates N root invitations (inviterId = null) for the waitlist bootstrap.
   * Retries on P2002 (code collision — astronomically rare at 59 bits entropy).
   */
  async generateRootInvites(
    count: number,
    expiresInDays: number | undefined,
    _adminId: string,
    kind: 'single_use' | 'reusable' = 'single_use',
  ): Promise<Array<{ code: string; url: string; expiresAt: Date | null }>> {
    const expiresAt = expiresInDays != null ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
    const results: Array<{ code: string; url: string; expiresAt: Date | null }> = [];

    for (let i = 0; i < count; i++) {
      let created = false;
      for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
        const code = generateBase62Code();
        try {
          const inv = await this.prisma.invitation.create({
            data: { code, inviterId: null, expiresAt, kind },
          });
          results.push({
            code: inv.code,
            url: `${INVITE_URL_BASE}/${inv.code}`,
            expiresAt: inv.expiresAt,
          });
          created = true;
          break;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            this.logger.warn(`Root invite code collision on attempt ${attempt + 1}, retrying`);
            continue;
          }
          throw e;
        }
      }
      if (!created) {
        throw new Error(`Failed to generate unique code for invitation ${i + 1} after retries`);
      }
    }

    return results;
  }

  /**
   * GET /admin/invitations/metrics
   * Funnel counts + K-factor + top 10 inviters.
   *
   * K-factor = average number of new users generated per inviter in the accepted
   * cohort. Mathematically: total accepted / number of distinct non-null inviters.
   * K > 1 means the referral loop is self-sustaining.
   */
  async inviteMetrics(): Promise<{
    sent: number;
    accepted: number;
    pending: number;
    expired: number;
    revoked: number;
    conversionRate: number;
    kFactor: number;
    topInviters: Array<{ name: string; count: number }>;
  }> {
    // v2 réseau : on compte les inscriptions RÉELLES via user.invitedById, pas
    // invitation.status='accepted'. Un lien reusable reste 'pending' à vie tout
    // en générant N filleuls — le compter par statut sous-estimerait fortement
    // conversion et K-factor. La source de vérité du « filleul inscrit » est la
    // ligne User (invitedById posé au register, lien OU code).
    const [sent, accepted, pending, expired, revoked] = await Promise.all([
      // Total invitations ever created by users (non-root)
      this.prisma.invitation.count({ where: { inviterId: { not: null } } }),
      // Filleuls réellement inscrits (single_use accepté + signups via lien reusable)
      this.prisma.user.count({ where: { invitedById: { not: null } } }),
      // Invitations encore actives (pending = single_use non consommé + liens reusable)
      this.prisma.invitation.count({ where: { status: 'pending', inviterId: { not: null } } }),
      // Expirées (legacy v1 — plus aucune nouvelle invitation n'expire en v2)
      this.prisma.invitation.count({ where: { status: 'expired' } }),
      this.prisma.invitation.count({ where: { status: 'revoked' } }),
    ]);

    // K-factor: filleuls inscrits / parrains distincts
    const distinctInvitersRaw = await this.prisma.$queryRaw<[{ cnt: bigint }]>`
      SELECT COUNT(DISTINCT invited_by_id)::bigint AS cnt
      FROM users
      WHERE invited_by_id IS NOT NULL
    `;
    const distinctInviters = Number(distinctInvitersRaw[0]?.cnt ?? 0);
    const kFactor = distinctInviters > 0 ? Math.round((accepted / distinctInviters) * 100) / 100 : 0;

    const conversionRate = sent > 0 ? Math.round((accepted / sent) * 10_000) / 100 : 0;

    // Top 10 parrains (par nombre de filleuls inscrits). Pas de fallback email
    // (PII inutile dans un payload analytics) → 'Inconnu' si pas de nom.
    const topRaw = await this.prisma.$queryRaw<Array<{ name: string | null; cnt: bigint }>>`
      SELECT COALESCE(p.display_name, p.first_name) AS name,
             COUNT(*)::bigint AS cnt
      FROM users u
      JOIN users p ON p.id = u.invited_by_id
      WHERE u.invited_by_id IS NOT NULL
      GROUP BY u.invited_by_id, p.display_name, p.first_name
      ORDER BY cnt DESC
      LIMIT 10
    `;

    return {
      sent,
      accepted,
      pending,
      expired,
      revoked,
      conversionRate,
      kFactor,
      topInviters: topRaw.map((r) => ({ name: r.name ?? 'Inconnu', count: Number(r.cnt) })),
    };
  }

  /**
   * PATCH /admin/users/:id/bulk-invite
   * Accorde ou retire le droit de générer des liens d'invitation réutilisables
   * (lien de masse). Admin-only. Idempotent.
   *
   * Sécurité : retirer le droit ne suffit pas — un lien `reusable` déjà émis reste
   * 'pending' (= actif) et continue d'onboarder des comptes indéfiniment, ce qui
   * laisse le vecteur d'abus ouvert alors même qu'on vient de retirer le droit.
   * On révoque donc atomiquement les liens reusable encore actifs de l'utilisateur
   * en même temps que le retrait (les `single_use` ne sont pas touchés : ce ne sont
   * pas des liens de masse).
   */
  async setBulkInviteRight(
    userId: string,
    allowed: boolean,
  ): Promise<{ id: string; canBulkInvite: boolean }> {
    if (allowed) {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { canBulkInvite: allowed },
        select: { id: true, canBulkInvite: true },
      });
      return user;
    }

    // Retrait du droit : flip + révocation des liens reusable actifs dans une
    // transaction (le retrait et la coupure du vecteur d'abus sont indivisibles).
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { canBulkInvite: false },
        select: { id: true, canBulkInvite: true },
      }),
      this.prisma.invitation.updateMany({
        where: { inviterId: userId, kind: 'reusable', status: 'pending' },
        data: { status: 'revoked', revokedAt: new Date(), targetEmail: null },
      }),
    ]);
    return user;
  }

  /**
   * GET /admin/users/search
   * Recherche d'utilisateurs par nom / email pour la gestion du badge ambassadeur.
   * Insensible à la casse ; renvoie un résumé léger (pas de données sensibles).
   */
  async searchUsers(q: string, limit: number) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        city: true,
        countryCode: true,
        identityStatus: true,
        isAmbassador: true,
        isOfficial: true,
        ambassadorSince: true,
        createdAt: true,
      },
    });
    return { items: users };
  }

  /** GET /admin/audit/full-visibility — recent privileged-access audit rows. */
  async fullVisibilityLog(limit: number) {
    return this.audit.recent(limit);
  }

  /**
   * PATCH /admin/users/:id/ambassador
   * Active/désactive le badge ambassadeur. Idempotent.
   */
  async setAmbassador(userId: string, value: boolean): Promise<{ id: string; isAmbassador: boolean }> {
    return this.prisma.user.update({
      where: { id: userId },
      // La date de nomination suit le badge : posée en même temps, effacée avec
      // lui. Sans elle la console listait les ambassadeurs sans jamais pouvoir
      // dire depuis quand — et un badge retiré puis remis doit repartir de zéro.
      data: { isAmbassador: value, ambassadorSince: value ? new Date() : null },
      select: { id: true, isAmbassador: true },
    });
  }

  // Fields surfaced to the admin user-management console. Never selects secrets
  // (passwordHash, mfaSecret, oauthProviderId, …) — those stay out of the DTO.
  private static readonly ADMIN_USER_SELECT = {
    id: true,
    email: true,
    displayName: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
    city: true,
    countryCode: true,
    role: true,
    status: true,
    statusReason: true,
    statusExpiresAt: true,
    emailVerified: true,
    identityStatus: true,
    isAmbassador: true,
    isOfficial: true,
    ambassadorSince: true,
    createdAt: true,
    lastLoginAt: true,
  } as const satisfies Prisma.UserSelect;

  /**
   * GET /admin/users — paginated, filterable list of registered users for the
   * admin console. Cursor on id; optional name/email search + status filter.
   */
  async listUsers(opts: {
    q?: string;
    status?: 'active' | 'suspended' | 'banned';
    role?: 'user' | 'moderator' | 'admin';
    emailVerified?: boolean;
    countryCode?: string;
    identityStatus?: 'not_submitted' | 'pending' | 'approved' | 'rejected';
    ambassador?: boolean;
    createdAfter?: Date;
    cursor?: string;
    limit: number;
  }) {
    // Auto-lift expired suspensions before reading so the list reflects reality
    // (a temporary suspension whose statusExpiresAt has passed is flipped back to
    // active platform-wide — see autoLiftExpiredSanctions).
    await this.autoLiftExpiredSanctions();

    const where: Prisma.UserWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.role) where.role = opts.role;
    if (opts.emailVerified !== undefined) where.emailVerified = opts.emailVerified;
    if (opts.countryCode) where.countryCode = opts.countryCode;
    if (opts.identityStatus) where.identityStatus = opts.identityStatus;
    if (opts.ambassador !== undefined) where.isAmbassador = opts.ambassador;
    if (opts.createdAfter) where.createdAt = { gte: opts.createdAfter };
    if (opts.q) {
      where.OR = [
        { displayName: { contains: opts.q, mode: 'insensitive' } },
        { firstName: { contains: opts.q, mode: 'insensitive' } },
        { lastName: { contains: opts.q, mode: 'insensitive' } },
        { email: { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: AdminService.ADMIN_USER_SELECT,
    });
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  /**
   * Block / unblock a user WITH a sanction motive + optional expiry. Suspending or
   * banning revokes their refresh tokens so no new access token can be minted; the
   * global guard then cuts off the existing access token on its next use, and login
   * already refuses these statuses. Reactivating clears the motive + expiry.
   *
   * Guards: nobody can change their OWN status here, and a moderator cannot act on
   * staff (admin/moderator) — only an admin can. Every change writes an audit row
   * (same transaction) with the motive + expiry.
   *
   * `reason` is required by the controller schema when status !== active; we still
   * only persist it for a non-active status (and null it out on reactivation).
   */
  async setUserStatus(
    actor: { id: string; role: string },
    targetId: string,
    input: {
      status: 'active' | 'suspended' | 'banned';
      reason?: string;
      expiresAt?: string | Date | null;
    },
  ): Promise<{ id: string; status: string; statusReason: string | null; statusExpiresAt: Date | null }> {
    const { status } = input;
    if (targetId === actor.id) {
      throw new ForbiddenException('Vous ne pouvez pas changer votre propre statut.');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if ((target.role === 'admin' || target.role === 'moderator') && actor.role !== 'admin') {
      throw new ForbiddenException("Seul un admin peut modifier le statut d'un membre du staff.");
    }

    // Reactivation wipes the sanction metadata; a sanction records motive + expiry.
    const statusReason = status === 'active' ? null : (input.reason ?? null);
    const statusExpiresAt =
      status === 'active' || !input.expiresAt ? null : new Date(input.expiresAt);

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.user.update({
        where: { id: targetId },
        data: { status, statusReason, statusExpiresAt },
        select: { id: true },
      }),
    ];
    if (status !== 'active') {
      // Force-logout across devices: revoke every live refresh token.
      ops.push(
        this.prisma.refreshToken.updateMany({
          where: { userId: targetId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      );
    }
    ops.push(
      this.prisma.adminAuditLog.create({
        data: {
          actorId: actor.id,
          action: `user.status.${status}`,
          targetUserId: targetId,
          meta: {
            reason: statusReason,
            expiresAt: statusExpiresAt ? statusExpiresAt.toISOString() : null,
          },
        },
      }),
    );
    await this.prisma.$transaction(ops);
    return { id: targetId, status, statusReason, statusExpiresAt };
  }

  /**
   * Flip expired temporary suspensions back to `active` and clear their sanction
   * metadata. Bounded (only rows whose statusExpiresAt has passed). Banned accounts
   * are never auto-lifted (permanent until an admin reactivates). Called on every
   * admin read of the user list / a single user detail. Pass a userId to scope the
   * sweep to one account (detail view).
   */
  private async autoLiftExpiredSanctions(userId?: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: {
        ...(userId ? { id: userId } : {}),
        status: 'suspended',
        statusExpiresAt: { not: null, lt: new Date() },
      },
      data: { status: 'active', statusReason: null, statusExpiresAt: null },
    });
  }

  /** Loads a target user or throws 404. Selects nothing sensitive. */
  private async assertTargetExists(targetId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
  }

  // Detailed profile fields for the admin user drawer. NEVER selects secrets
  // (passwordHash, mfaSecret, oauthProviderId, newsletterToken, …).
  private static readonly ADMIN_USER_DETAIL_SELECT = {
    id: true,
    email: true,
    phone: true,
    displayName: true,
    firstName: true,
    lastName: true,
    avatarUrl: true,
    coverUrl: true,
    bio: true,
    city: true,
    countryCode: true,
    role: true,
    status: true,
    statusReason: true,
    statusExpiresAt: true,
    emailVerified: true,
    phoneVerified: true,
    identityStatus: true,
    isAmbassador: true,
    isOfficial: true,
    ambassadorSince: true,
    mfaEnabled: true,
    canBulkInvite: true,
    privacyLevel: true,
    showOnMap: true,
    proximityAlerts: true,
    lastLoginAt: true,
    lastLoginIp: true,
    createdAt: true,
    updatedAt: true,
    invitedBy: { select: { id: true, displayName: true } },
  } as const satisfies Prisma.UserSelect;

  /**
   * GET /admin/users/:id/detail — full moderator/admin view of one account:
   * profile + sanction state + counters (posts, comments, reports received/sent),
   * invitation stats, and the live sessions/devices. No secrets are ever selected.
   */
  async getUserDetail(targetId: string) {
    // Reflect an elapsed suspension before we render the sanction state.
    await this.autoLiftExpiredSanctions(targetId);

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: AdminService.ADMIN_USER_DETAIL_SELECT,
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const now = new Date();
    const [
      posts,
      comments,
      reportsReceived,
      reportsMade,
      invitesSent,
      invitesAccepted,
      sessions,
    ] = await Promise.all([
      this.prisma.post.count({ where: { authorId: targetId, deletedAt: null } }),
      this.prisma.comment.count({ where: { authorId: targetId, deletedAt: null } }),
      // Reports whose target is THIS user (generic targetType/targetId pair).
      this.prisma.report.count({ where: { targetType: 'user', targetId } }),
      this.prisma.report.count({ where: { reporterId: targetId } }),
      this.prisma.invitation.count({ where: { inviterId: targetId } }),
      // Filleuls réellement inscrits (source de vérité : User.invitedById).
      this.prisma.user.count({ where: { invitedById: targetId } }),
      // Live sessions = non-revoked, non-expired refresh tokens (one per device).
      this.prisma.refreshToken.findMany({
        where: { userId: targetId, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true, deviceName: true, createdAt: true, usedAt: true, expiresAt: true },
        orderBy: { usedAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      ...user,
      counts: { posts, comments, reportsReceived, reportsMade },
      invitations: { sent: invitesSent, accepted: invitesAccepted },
      sessions,
    };
  }

  /**
   * GET /admin/users/:id/audit — the sensitive-action audit trail for one user
   * (status/sanction, force-logout, MFA reset). Admin-only. Newest first.
   */
  async getUserAudit(targetId: string, limit: number) {
    return this.prisma.adminAuditLog.findMany({
      where: { targetUserId: targetId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * POST /admin/users/:id/force-logout — revoke every live refresh token so all
   * the user's devices are logged out on their next token refresh (the global
   * guard also cuts the current access token within its short cache TTL). Records
   * an audit row with the revoked count. Admin-only.
   */
  async forceLogout(actor: { id: string }, targetId: string): Promise<{ revoked: number }> {
    if (targetId === actor.id) {
      throw new ForbiddenException('Déconnecte-toi via ton propre compte, pas via la console admin.');
    }
    await this.assertTargetExists(targetId);
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        action: 'user.force_logout',
        targetUserId: targetId,
        meta: { revoked: revoked.count },
      },
    });
    return { revoked: revoked.count };
  }

  /**
   * POST /admin/users/:id/reset-mfa — clear the user's TOTP enrollment (secret +
   * recovery codes) so a member who lost their authenticator can re-enroll on next
   * login. Records an audit row. Admin-only. Does NOT touch the account status.
   *
   * NOTE: `resend-verification` is intentionally NOT implemented here — the email
   * token + mailer brick lives in the auth module (out of this module's scope /
   * not injected). TODO(auth): expose an admin resend-verification hook.
   */
  async resetMfa(actor: { id: string }, targetId: string): Promise<{ id: string; mfaEnabled: false }> {
    if (targetId === actor.id) {
      throw new ForbiddenException('Gère ton propre MFA via les paramètres de ton compte.');
    }
    await this.assertTargetExists(targetId);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetId },
        data: { mfaEnabled: false, mfaSecret: null },
        select: { id: true },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: targetId } }),
      this.prisma.adminAuditLog.create({
        data: { actorId: actor.id, action: 'user.reset_mfa', targetUserId: targetId },
      }),
    ]);
    return { id: targetId, mfaEnabled: false };
  }

  /**
   * Edit a user's profile fields and/or role (admin-only). Email is intentionally
   * NOT editable here (it's the auth identity). A user cannot change their OWN
   * role (anti-lockout). Only the provided keys are written.
   */
  async updateUser(
    actor: { id: string; role: string },
    targetId: string,
    dto: {
      displayName?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      city?: string | null;
      countryCode?: string | null;
      bio?: string | null;
      role?: 'user' | 'moderator' | 'admin';
    },
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, email: true, emailVerified: true, firstName: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (dto.role !== undefined && targetId === actor.id) {
      throw new ForbiddenException('Vous ne pouvez pas changer votre propre rôle.');
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.role !== undefined) data.role = dto.role;

    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data,
      select: AdminService.ADMIN_USER_SELECT,
    });

    // A role change was, until now, completely silent: no audit row, no word to
    // the person. Both matter — the trace for anyone auditing later, the notice
    // for the person who suddenly holds moderation powers (and who is the only
    // one able to say "I never asked for this").
    if (dto.role !== undefined && dto.role !== target.role) {
      await this.prisma.adminAuditLog
        .create({
          data: {
            actorId: actor.id,
            action: 'user.role_change',
            targetUserId: targetId,
            meta: { from: target.role, to: dto.role },
          },
        })
        .catch(() => undefined);
      await this.announceRoleChange(target, dto.role);
    }

    return updated;
  }

  /**
   * Tell a member their role changed: in-app notification (never expires — it is
   * an account event, not a feed item) plus an email when we hold a verified
   * address. Best-effort on both channels: a mail outage must not roll back a
   * role the admin already granted.
   */
  private async announceRoleChange(
    target: { id: string; email: string | null; emailVerified: boolean; firstName: string | null },
    role: 'user' | 'moderator' | 'admin',
  ): Promise<void> {
    const granted = role === 'admin' || role === 'moderator';
    const label = role === 'admin' ? 'administrateur' : 'modérateur';
    await this.notifications
      .create({
        userId: target.id,
        type: 'system',
        title: granted ? `Tu es ${label} 🛡️` : 'Tes droits ont changé',
        body: granted
          ? "L'équipe NigerConnect t'a confié des responsabilités sur la plateforme."
          : "Tes droits d'équipe ont été retirés. Ton compte reste actif.",
        expiresInHours: null,
      })
      .catch((e) => this.logger.warn(`role-change notification failed: ${String(e)}`));

    if (granted && target.email && target.emailVerified) {
      await this.mailer
        .sendRoleGranted(target.email, role, target.firstName)
        .catch((e) => this.logger.warn(`role-change email failed: ${String(e)}`));
    }
  }

  /**
   * Permanently delete a user (admin-only). Reuses ProfileService.deleteAccount so
   * the cascade (posts, messages, …) + S3 asset cleanup is identical to
   * self-service RGPD deletion. Cannot delete your own account from here.
   */
  async deleteUser(actor: { id: string }, targetId: string): Promise<void> {
    if (targetId === actor.id) {
      throw new ForbiddenException('Vous ne pouvez pas supprimer votre propre compte ici.');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    await this.profile.deleteAccount(targetId);
  }

  /**
   * GET /admin/referrals
   * Arbre de parrainage (vue plate paginée) : chaque membre récemment inscrit
   * avec SON parrain et le type d'invitation utilisé. Curseur sur user.id.
   *
   * `q` (optionnel) filtre les lignes dont l'email du FILLEUL ou du PARRAIN
   * matche (contains, insensible à la casse). L'email sert uniquement au filtre
   * serveur — il n'est jamais renvoyé par cette vue (parité avec la vue publique
   * du réseau de parrainage, qui n'expose que displayName/avatar).
   */
  async listReferrals(
    limit: number,
    cursor?: string,
    q?: string,
  ): Promise<{
    items: Array<{
      id: string;
      displayName: string | null;
      avatarUrl: string | null;
      createdAt: Date;
      invitedBy: { id: string; displayName: string | null } | null;
      via: { kind: string } | null;
      inviteesCount: number;
    }>;
    nextCursor: string | null;
  }> {
    const where: Prisma.UserWhereInput = { invitedById: { not: null } };
    if (q) {
      // Match sur l'email du filleul (la ligne = le User) OU du parrain (relation).
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { invitedBy: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
        invitedBy: { select: { id: true, displayName: true } },
        invitedVia: { select: { kind: true } },
        _count: { select: { invitees: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        createdAt: u.createdAt,
        invitedBy: u.invitedBy ? { id: u.invitedBy.id, displayName: u.invitedBy.displayName } : null,
        via: u.invitedVia ? { kind: u.invitedVia.kind } : null,
        inviteesCount: u._count.invitees,
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  /**
   * Returns an array of 'YYYY-MM-DD' strings in UTC, ascending, covering the
   * last `days` days (today = last element).
   */
  private buildDateAxis(days: number): string[] {
    const axis: string[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 3_600_000);
      axis.push(this.toDateKey(d));
    }
    return axis;
  }

  /** Format a Date as 'YYYY-MM-DD' using UTC components. */
  private toDateKey(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Identity review queue. Returns pending (or filtered) documents with the
   * submitter summary and a SHORT-lived presigned GET so the reviewer can view
   * the scan without the private bucket ever being public. URLs are never
   * persisted or logged.
   */
  async listIdentityDocuments(status: 'pending' | 'approved' | 'rejected', limit: number, cursor?: string) {
    const docs = await this.prisma.identityDocument.findMany({
      where: { status },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'asc' }, // oldest first — FIFO review queue
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            city: true,
            countryCode: true,
            identityStatus: true,
            createdAt: true,
          },
        },
      },
    });
    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;

    const items = await Promise.all(
      page.map(async (d) => ({
        id: d.id,
        userId: d.userId,
        documentType: d.documentType,
        status: d.status,
        createdAt: d.createdAt,
        rejectionReason: d.rejectionReason,
        viewUrl: await this.presignDoc(d.fileUrl),
        user: d.user,
      })),
    );
    return { items, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  /**
   * File de rattrapage 18+ : les comptes VALIDÉS sans date de naissance.
   *
   * La requête part des UTILISATEURS, pas des documents. Un compte dont le
   * document a été détruit ou archivé n'a plus de ligne à interroger : en
   * partant des documents, ces membres — précisément ceux qui ont perdu l'accès
   * à la proximité — restaient invisibles ici. Le document validé, quand il
   * existe encore, n'est joint que pour donner le lien de consultation.
   */
  async listApprovedMissingDob(limit: number, cursor?: string) {
    const users = await this.prisma.user.findMany({
      // Une dérogation en cours règle déjà le cas : le compte sort de la file.
      where: { identityStatus: 'approved', dateOfBirth: null, adultOverrideAt: null },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        city: true,
        countryCode: true,
        identityStatus: true,
        createdAt: true,
      },
    });
    const hasMore = users.length > limit;
    const page = hasMore ? users.slice(0, limit) : users;
    const items = await Promise.all(
      page.map(async (user) => {
        const doc = await this.prisma.identityDocument.findFirst({
          where: { userId: user.id, status: 'approved' },
          orderBy: { reviewedAt: 'desc' },
          select: { id: true, documentType: true, status: true, fileUrl: true, createdAt: true },
        });
        return {
          // Pas de document survivant → on retombe sur l'id du compte, seule
          // clé stable pour l'écran d'administration.
          id: doc?.id ?? user.id,
          userId: user.id,
          documentType: doc?.documentType ?? 'purgé',
          status: doc?.status ?? 'approved',
          createdAt: doc?.createdAt ?? user.createdAt,
          viewUrl: doc ? await this.presignDoc(doc.fileUrl) : null,
          user,
        };
      }),
    );
    return { items, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  /**
   * Enregistre la date de naissance d'un membre déjà validé (rattrapage 18+).
   *
   * Écrit sur le COMPTE — c'est la source de vérité du contrôle de majorité,
   * celle qui survit à la purge du document — et recopie sur le document validé
   * s'il en reste un, pour que l'enveloppe d'archive reste complète. Ne touche
   * pas au statut : le membre était vérifié, il le reste.
   */
  async setApprovedDob(userId: string, dateOfBirth: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { identityStatus: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.identityStatus !== 'approved') {
      throw new BadRequestException('User is not identity-verified');
    }
    // @db.Date : minuit UTC, sinon le fuseau décale d'un jour.
    const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
    const doc = await this.prisma.identityDocument.findFirst({
      where: { userId, status: 'approved' },
      orderBy: { reviewedAt: 'desc' },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { dateOfBirth: dob } }),
      ...(doc
        ? [this.prisma.identityDocument.update({ where: { id: doc.id }, data: { dateOfBirth: dob } })]
        : []),
    ]);
  }

  /**
   * Accorde une dérogation de majorité à un profil connu de l'admin.
   *
   * Sert le cas où la date de naissance est définitivement perdue : le document
   * a été purgé au bout de 30 jours et rien ne permet de la reconstituer. Plutôt
   * que de laisser un membre vérifié de longue date bloqué sans explication, un
   * admin atteste sa majorité — en laissant son nom, la date et un motif.
   *
   * Refusée quand une date existe déjà : il n'y a alors rien à déroger, et
   * accepter reviendrait à offrir un moyen de passer outre une date qui dit
   * « mineur ».
   */
  async grantAdultOverride(adminId: string, userId: string, reason: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { identityStatus: true, dateOfBirth: true, adultOverrideAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.identityStatus !== 'approved') {
      // La dérogation porte sur la majorité, pas sur l'identité : on ne
      // court-circuite pas la vérification elle-même.
      throw new BadRequestException('User is not identity-verified');
    }
    if (user.dateOfBirth) {
      throw new BadRequestException('User already has a date of birth — nothing to waive');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        adultOverrideAt: new Date(),
        adultOverrideById: adminId,
        adultOverrideReason: reason,
      },
    });
    await this.audit.log(adminId, 'adult_override_grant', userId);
    this.logger.warn(`Admin ${adminId} waived the 18+ proof for user ${userId}: ${reason}`);
  }

  /** Retire une dérogation : le membre repasse sous le contrôle 18+ normal. */
  async revokeAdultOverride(adminId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { adultOverrideAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.adultOverrideAt) throw new BadRequestException('No adult override on this user');
    await this.prisma.user.update({
      where: { id: userId },
      data: { adultOverrideAt: null, adultOverrideById: null, adultOverrideReason: null },
    });
    await this.audit.log(adminId, 'adult_override_revoke', userId);
  }

  // ── A5 — association certification ────────────────────────────────────

  /**
   * Grant the "Association vérifiée" badge. `Association.isVerified` existed
   * in the schema with no endpoint ever setting it — a badge nobody can
   * revoke or account for is a liability, not a feature. Traced via
   * verifiedAt/verifiedById/verificationNote on the row AND an admin audit
   * log entry, same as `updateUser`'s role-change trail above.
   */
  async verifyAssociation(actor: { id: string }, associationId: string, note?: string) {
    const assoc = await this.prisma.association.findFirst({
      where: { id: associationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!assoc) throw new NotFoundException('Association not found');

    const updated = await this.prisma.association.update({
      where: { id: associationId },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
        verifiedById: actor.id,
        verificationNote: note ?? null,
      },
    });
    await this.prisma.adminAuditLog
      .create({
        data: {
          actorId: actor.id,
          action: 'association.verified',
          meta: { associationId, name: assoc.name, note: note ?? null },
        },
      })
      .catch(() => undefined);
    return updated;
  }

  /** Revoke it. Same trace, cleared badge (verifiedAt/verifiedById back to null). */
  async unverifyAssociation(actor: { id: string }, associationId: string, note?: string) {
    const assoc = await this.prisma.association.findFirst({
      where: { id: associationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!assoc) throw new NotFoundException('Association not found');

    const updated = await this.prisma.association.update({
      where: { id: associationId },
      data: {
        isVerified: false,
        verifiedAt: null,
        verifiedById: null,
        verificationNote: note ?? null,
      },
    });
    await this.prisma.adminAuditLog
      .create({
        data: {
          actorId: actor.id,
          action: 'association.unverified',
          meta: { associationId, name: assoc.name, note: note ?? null },
        },
      })
      .catch(() => undefined);
    return updated;
  }

  /** Turn an `s3://<privateBucket>/<key>` pointer into a short presigned GET. */
  private async presignDoc(fileUrl: string | null): Promise<string | null> {
    // Manual verifications carry no uploaded piece (fileUrl null) → nothing to presign.
    if (!fileUrl) return null;
    const prefix = `s3://${this.privateBucket}/`;
    if (!fileUrl.startsWith(prefix)) return null;
    const key = fileUrl.slice(prefix.length).split(/[?#]/)[0];
    if (!key) return null;
    try {
      return await this.s3.createPresignedDownload(key, 300);
    } catch (err) {
      this.logger.warn(`Failed to presign identity doc: ${String(err)}`);
      return null;
    }
  }
}
