import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MfaService } from '../auth/mfa.service';
import { AdminAuditService } from '../common/audit/audit.service';
import { geocode, resolveCityCentroid } from '../common/geo/city-coords';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

/**
 * "Bris de glace" window: once an admin has proven a live TOTP, the REAL GPS
 * position is served for this long, then the window closes on its own (Redis
 * TTL). Short on purpose — this exists for the member-in-danger case, not for
 * browsing.
 */
const PRECISE_TTL_MINUTES = 30;

/**
 * A `proximityUpdatedAt` older than this is NOT served as GPS: the phone has
 * moved since, so the point would be a confident-looking lie. We fall back to
 * the city pin (`precision: 'city'`) rather than show a stale metre-accurate
 * marker. 24 h matches the proximity matcher's own freshness horizon.
 */
const GPS_FRESHNESS_HOURS = 24;

/** The map refetches on every pan — collapse the audit to one row per window. */
const AUDIT_DEBOUNCE_SECONDS = 300;

/** Brute-forcing a 6-digit TOTP is 10^6 tries; cap the attempts per admin. */
const UNLOCK_MAX_FAILURES = 5;
const UNLOCK_FAILURE_WINDOW_SECONDS = 900;

/** ISO-3166-1 alpha-2 for Niger — same rule as DiasporaPolicyService. */
const HOME_COUNTRY = 'NE';

/** `city` is free text; a dropdown longer than this is not a dropdown. */
const FACET_CITY_LIMIT = 200;

export type MapPrecision = 'city' | 'gps';
export type MemberSide = 'diaspora' | 'niger';

/**
 * Where the point on the map actually comes from.
 *
 *   'stored'  — a column on the member (the city pin they registered with, or,
 *               inside the break-glass window, the GPS ping).
 *   'city'    — nothing stored, but their city + country resolved to a centroid.
 *   'country' — we only know the country; this is its geographic centre.
 *   null      — unplaceable.
 *
 * `precision` stays the gps-vs-city discriminator the front already codes
 * against; it is this field, not `precision`, that says how much to trust the
 * marker. A 'country' point is a whole nation wide — it must never be read as
 * "this member is in Niamey".
 */
export type PositionSource = 'stored' | 'city' | 'country';

export interface MapUser {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  precision: MapPrecision | null;
  positionSource: PositionSource | null;
  positionUpdatedAt: string | null;
  status: 'active' | 'suspended' | 'banned';
  identityStatus: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  isAmbassador: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  privacyLevel: 'public' | 'friends' | 'private';
  side: MemberSide;
  lastSeenAt: string | null;
  createdAt: string;
  counts: { posts: number; friends: number };
}

export interface MapUserDetail extends MapUser {
  email: string | null;
  phone: string | null;
  bio: string | null;
  languages: string[];
  invitedBy: { id: string; displayName: string | null } | null;
  inviteesCount: number;
  lastLoginAt: string | null;
  /** Last 5 device sessions (live or expired refresh tokens), most recent first. */
  recentSessions: Array<{
    id: string;
    deviceName: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
}

export interface MapUserPage {
  items: MapUser[];
  nextCursor: string | null;
  /** Members matching the filters — the whole set, not this page. */
  total: number;
  /**
   * Of those, how many cannot be placed AT ALL: no stored coordinates, no
   * resolvable city, and no country centroid either. A member with just
   * "Niamey / NE" is placeable and is NOT counted here.
   */
  withoutPosition: number;
}

/** Filter dropdown contents, built from what is actually in the database. */
export interface MapFacets {
  countries: Array<{ code: string; count: number }>;
  cities: Array<{ city: string; countryCode: string | null; count: number }>;
  statuses: Array<{ value: 'active' | 'suspended' | 'banned'; count: number }>;
}

export interface PreciseWindow {
  active: boolean;
  until: string | null;
}

export interface MapUserFilters {
  q?: string;
  countryCode?: string;
  city?: string;
  status?: 'active' | 'suspended' | 'banned';
  identityStatus?: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  ambassador?: boolean;
  privacyLevel?: 'public' | 'friends' | 'private';
  side?: MemberSide;
  activeWithinDays?: number;
  hasPosition?: boolean;
}

export interface MapUserListOptions extends MapUserFilters {
  cursor?: string;
  limit: number;
}

/**
 * Columns shared by the map list and the map detail. `latitude`/`longitude` are
 * the PUBLIC position (city centroid + jitter) — the same point the mobile map
 * shows. The GPS columns are never in here; they are added at query time, and
 * only while the break-glass window is open (see `positionSelect`).
 */
const MAP_USER_SELECT = {
  id: true,
  displayName: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  city: true,
  countryCode: true,
  latitude: true,
  longitude: true,
  status: true,
  identityStatus: true,
  isAmbassador: true,
  emailVerified: true,
  phoneVerified: true,
  privacyLevel: true,
  lastSeenAt: true,
  createdAt: true,
  _count: {
    select: {
      posts: { where: { deletedAt: null } },
      friendshipsSent: { where: { status: 'accepted' as const } },
      friendshipsReceived: { where: { status: 'accepted' as const } },
    },
  },
} as const satisfies Prisma.UserSelect;

/**
 * Row shape consumed by `toMapUser`. The three proximity fields are OPTIONAL on
 * purpose: outside the break-glass window they are not part of the SELECT, so
 * they are absent from the row object entirely — there is no intermediate value
 * to leak.
 */
interface MapUserRow {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  status: 'active' | 'suspended' | 'banned';
  identityStatus: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  isAmbassador: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  privacyLevel: 'public' | 'friends' | 'private';
  lastSeenAt: Date | null;
  createdAt: Date;
  proximityLat?: Prisma.Decimal | null;
  proximityLon?: Prisma.Decimal | null;
  proximityUpdatedAt?: Date | null;
  _count: { posts: number; friendshipsSent: number; friendshipsReceived: number };
}

/**
 * Admin members map.
 *
 * This console deliberately sees EVERY member — private accounts, suspended and
 * banned ones, and both sides of the diaspora/Niger content split. None of the
 * product-level privacy gates apply here: an administrator moderating the
 * network must be able to see who is on it. What it does NOT get for free is the
 * real GPS position; that stays behind the break-glass window below, and every
 * god-mode read leaves an audit row.
 */
@Injectable()
export class AdminMapService {
  private readonly logger = new Logger(AdminMapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mfa: MfaService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── Break-glass: real GPS position ────────────────────────────────────────

  /** GET /admin/map/precise-location — is the window open for THIS admin? */
  async preciseWindow(adminId: string): Promise<PreciseWindow> {
    let until: string | null;
    try {
      until = await this.redis.client.get(this.windowKey(adminId));
    } catch (e) {
      // Fail CLOSED: if we can't prove the window is open, it isn't.
      this.logger.warn(`precise-location window read failed: ${String(e)}`);
      return { active: false, until: null };
    }
    if (!until) return { active: false, until: null };
    // Redis' TTL is what actually closes the window; this second check only
    // makes sure a leftover value can never widen it.
    if (!(Date.parse(until) > Date.now())) return { active: false, until: null };
    return { active: true, until };
  }

  /**
   * POST /admin/map/precise-location — open the window for THIS admin only.
   *
   * Requires a live TOTP and a written motive. The key is per-admin (never a
   * global setting): unlocking for yourself must not unlock for the whole staff.
   */
  async unlockPreciseLocation(
    adminId: string,
    code: string,
    reason: string,
  ): Promise<PreciseWindow> {
    const me = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { mfaEnabled: true },
    });
    if (!me?.mfaEnabled) {
      throw new BadRequestException(
        "Active d'abord ta double authentification : la position GPS ne se déverrouille qu'avec un code authenticator.",
      );
    }

    const failKey = this.failureKey(adminId);
    const failures = Number((await this.redis.get(failKey)) ?? 0);
    if (failures >= UNLOCK_MAX_FAILURES) {
      throw new HttpException(
        'Trop de codes incorrects. Réessaie dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!(await this.mfa.verifyForUser(adminId, code))) {
      await this.redis.incrementCounter(failKey, UNLOCK_FAILURE_WINDOW_SECONDS);
      // 401, and nothing else happens — no window, no partial state.
      throw new UnauthorizedException('Code incorrect.');
    }
    await this.redis.del(failKey);

    const until = new Date(Date.now() + PRECISE_TTL_MINUTES * 60_000).toISOString();
    await this.redis.client.set(
      this.windowKey(adminId),
      until,
      'EX',
      PRECISE_TTL_MINUTES * 60,
    );

    // Two trails on purpose: AdminAccessLog is where one looks for "who lifted a
    // protection" (it already holds the map/profile overrides), and AdminAuditLog
    // is the only one with a `meta` column — so it carries the written motive.
    await this.audit.log(adminId, 'precise_location_unlock');
    await this.writeMotive(adminId, 'map.precise_location.unlock', { reason, until });

    return { active: true, until };
  }

  /** DELETE /admin/map/precise-location — close the window now. */
  async revokePreciseLocation(adminId: string): Promise<PreciseWindow> {
    await this.redis.del(this.windowKey(adminId));
    await this.audit.log(adminId, 'precise_location_revoke');
    await this.writeMotive(adminId, 'map.precise_location.revoke', {});
    return { active: false, until: null };
  }

  // ── Map reads ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/map/users — filtered, cursor-paginated members with their map
   * position.
   *
   * Every filter is part of the Prisma `where`, never applied to the page after
   * the fact: dropping rows afterwards returns short pages and a cursor pointing
   * at a row the caller never saw. `total` and `withoutPosition` are counted
   * with the same clause, so the three numbers always agree.
   */
  async listUsers(adminId: string, filters: MapUserListOptions): Promise<MapUserPage> {
    const where = AdminMapService.buildWhere(filters);
    const precise = await this.preciseWindow(adminId);

    const [rows, total, unplacedGroups] = await Promise.all([
      this.prisma.user.findMany({
        where,
        take: filters.limit + 1,
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
        // Tie-break on the unique id so the cursor lands on exactly one row even
        // when several members registered in the same millisecond.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { ...MAP_USER_SELECT, ...AdminMapService.positionSelect(precise.active) },
      }),
      this.prisma.user.count({ where }),
      // "Can this be geocoded?" is a JS question, so it cannot be a COUNT. We
      // group the coordinate-less members by their (city, country) pair instead
      // — a handful of distinct pairs, whatever the member count — and only run
      // the resolver once per pair. Still one round-trip, still the same filters.
      this.prisma.user.groupBy({
        by: ['city', 'countryCode'],
        where: { AND: [where, AdminMapService.NO_STORED_POSITION] },
        _count: { _all: true },
      }),
    ]);

    const withoutPosition = unplacedGroups
      .filter((g) => AdminMapService.derivePosition(g.city, g.countryCode) === null)
      .reduce((n, g) => n + g._count._all, 0);

    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;
    const items = page.map((u) => this.toMapUser(u, precise.active));

    // Browsing the whole membership — private accounts included — is itself a
    // privileged read; serving a real GPS point is a stronger one. Both are
    // debounced, the map refetches on every pan.
    await this.logBrowse(adminId);
    if (items.some((i) => i.precision === 'gps')) await this.logPreciseRead(adminId);

    return {
      items,
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      total,
      withoutPosition,
    };
  }

  /**
   * GET /admin/map/facets — what the filter dropdowns should actually offer,
   * counted from the database rather than a frozen list.
   *
   * Each facet is computed with every active filter EXCEPT the one it drives:
   * the country list ignores `countryCode`, the city list ignores `city`, and so
   * on. Otherwise picking "France" would collapse the country dropdown to
   * France alone and there would be no way back out.
   *
   * Country NAMES are deliberately absent — the two-letter ISO code is enough,
   * the browser renders it with Intl.DisplayNames.
   */
  async facets(filters: MapUserFilters): Promise<MapFacets> {
    const [countries, cities, statuses] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['countryCode'],
        where: AdminMapService.buildWhere(filters, 'countryCode'),
        _count: { _all: true },
        orderBy: { _count: { countryCode: 'desc' } },
      }),
      this.prisma.user.groupBy({
        by: ['city', 'countryCode'],
        where: AdminMapService.buildWhere(filters, 'city'),
        _count: { _all: true },
        orderBy: { _count: { city: 'desc' } },
        // Bounded: `city` is free text, so the distinct set grows with the
        // membership. A dropdown past the top 200 is unusable anyway.
        take: FACET_CITY_LIMIT,
      }),
      this.prisma.user.groupBy({
        by: ['status'],
        where: AdminMapService.buildWhere(filters, 'status'),
        _count: { _all: true },
      }),
    ]);

    return {
      // Members who never filled in a country have no code to filter on, so they
      // get no entry — the `side: 'niger'` filter is what reaches them.
      countries: countries
        .filter((c): c is typeof c & { countryCode: string } => c.countryCode !== null)
        .map((c) => ({ code: c.countryCode, count: c._count._all })),
      cities: cities
        .filter((c): c is typeof c & { city: string } => c.city !== null)
        .map((c) => ({ city: c.city, countryCode: c.countryCode, count: c._count._all })),
      statuses: statuses.map((s) => ({ value: s.status, count: s._count._all })),
    };
  }

  /** GET /admin/map/users/:id — one member's map card, expanded. */
  async getUser(adminId: string, targetId: string): Promise<MapUserDetail> {
    const precise = await this.preciseWindow(adminId);

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        ...MAP_USER_SELECT,
        ...AdminMapService.positionSelect(precise.active),
        email: true,
        phone: true,
        bio: true,
        languages: true,
        lastLoginAt: true,
        invitedBy: { select: { id: true, displayName: true } },
        _count: { ...MAP_USER_SELECT._count, select: { ...MAP_USER_SELECT._count.select, invitees: true } },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    // Devices this account has signed in from — the same session list the user
    // console already shows, capped at the 5 most recent.
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId: targetId },
      select: { id: true, deviceName: true, createdAt: true, usedAt: true },
      orderBy: [{ usedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 5,
    });

    const base = this.toMapUser(user, precise.active);
    if (base.precision === 'gps') await this.logPreciseRead(adminId, targetId);

    return {
      ...base,
      email: user.email,
      phone: user.phone,
      bio: user.bio,
      languages: user.languages,
      invitedBy: user.invitedBy
        ? { id: user.invitedBy.id, displayName: user.invitedBy.displayName }
        : null,
      inviteesCount: user._count.invitees,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      recentSessions: sessions.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.usedAt?.toISOString() ?? null,
      })),
    };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  /**
   * The GPS columns are pulled ONLY while the window is open. Prisma drops a
   * `false` field from the generated SELECT, so outside the window those values
   * never leave Postgres — there is no object anywhere holding them.
   */
  private static positionSelect(unlocked: boolean) {
    return {
      proximityLat: unlocked,
      proximityLon: unlocked,
      proximityUpdatedAt: unlocked,
    };
  }

  /** Members with no coordinates on the row — they may still be geocodable. */
  private static readonly NO_STORED_POSITION: Prisma.UserWhereInput = {
    OR: [{ latitude: null }, { longitude: null }],
  };

  /**
   * `omit` drops one filter from the clause — used by the facets so a dropdown
   * never narrows itself out of existence.
   */
  private static buildWhere(
    f: MapUserFilters & { cursor?: string; limit?: number },
    omit?: 'countryCode' | 'city' | 'status',
  ): Prisma.UserWhereInput {
    // Composed as an AND array so a filter carrying its own OR (search, side,
    // hasPosition) can never overwrite another one's.
    const and: Prisma.UserWhereInput[] = [];

    if (f.q) {
      and.push({
        OR: [
          { displayName: { contains: f.q, mode: 'insensitive' } },
          { firstName: { contains: f.q, mode: 'insensitive' } },
          { lastName: { contains: f.q, mode: 'insensitive' } },
          { email: { contains: f.q, mode: 'insensitive' } },
        ],
      });
    }
    if (f.countryCode && omit !== 'countryCode') and.push({ countryCode: f.countryCode });
    // Free-text column (members type their own city) — substring, not equality.
    if (f.city && omit !== 'city') and.push({ city: { contains: f.city, mode: 'insensitive' } });
    if (f.status && omit !== 'status') and.push({ status: f.status });
    if (f.identityStatus) and.push({ identityStatus: f.identityStatus });
    if (f.ambassador !== undefined) and.push({ isAmbassador: f.ambassador });
    if (f.privacyLevel) and.push({ privacyLevel: f.privacyLevel });
    if (f.side) and.push(AdminMapService.sideClause(f.side));
    if (f.activeWithinDays !== undefined) {
      and.push({ lastSeenAt: { gte: new Date(Date.now() - f.activeWithinDays * 86_400_000) } });
    }
    if (f.hasPosition !== undefined) {
      // Stored coordinates specifically — "has the member a pin of their own",
      // not "can we place them", which no SQL clause can answer.
      and.push(
        f.hasPosition
          ? { latitude: { not: null }, longitude: { not: null } }
          : AdminMapService.NO_STORED_POSITION,
      );
    }

    return and.length > 0 ? { AND: and } : {};
  }

  /**
   * Same rule as DiasporaPolicyService (no country = lives in Niger), expressed
   * as a SQL clause rather than a per-member `isHomeBased` call: this list is
   * cursor-paginated, so the split has to happen inside the query.
   */
  private static sideClause(side: MemberSide): Prisma.UserWhereInput {
    return side === 'niger'
      ? { OR: [{ countryCode: null }, { countryCode: HOME_COUNTRY }] }
      : // `not: null` is required — in SQL a NULL never satisfies `<> 'NE'`.
        { countryCode: { not: null, notIn: [HOME_COUNTRY] } };
  }

  private toMapUser(row: MapUserRow, gpsUnlocked: boolean): MapUser {
    // Three tiers, most trustworthy first: the break-glass GPS ping, the pin
    // stored on the row, then a position derived from city/country. A member is
    // never dropped from the map merely because nobody stored coordinates for
    // them — that is the whole point of the fallback.
    const gps = AdminMapService.gpsPosition(row, gpsUnlocked);
    const stored =
      row.latitude !== null && row.longitude !== null
        ? { lat: Number(row.latitude), lng: Number(row.longitude) }
        : null;
    const derived = gps || stored ? null : AdminMapService.derivePosition(row.city, row.countryCode);

    const point = gps ?? stored ?? derived;
    // GPS and the stored pin are both columns on the member, hence 'stored'.
    const positionSource: PositionSource | null = point
      ? (derived?.source ?? 'stored')
      : null;

    return {
      id: row.id,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      avatarUrl: row.avatarUrl,
      city: row.city,
      countryCode: row.countryCode,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      precision: gps ? 'gps' : point ? 'city' : null,
      positionSource,
      // Only the GPS ping is timestamped; a city centroid carries no date of its
      // own, so it reports null rather than a misleading profile timestamp.
      positionUpdatedAt: gps?.at.toISOString() ?? null,
      status: row.status,
      identityStatus: row.identityStatus,
      isAmbassador: row.isAmbassador,
      emailVerified: row.emailVerified,
      phoneVerified: row.phoneVerified,
      privacyLevel: row.privacyLevel,
      side: row.countryCode && row.countryCode !== HOME_COUNTRY ? 'diaspora' : 'niger',
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      counts: {
        posts: row._count.posts,
        friends: row._count.friendshipsSent + row._count.friendshipsReceived,
      },
    };
  }

  /**
   * Place a member who has no coordinates of their own, from their declared
   * city and country. Same three-tier resolution the registration geocoder uses
   * (hardcoded diaspora table → the ~135k-city world index → country centroid),
   * so a member is invisible only when we genuinely know nowhere to put them.
   *
   * The city tier goes through `resolveCityCentroid`, which is the un-jittered
   * twin of `geocode` — a marker that wandered ±2 km on every refetch would be
   * unreadable in a console. The country tier has to go through `geocode(null,
   * cc)`, whose own ±0.25° scatter comes along with it; at country zoom that is
   * invisible, and it stops every country-only member stacking on one pixel.
   */
  private static derivePosition(
    city: string | null,
    countryCode: string | null,
  ): { lat: number; lng: number; source: Exclude<PositionSource, 'stored'> } | null {
    const centroid = resolveCityCentroid(city, countryCode);
    if (centroid) return { lat: centroid.lat, lng: centroid.lon, source: 'city' };
    // Passing a null city skips the two city tiers and lands on the country centre.
    const country = geocode(null, countryCode);
    if (country) return { lat: country.lat, lng: country.lon, source: 'country' };
    return null;
  }

  /**
   * The real position, or null. Two independent locks, on purpose: outside the
   * window the columns were never selected (so they are undefined here), AND the
   * window state is re-checked on this row. Either one alone would do; keeping
   * both means a future caller that hands over a fully-loaded User row still
   * cannot leak metre-accurate GPS. Stale pings are refused too — an old point
   * looks exact while describing where the phone no longer is.
   */
  private static gpsPosition(
    row: MapUserRow,
    unlocked: boolean,
  ): { lat: number; lng: number; at: Date } | null {
    if (!unlocked) return null;
    const { proximityLat, proximityLon, proximityUpdatedAt } = row;
    if (proximityLat == null || proximityLon == null || proximityUpdatedAt == null) return null;
    if (Date.now() - proximityUpdatedAt.getTime() > GPS_FRESHNESS_HOURS * 3_600_000) return null;
    return { lat: Number(proximityLat), lng: Number(proximityLon), at: proximityUpdatedAt };
  }

  /** Debounced audit row (≤ 1 per admin — and per target when given — per window). */
  private async logDebounced(
    key: string,
    adminId: string,
    action: 'admin_map_browse' | 'precise_location_read',
    targetId?: string,
  ): Promise<void> {
    try {
      const first = await this.redis.client.set(key, '1', 'EX', AUDIT_DEBOUNCE_SECONDS, 'NX');
      if (first === 'OK') await this.audit.log(adminId, action, targetId);
    } catch {
      /* best-effort — a logging failure never breaks the read */
    }
  }

  private logBrowse(adminId: string): Promise<void> {
    return this.logDebounced(`audit:adminmap:${adminId}`, adminId, 'admin_map_browse');
  }

  private logPreciseRead(adminId: string, targetId?: string): Promise<void> {
    const key = `audit:preciseloc:${adminId}${targetId ? `:${targetId}` : ''}`;
    return this.logDebounced(key, adminId, 'precise_location_read', targetId);
  }

  /** Records the written motive alongside the action (AdminAccessLog has no meta). */
  private async writeMotive(
    adminId: string,
    action: string,
    meta: Prisma.InputJsonObject,
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({ data: { actorId: adminId, action, meta } });
    } catch (e) {
      this.logger.warn(`precise-location motive log failed: ${String(e)}`);
    }
  }

  private windowKey(adminId: string): string {
    return `admin:map:preciseloc:${adminId}`;
  }

  private failureKey(adminId: string): string {
    return `admin:map:preciseloc:fail:${adminId}`;
  }
}
