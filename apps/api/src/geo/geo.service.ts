import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { NotificationService } from '../notification/notification.service';
import { geocode, setWorldCitiesLookup } from '../common/geo/city-coords';
import { geohashEncode } from '../common/geo/geohash';
import { WorldCitiesService } from './world-cities';
import type { BoundsDto, CitiesQueryDto, NearbyDto, ProximityPingDto } from './dto/geo.dto';

const CLUSTER_TTL = 300;
// Max users notified by a single ping — caps the notification fan-out in dense
// areas (a crowd at an event must not trigger hundreds of pushes per ping).
const PROXIMITY_MATCH_LIMIT = 50;

// Proximity notification dedup tuning.
//  - ZONE_TTL: one notification per (direction, geohash zone) within this
//    window. Long enough that lingering in the same place stays silent, short
//    enough that meeting the same person there again next day re-notifies.
//  - HABITUAL_DAYS: distinct days a pair shares a zone before they're treated
//    as familiar (roommates/family/colleagues) and muted entirely.
//  - HABITUAL_WINDOW: rolling lifetime for both the day-counter and the
//    resulting "familiar" mute, refreshed as the routine continues.
const PROXIMITY_ZONE_TTL_SECONDS = 8 * 60 * 60; // 8h
const HABITUAL_DAYS = 3;
const HABITUAL_WINDOW_SECONDS = 14 * 24 * 60 * 60; // 14 days

export interface ProximityMatch {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  distance: number;
}

export interface CountryCluster {
  kind: 'country';
  countryCode: string;
  lat: number;
  lon: number;
  count: number;
}
export interface CityCluster {
  kind: 'city';
  city: string;
  countryCode: string;
  lat: number;
  lon: number;
  count: number;
}
export interface IndividualMarker {
  kind: 'individual';
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  lat: number;
  lon: number;
}
export interface AssociationMarker {
  kind: 'association';
  associationId: string;
  name: string;
  logoUrl: string | null;
  city: string | null;
  countryCode: string | null;
  memberCount: number;
  isVerified: boolean;
  lat: number;
  lon: number;
}
export type MapMarker = CountryCluster | CityCluster | IndividualMarker | AssociationMarker;

@Injectable()
export class GeoService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
    // @Optional() + default null so the existing unit-test spec (geo.service.spec.ts)
    // can instantiate GeoService with 3 args. In the real DI container,
    // WorldCitiesService is always provided via GeoModule, so this is never null
    // in production.
    //
    // The explicit @Inject(WorldCitiesService) is REQUIRED: the `| null` union
    // type makes TypeScript emit `Object` as the reflected param type, so without
    // an explicit token Nest can't resolve the provider and @Optional silently
    // injects null — leaving /geo/cities empty and the geocoder fallback unwired.
    @Optional()
    @Inject(WorldCitiesService)
    private readonly worldCities: WorldCitiesService | null = null,
  ) {}

  /**
   * Wire the world-cities lookup into the geocoder module once both services
   * are initialised. We use a module-level setter to avoid a circular import
   * between the geocoder utility (common/geo) and the geo module.
   */
  onModuleInit(): void {
    if (!this.worldCities) return; // guard for unit-test context (no DI)
    setWorldCitiesLookup((city, countryCode) => {
      const hit = this.worldCities!.findOne(city, countryCode);
      if (!hit) return null;
      return { lat: hit.lat, lon: hit.lng };
    });
  }

  /**
   * Search worldwide cities for the autocomplete endpoint GET /geo/cities.
   * Returns results sorted by population descending; accent/case-insensitive.
   */
  searchCities(dto: CitiesQueryDto) {
    if (!this.worldCities) return [];
    return this.worldCities.search(dto.q, dto.country, dto.limit);
  }

  async getMarkers(viewerId: string, dto: BoundsDto): Promise<MapMarker[]> {
    const cacheKey = this.cacheKey(viewerId, dto);
    const cached = await this.redis.client.get(cacheKey);
    if (cached) return JSON.parse(cached) as MapMarker[];

    const blockedIds = await this.blockedIds(viewerId);
    const markers: MapMarker[] = [];

    const includePeople = dto.type === 'all' || dto.type === 'people';
    const includeAssocs = dto.type === 'all' || dto.type === 'associations';

    if (includePeople) {
      if (dto.zoom < 4) {
        markers.push(...(await this.countryClusters(dto, blockedIds)));
        // Users with coords but no country_code (e.g. OAuth sign-ups who never
        // set a city) are invisible to the country/city aggregates. Cluster
        // them geographically so they still appear at wide zooms.
        markers.push(...(await this.orphanClusters(dto, blockedIds, 2)));
      } else if (dto.zoom < 9) {
        markers.push(...(await this.cityClusters(dto, blockedIds)));
        markers.push(...(await this.orphanClusters(dto, blockedIds, 4)));
      } else {
        markers.push(...(await this.individuals(dto, blockedIds, viewerId)));
      }
    }

    if (includeAssocs) {
      markers.push(...(await this.associations(dto)));
    }

    await this.redis.client.set(cacheKey, JSON.stringify(markers), 'EX', CLUSTER_TTL);
    return markers;
  }

  private async associations(dto: BoundsDto): Promise<AssociationMarker[]> {
    const assocs = await this.prisma.association.findMany({
      where: { countryCode: { not: null } },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        city: true,
        countryCode: true,
        memberCount: true,
        isVerified: true,
      },
      take: 200,
    });
    const markers: AssociationMarker[] = [];
    for (const a of assocs) {
      const coords = geocode(a.city, a.countryCode);
      if (!coords) continue;
      if (
        coords.lat < dto.south ||
        coords.lat > dto.north ||
        coords.lon < dto.west ||
        coords.lon > dto.east
      )
        continue;
      markers.push({
        kind: 'association',
        associationId: a.id,
        name: a.name,
        logoUrl: a.logoUrl,
        city: a.city,
        countryCode: a.countryCode,
        memberCount: a.memberCount,
        isVerified: a.isVerified,
        lat: coords.lat,
        lon: coords.lon,
      });
    }
    return markers;
  }

  async getStats() {
    // A member is a member whether or not they appear on the map: the total and
    // the per-country distribution count invisible (show_on_map = FALSE) users
    // anonymously, matching the cluster semantics. Only individual markers and
    // proximity/direct disclosure honour show_on_map.
    const [total, countries] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active', emailVerified: true } }),
      this.prisma.$queryRaw<Array<{ country_code: string; count: bigint }>>`
        SELECT country_code, COUNT(*)::bigint AS count
        FROM users
        WHERE status = 'active' AND email_verified = TRUE AND country_code IS NOT NULL
        GROUP BY country_code
        ORDER BY count DESC
      `,
    ]);
    return {
      totalMembers: total,
      countryCounts: countries.map((c) => ({ code: c.country_code, count: Number(c.count) })),
    };
  }

  async getNearby(viewerId: string, dto: NearbyDto) {
    const blockedIds = await this.blockedIds(viewerId);
    // id is uuid, bound params are text — compare via id::text (no uuid<>text op).
    const blockedClause = blockedIds.length
      ? Prisma.sql`AND id::text NOT IN (${Prisma.join(blockedIds)})`
      : Prisma.empty;

    // Distance is great-circle km (Haversine). The `radius` (km) caps results
    // to the user's local zone — without it a sparse map returned people on the
    // other side of the planet as "nearby". Filtered via HAVING on the computed
    // distance so the cap and the ordering share the same expression.
    const distanceExpr = Prisma.sql`
      (6371 * acos(
        LEAST(1, cos(radians(${dto.lat})) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(${dto.lon})) +
          sin(radians(${dto.lat})) * sin(radians(latitude)))
      ))`;

    return this.prisma.$queryRaw<
      Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        city: string | null;
        country_code: string | null;
        latitude: number;
        longitude: number;
        distance: number;
      }>
    >(Prisma.sql`
      SELECT id, display_name, avatar_url, city, country_code,
             latitude::float, longitude::float,
             ${distanceExpr} AS distance
      FROM users
      WHERE show_on_map = TRUE
        AND status = 'active'
        AND email_verified = TRUE
        AND privacy_level <> 'private'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND id::text <> ${viewerId}
        ${blockedClause}
        AND ${distanceExpr} <= ${dto.radius}
      ORDER BY distance
      LIMIT ${dto.limit}
    `);
  }

  /**
   * Foreground-only proximity ping. The pinger reports their current location;
   * we find OTHER opted-in users within the PINGER's chosen radius and notify
   * each that the pinger is near them. The radius belongs to the person moving
   * (they choose how sensitive their own alerts are).
   *
   * Privacy/anti-abuse:
   *  - Opt-in is OFF by default; a non-opted-in pinger neither broadcasts nor
   *    receives — we return an empty result without touching anyone.
   *  - Only opted-in, active, non-blocked users are ever matched or returned.
   *  - A Redis cooldown on the ORDERED pair (pinger -> candidate) caps re-notifies
   *    to once per 5 minutes.
   */
  async proximityPing(
    viewerId: string,
    dto: ProximityPingDto,
  ): Promise<{ matches: ProximityMatch[] }> {
    const pinger = await this.prisma.user.findUnique({
      where: { id: viewerId },
      select: {
        proximityAlerts: true,
        proximityRadius: true,
        showOnMap: true,
        privacyLevel: true,
      },
    });
    // Proximity is a map feature: a user must both opt into proximity AND be
    // map-visible to broadcast or receive. Opting into proximity while hidden
    // from the map must NOT turn it into a one-way live-location tracker.
    // A 'private' profile is invisible in discovery, so it neither broadcasts
    // (the notification would reveal the private pinger) nor receives.
    if (
      !pinger ||
      !pinger.proximityAlerts ||
      !pinger.showOnMap ||
      pinger.privacyLevel === 'private'
    )
      return { matches: [] };

    // Persist the pinger's location — conditionally, so a user who flipped
    // either flag off between the read and the write is not written. We never
    // store live GPS for someone not currently broadcasting on the map.
    await this.prisma.user.updateMany({
      where: { id: viewerId, proximityAlerts: true, showOnMap: true },
      data: { latitude: dto.lat, longitude: dto.lon },
    });

    const blockedIds = await this.blockedIds(viewerId);
    // users.id is uuid; the bound params are JS strings (text). Postgres has no
    // uuid <> text / uuid IN (text) operator, so compare as text via id::text.
    const blockedClause = blockedIds.length
      ? Prisma.sql`AND id::text NOT IN (${Prisma.join(blockedIds)})`
      : Prisma.empty;

    // Same Haversine (great-circle km) expression style as getNearby. The
    // pinger's radius is in meters → convert to km for the comparison.
    const radiusKm = pinger.proximityRadius / 1000;
    const distanceExpr = Prisma.sql`
      (6371 * acos(
        LEAST(1, cos(radians(${dto.lat})) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(${dto.lon})) +
          sin(radians(${dto.lat})) * sin(radians(latitude)))
      ))`;

    // Cap fan-out: one ping in a dense area must not notify hundreds. The
    // nearest MATCH_LIMIT opted-in, map-visible, non-blocked users only.
    const candidates = await this.prisma.$queryRaw<
      Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        distance: number;
      }>
    >(Prisma.sql`
      SELECT id, display_name, avatar_url,
             ${distanceExpr} AS distance
      FROM users
      WHERE proximity_alerts = TRUE
        AND show_on_map = TRUE
        AND status = 'active'
        AND email_verified = TRUE
        AND privacy_level <> 'private'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND id::text <> ${viewerId}
        ${blockedClause}
        AND ${distanceExpr} <= ${radiusKm}
      ORDER BY distance
      LIMIT ${PROXIMITY_MATCH_LIMIT}
    `);

    const pingerName = await this.displayName(viewerId);

    // Zone label for this encounter — same geohash cell ⇒ "same place". Computed
    // from the pinger's position (candidates are within ≤1 km, so they share or
    // border this cell). Re-meeting in a DIFFERENT cell yields a new zone key and
    // a fresh notification; staying in the same cell stays silent.
    const zone = geohashEncode(dto.lat, dto.lon);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

    const matches: ProximityMatch[] = [];
    for (const c of candidates) {
      // Bucket the distance instead of exposing meter-level position — a raw
      // meter count lets a recipient triangulate the pinger by moving around.
      const bucket = this.distanceBucket(c.distance * 1000);

      // Undirected pair key: habitual-co-location learning is symmetric (if A
      // lives with B, B lives with A). Directional dedup uses viewer→c so each
      // side still gets told once about the other per zone.
      const pair = viewerId < c.id ? `${viewerId}:${c.id}` : `${c.id}:${viewerId}`;

      // The whole notify decision touches Redis; on any Redis error we fail
      // CLOSED (skip the push) rather than risk a notification storm.
      const dedupKey = `prox:seen:${viewerId}:${c.id}:${zone}`;
      try {
        // 1) Habitual pair? Two people co-located in the same zone on ≥
        //    HABITUAL_DAYS distinct days are roommates / family / colleagues —
        //    mute them entirely (the feature is for discovering NEW people).
        const familiarKey = `prox:familiar:${pair}`;
        if (await this.redis.client.exists(familiarKey)) {
          continue;
        }

        // 2) Claim the per-(direction, zone) dedup slot FIRST. SET NX returns
        //    null when the key already exists ⇒ already notified in this zone
        //    recently ⇒ stay silent. Claiming before day-counting means a
        //    non-fresh ping (same zone within the TTL) never touches the
        //    day-set, so a continuous meetup straddling 00:00 UTC accrues at
        //    most one distinct day per TTL window (no midnight double-count).
        const fresh = await this.redis.client.set(
          dedupKey,
          '1',
          'EX',
          PROXIMITY_ZONE_TTL_SECONDS,
          'NX',
        );
        if (fresh === null) continue;

        // 3) Fresh encounter only: learn the routine by recording today against
        //    this (pair, zone). When the distinct-day count crosses the
        //    threshold, promote to "familiar" and stop notifying this pair.
        const daysKey = `prox:days:${pair}:${zone}`;
        const distinctDays = await this.redis.client.sadd(daysKey, today);
        if (distinctDays > 0) {
          // First sighting today in this zone — (re)arm the learning window.
          await this.redis.client.expire(daysKey, HABITUAL_WINDOW_SECONDS);
        }
        const dayCount = await this.redis.client.scard(daysKey);
        if (dayCount >= HABITUAL_DAYS) {
          await this.redis.client.set(familiarKey, '1', 'EX', HABITUAL_WINDOW_SECONDS);
          continue;
        }
      } catch {
        continue;
      }

      // 4) Notify, guarded on its own. If create() throws we must not leave the
      //    dedup slot claimed (that peer would be muted for the whole TTL) nor
      //    abort the loop and skip later candidates — release the slot so it can
      //    re-fire next ping, and move on.
      try {
        await this.notifications.create({
          userId: c.id,
          type: 'proximity',
          title: pingerName,
          body: `est à proximité (${this.distanceLabel(bucket)})`,
          data: { userId: viewerId },
          actorId: viewerId,
        });
      } catch {
        await this.redis.client.del(dedupKey);
        continue;
      }

      // Only surface the match to the pinger after a successful notify, so the
      // pinger's courtesy local heads-up mirrors a real new encounter.
      matches.push({
        userId: c.id,
        name: c.display_name,
        avatarUrl: c.avatar_url,
        distance: bucket,
      });
    }

    return { matches };
  }

  /** Round a raw distance (meters) up to a coarse bucket so we never disclose
   *  meter-level position. Buckets mirror the gauge tiers. */
  private distanceBucket(meters: number): number {
    if (meters <= 50) return 50;
    if (meters <= 100) return 100;
    if (meters <= 500) return 500;
    return 1000;
  }

  private distanceLabel(bucket: number): string {
    return bucket >= 1000 ? "à moins d'1 km" : `à moins de ${bucket} m`;
  }

  // ── internal ────────────────────────────────────────────────

  private async displayName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, firstName: true },
    });
    return u?.displayName ?? u?.firstName ?? 'Quelqu’un';
  }

  private async blockedIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    return Array.from(
      new Set(rows.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId))),
    );
  }

  // Clusters are aggregate, anonymous counts: a map-hidden user (show_on_map =
  // FALSE) is COUNTED here so the country/city tally reflects every active
  // member, but is never revealed individually. The show_on_map filter lives
  // only on individual markers and direct disclosure (nearby/proximity).
  private async countryClusters(_dto: BoundsDto, blockedIds: string[]): Promise<MapMarker[]> {
    const blockedClause = blockedIds.length
      ? Prisma.sql`AND id::text NOT IN (${Prisma.join(blockedIds)})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{
        country_code: string;
        count: bigint;
        avg_lat: number;
        avg_lon: number;
      }>
    >(Prisma.sql`
      SELECT country_code,
             COUNT(*)::bigint AS count,
             AVG(latitude)::float AS avg_lat,
             AVG(longitude)::float AS avg_lon
      FROM users
      WHERE status = 'active'
        AND email_verified = TRUE
        AND country_code IS NOT NULL
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        ${blockedClause}
      GROUP BY country_code
    `);
    return rows.map((r) => ({
      kind: 'country' as const,
      countryCode: r.country_code,
      lat: r.avg_lat,
      lon: r.avg_lon,
      count: Number(r.count),
    }));
  }

  // Same anonymous-aggregate semantics as countryClusters: map-hidden users are
  // counted in the city tally but never surfaced as individuals.
  private async cityClusters(dto: BoundsDto, blockedIds: string[]): Promise<MapMarker[]> {
    const blockedClause = blockedIds.length
      ? Prisma.sql`AND id::text NOT IN (${Prisma.join(blockedIds)})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{
        city: string;
        country_code: string;
        count: bigint;
        avg_lat: number;
        avg_lon: number;
      }>
    >(Prisma.sql`
      SELECT city, country_code,
             COUNT(*)::bigint AS count,
             AVG(latitude)::float AS avg_lat,
             AVG(longitude)::float AS avg_lon
      FROM users
      WHERE status = 'active'
        AND email_verified = TRUE
        AND city IS NOT NULL
        AND country_code IS NOT NULL
        AND latitude BETWEEN ${dto.south} AND ${dto.north}
        AND longitude BETWEEN ${dto.west} AND ${dto.east}
        ${blockedClause}
      GROUP BY city, country_code
    `);
    return rows.map((r) => ({
      kind: 'city' as const,
      city: r.city,
      countryCode: r.country_code,
      lat: r.avg_lat,
      lon: r.avg_lon,
      count: Number(r.count),
    }));
  }

  private async individuals(
    dto: BoundsDto,
    blockedIds: string[],
    viewerId: string,
  ): Promise<MapMarker[]> {
    // Exclude the viewer themselves: their own "you are here" marker is drawn
    // client-side, so returning a second individual pin at their position just
    // stacks on top of it (and hides anyone sharing their coordinates).
    const excludedIds = blockedIds.includes(viewerId) ? blockedIds : [...blockedIds, viewerId];
    const users = await this.prisma.user.findMany({
      where: {
        showOnMap: true,
        status: 'active',
        emailVerified: true,
        // A 'private' profile is invisible in discovery (profile/search/photos
        // already 404). It must not surface as an individual map pin either —
        // the pin exposes name/avatar/city. Such users are still counted
        // anonymously in the country/city clusters.
        privacyLevel: { not: 'private' },
        latitude: { gte: dto.south, lte: dto.north },
        longitude: { gte: dto.west, lte: dto.east },
        id: { notIn: excludedIds },
      },
      take: 500,
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        city: true,
        countryCode: true,
        latitude: true,
        longitude: true,
      },
    });

    return users
      .filter((u) => u.latitude !== null && u.longitude !== null)
      .map<IndividualMarker>((u) => ({
        kind: 'individual',
        userId: u.id,
        name: u.displayName,
        avatarUrl: u.avatarUrl,
        city: u.city,
        countryCode: u.countryCode,
        lat: Number(u.latitude),
        lon: Number(u.longitude),
      }));
  }

  /**
   * Cluster users who have coordinates but NO country_code (e.g. OAuth sign-ups
   * who never picked a city). They fall through the country/city aggregates
   * (which require a country_code), so without this they'd be invisible at every
   * zoom below the individual threshold. We bucket them by geohash cell so they
   * cluster geographically; `precision` tunes the cell size to the zoom band.
   */
  private async orphanClusters(
    dto: BoundsDto,
    blockedIds: string[],
    precision: number,
  ): Promise<CityCluster[]> {
    const users = await this.prisma.user.findMany({
      where: {
        showOnMap: true,
        status: 'active',
        emailVerified: true,
        privacyLevel: { not: 'private' },
        countryCode: null,
        latitude: { gte: dto.south, lte: dto.north },
        longitude: { gte: dto.west, lte: dto.east },
        id: blockedIds.length ? { notIn: blockedIds } : undefined,
      },
      take: 1000,
      select: { latitude: true, longitude: true },
    });

    const buckets = new Map<string, { lat: number; lon: number; count: number }>();
    for (const u of users) {
      if (u.latitude === null || u.longitude === null) continue;
      const lat = Number(u.latitude);
      const lon = Number(u.longitude);
      const key = geohashEncode(lat, lon, precision);
      const b = buckets.get(key);
      if (b) {
        b.lat += lat;
        b.lon += lon;
        b.count += 1;
      } else {
        buckets.set(key, { lat, lon, count: 1 });
      }
    }

    // Emitted as city-kind clusters with empty country (mobile renders the 🌍
    // fallback flag). Tapping zooms in until they resolve to individual pins.
    return Array.from(buckets.values()).map((b) => ({
      kind: 'city' as const,
      city: '',
      countryCode: '',
      lat: b.lat / b.count,
      lon: b.lon / b.count,
      count: b.count,
    }));
  }

  private cacheKey(viewerId: string, dto: BoundsDto): string {
    return `geo:${viewerId}:${dto.zoom}:${dto.type}:${dto.north.toFixed(2)}:${dto.south.toFixed(2)}:${dto.east.toFixed(2)}:${dto.west.toFixed(2)}`;
  }
}
