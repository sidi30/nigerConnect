import { GeoService } from './geo.service';
import type { BoundsDto } from './dto/geo.dto';

const BOUNDS: BoundsDto = {
  north: 20,
  south: 10,
  east: 5,
  west: -5,
  zoom: 3,
  type: 'all',
};

function makeMocks() {
  const redis = {
    client: {
      get: jest.fn<Promise<string | null>, [string]>(async () => null),
      set: jest.fn<Promise<string | null>, unknown[]>(async () => 'OK'),
      // Proximity dedup/learning primitives. Defaults model a brand-new pair:
      // not familiar, first sighting today, 1 distinct day so far.
      exists: jest.fn<Promise<number>, [string]>(async () => 0),
      sadd: jest.fn<Promise<number>, unknown[]>(async () => 1),
      scard: jest.fn<Promise<number>, [string]>(async () => 1),
      expire: jest.fn<Promise<number>, unknown[]>(async () => 1),
    },
  };
  const prisma = {
    block: { findMany: jest.fn(async () => [] as unknown[]) },
    association: { findMany: jest.fn(async () => [] as unknown[]) },
    page: { findMany: jest.fn(async () => [] as unknown[]) },
    user: {
      findMany: jest.fn(async () => [] as unknown[]),
      findUnique: jest.fn(async () => null as unknown),
      update: jest.fn(async () => ({}) as unknown),
      updateMany: jest.fn(async () => ({ count: 1 }) as unknown),
    },
    $queryRaw: jest.fn(async () => [] as unknown[]),
  };
  const notifications = { create: jest.fn(async () => ({ id: 'n1' })) };
  return { redis, prisma, notifications };
}

describe('GeoService', () => {
  it('scopes the marker cache key to the viewer (no cross-viewer bleed)', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    await svc.getMarkers('viewer-A', BOUNDS);
    await svc.getMarkers('viewer-B', BOUNDS);

    const getKeyA = redis.client.get.mock.calls[0]![0];
    const getKeyB = redis.client.get.mock.calls[1]![0];

    // Identical bounds, different viewers -> different cache keys.
    expect(getKeyA).not.toBe(getKeyB);
    expect(getKeyA).toContain('viewer-A');
    expect(getKeyB).toContain('viewer-B');

    // The key written back to the cache is viewer-scoped too.
    const setKeyA = redis.client.set.mock.calls[0]![0];
    const setKeyB = redis.client.set.mock.calls[1]![0];
    expect(setKeyA).toContain('viewer-A');
    expect(setKeyB).toContain('viewer-B');
    expect(setKeyA).not.toBe(setKeyB);
  });

  it('one viewer cannot read another viewer cached markers', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const cachedForA = JSON.stringify([{ kind: 'country', countryCode: 'NE', lat: 1, lon: 1, count: 9 }]);
    // Redis only has an entry for viewer-A's key.
    redis.client.get.mockImplementation(async (key) =>
      key.includes('viewer-A') ? cachedForA : null,
    );
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    const resultForB = await svc.getMarkers('viewer-B', BOUNDS);

    // viewer-B must miss the cache and not receive viewer-A's payload.
    expect(resultForB).toEqual([]);
    expect(prisma.block.findMany).toHaveBeenCalledTimes(1);
  });

  it('counts map-hidden users in country clusters (anonymous aggregate), no show_on_map filter', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    // zoom 3 (< 4) -> country clusters branch.
    await svc.getMarkers('viewer-A', { ...BOUNDS, type: 'people', zoom: 3 });

    const sql = (prisma.$queryRaw.mock.calls[0] as unknown[])[0] as { strings: string[] };
    const query = sql.strings.join('');
    // Clusters are anonymous counts: a hidden member is still counted, so the
    // visibility filter must NOT be applied to the cluster aggregate.
    expect(query).not.toContain('show_on_map');
    // The active-member scope is still enforced.
    expect(query).toContain("status = 'active'");
  });

  it('counts map-hidden users in city clusters (anonymous aggregate), no show_on_map filter', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    // zoom 5 (>= 4, < 9) -> city clusters branch.
    await svc.getMarkers('viewer-A', { ...BOUNDS, type: 'people', zoom: 5 });

    const sql = (prisma.$queryRaw.mock.calls[0] as unknown[])[0] as { strings: string[] };
    const query = sql.strings.join('');
    expect(query).not.toContain('show_on_map');
    expect(query).toContain("status = 'active'");
  });

  it('getNearby caps results to the requested radius (km)', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    await svc.getNearby('viewer-A', { lat: 13.5, lon: 2.1, radius: 25, limit: 30 });

    // The raw query is built as a Prisma.Sql; its `values` carry the bound
    // params. The radius (25) must be among them — proving the cap is applied
    // and not silently dropped (the bug this guards against).
    const sql = (prisma.$queryRaw.mock.calls[0] as unknown[])[0] as {
      values: unknown[];
    };
    expect(sql.values).toContain(25);
    // lat/lon are bound too (appear twice: distance expr in SELECT + WHERE).
    expect(sql.values).toContain(13.5);
    expect(sql.values).toContain(2.1);
  });

  describe('proximityPing', () => {
    it('returns empty and never notifies when the pinger has not opted in', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce({
        proximityAlerts: false,
        proximityRadius: 100,
        showOnMap: true,
      });
      const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result).toEqual({ matches: [] });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('returns empty when the pinger opted in but is hidden from the map', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce({
        proximityAlerts: true,
        proximityRadius: 100,
        showOnMap: false,
      });
      const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      // Opting into proximity while map-hidden must NOT write live location
      // nor broadcast — no one-way tracker.
      expect(result).toEqual({ matches: [] });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('stays silent when already notified in this zone (dedup key exists)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      // 1st findUnique = pinger opt-in/radius/showOnMap; 2nd = displayName lookup.
      prisma.user.findUnique
        .mockResolvedValueOnce({ proximityAlerts: true, proximityRadius: 100, showOnMap: true })
        .mockResolvedValueOnce({ displayName: 'Aïcha', firstName: null });
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'cand-1', display_name: 'Bob', avatar_url: null, distance: 0.04 },
      ]);
      // Per-zone dedup key already set -> SET NX returns null.
      redis.client.set.mockResolvedValueOnce(null);
      const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      // No notification AND no match surfaced — the pinger's local heads-up
      // mirrors a real new encounter, so a deduped peer is omitted.
      expect(result.matches).toHaveLength(0);
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('mutes a habitual pair (co-located ≥ threshold distinct days)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique
        .mockResolvedValueOnce({ proximityAlerts: true, proximityRadius: 100, showOnMap: true })
        .mockResolvedValueOnce({ displayName: 'Aïcha', firstName: null });
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'cand-1', display_name: 'Bob', avatar_url: null, distance: 0.04 },
      ]);
      // 3rd distinct day in the same zone -> crosses HABITUAL_DAYS -> muted.
      redis.client.scard.mockResolvedValueOnce(3);
      const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result.matches).toHaveLength(0);
      expect(notifications.create).not.toHaveBeenCalled();
      // The pair is promoted to "familiar" so future pings short-circuit.
      expect(redis.client.set).toHaveBeenCalledWith(
        expect.stringMatching(/^prox:familiar:/),
        '1',
        'EX',
        expect.any(Number),
      );
    });

    it('notifies once per zone for a fresh, non-habitual encounter', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique
        .mockResolvedValueOnce({ proximityAlerts: true, proximityRadius: 500, showOnMap: true })
        .mockResolvedValueOnce({ displayName: 'Aïcha', firstName: null });
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'cand-1', display_name: 'Bob', avatar_url: null, distance: 0.12 },
      ]);
      const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      // Dedup key is directional + zone-scoped (geohash suffix varies).
      expect(redis.client.set).toHaveBeenCalledWith(
        expect.stringMatching(/^prox:seen:pinger:cand-1:/),
        '1',
        'EX',
        8 * 60 * 60,
        'NX',
      );
      // 0.12 km = 120 m → bucketed up to the 500 m tier.
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toMatchObject({ userId: 'cand-1', distance: 500 });
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cand-1',
          type: 'proximity',
          actorId: 'pinger',
          title: 'Aïcha',
        }),
      );
    });
  });
});
