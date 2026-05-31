import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { geocode } from '../common/geo/city-coords';
import type { BoundsDto, NearbyDto } from './dto/geo.dto';

const CLUSTER_TTL = 300;

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
    const blockedClause = blockedIds.length
      ? Prisma.sql`AND id NOT IN (${Prisma.join(blockedIds)})`
      : Prisma.empty;

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
             (6371 * acos(
               cos(radians(${dto.lat})) * cos(radians(latitude)) *
               cos(radians(longitude) - radians(${dto.lon})) +
               sin(radians(${dto.lat})) * sin(radians(latitude))
             )) AS distance
      FROM users
      WHERE show_on_map = TRUE
        AND status = 'active'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND id <> ${viewerId}
        ${blockedClause}
      ORDER BY distance
      LIMIT ${dto.limit}
    `);
  }

  // ── internal ────────────────────────────────────────────────

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
      ? Prisma.sql`AND id NOT IN (${Prisma.join(blockedIds)})`
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
      ? Prisma.sql`AND id NOT IN (${Prisma.join(blockedIds)})`
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
