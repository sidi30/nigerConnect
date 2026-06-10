import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Env } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';

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
      identity: { pending: identityPending, approved: identityApproved, rejected: identityRejected },
      content: { posts, posts7d, messages24h, comments },
      moderation: { reportsPending, resolved7d },
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

  /** Turn an `s3://<privateBucket>/<key>` pointer into a short presigned GET. */
  private async presignDoc(fileUrl: string): Promise<string | null> {
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
