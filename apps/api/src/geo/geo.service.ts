import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { NotificationService } from '../notification/notification.service';
import { geocode } from '../common/geo/city-coords';
import type { BoundsDto, NearbyDto, ProximityPingDto } from './dto/geo.dto';

const CLUSTER_TTL = 300;
const PROXIMITY_COOLDOWN = 300;
// Max users notified by a single ping — caps the notification fan-out in dense
// areas (a crowd at an event must not trigger hundreds of pushes per ping).
const PROXIMITY_MATCH_LIMIT = 50;

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
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
  ) {}

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
      } else if (dto.zoom < 9) {
        markers.push(...(await this.cityClusters(dto, blockedIds)));
      } else {
        markers.push(...(await this.individuals(dto, blockedIds)));
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
    const [total, countries] = await Promise.all([
      this.prisma.user.count({ where: { showOnMap: true, status: 'active' } }),
      this.prisma.$queryRaw<Array<{ country_code: string; count: bigint }>>`
        SELECT country_code, COUNT(*)::bigint AS count
        FROM users
        WHERE show_on_map = TRUE AND status = 'active' AND country_code IS NOT NULL
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
      select: { proximityAlerts: true, proximityRadius: true, showOnMap: true },
    });
    // Proximity is a map feature: a user must both opt into proximity AND be
    // map-visible to broadcast or receive. Opting into proximity while hidden
    // from the map must NOT turn it into a one-way live-location tracker.
    if (!pinger || !pinger.proximityAlerts || !pinger.showOnMap) return { matches: [] };

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
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND id::text <> ${viewerId}
        ${blockedClause}
        AND ${distanceExpr} <= ${radiusKm}
      ORDER BY distance
      LIMIT ${PROXIMITY_MATCH_LIMIT}
    `);

    const pingerName = await this.displayName(viewerId);

    const matches: ProximityMatch[] = [];
    for (const c of candidates) {
      // Bucket the distance instead of exposing meter-level position — a raw
      // meter count lets a recipient triangulate the pinger by moving around.
      const bucket = this.distanceBucket(c.distance * 1000);
      matches.push({
        userId: c.id,
        name: c.display_name,
        avatarUrl: c.avatar_url,
        distance: bucket,
      });

      // Ordered-pair cooldown: only notify if the key is newly set. If Redis is
      // unavailable we fail CLOSED (skip the notification) rather than risk a
      // notification storm with no cooldown guarantee.
      let fresh: string | null = null;
      try {
        const key = `prox:${viewerId}:${c.id}`;
        fresh = await this.redis.client.set(key, '1', 'EX', PROXIMITY_COOLDOWN, 'NX');
      } catch {
        continue;
      }
      if (!fresh) continue;

      await this.notifications.create({
        userId: c.id,
        type: 'proximity',
        title: pingerName,
        body: `est à proximité (${this.distanceLabel(bucket)})`,
        data: { userId: viewerId },
        actorId: viewerId,
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
      WHERE show_on_map = TRUE
        AND status = 'active'
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
      WHERE show_on_map = TRUE
        AND status = 'active'
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

  private async individuals(dto: BoundsDto, blockedIds: string[]): Promise<MapMarker[]> {
    const users = await this.prisma.user.findMany({
      where: {
        showOnMap: true,
        status: 'active',
        latitude: { gte: dto.south, lte: dto.north },
        longitude: { gte: dto.west, lte: dto.east },
        id: blockedIds.length ? { notIn: blockedIds } : undefined,
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

  private cacheKey(viewerId: string, dto: BoundsDto): string {
    return `geo:${viewerId}:${dto.zoom}:${dto.type}:${dto.north.toFixed(2)}:${dto.south.toFixed(2)}:${dto.east.toFixed(2)}:${dto.west.toFixed(2)}`;
  }
}
