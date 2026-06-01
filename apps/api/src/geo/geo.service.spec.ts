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
      set: jest.fn<Promise<string>, [string, string, string, number]>(async () => 'OK'),
    },
  };
  const prisma = {
    block: { findMany: jest.fn(async () => [] as unknown[]) },
    association: { findMany: jest.fn(async () => [] as unknown[]) },
    user: { findMany: jest.fn(async () => [] as unknown[]) },
    $queryRaw: jest.fn(async () => [] as unknown[]),
  };
  return { redis, prisma };
}

describe('GeoService', () => {
  it('scopes the marker cache key to the viewer (no cross-viewer bleed)', async () => {
    const { redis, prisma } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never);

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
    const { redis, prisma } = makeMocks();
    const cachedForA = JSON.stringify([{ kind: 'country', countryCode: 'NE', lat: 1, lon: 1, count: 9 }]);
    // Redis only has an entry for viewer-A's key.
    redis.client.get.mockImplementation(async (key) =>
      key.includes('viewer-A') ? cachedForA : null,
    );
    const svc = new GeoService(prisma as never, redis as never);

    const resultForB = await svc.getMarkers('viewer-B', BOUNDS);

    // viewer-B must miss the cache and not receive viewer-A's payload.
    expect(resultForB).toEqual([]);
    expect(prisma.block.findMany).toHaveBeenCalledTimes(1);
  });

  it('getNearby caps results to the requested radius (km)', async () => {
    const { redis, prisma } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never);

    await svc.getNearby('viewer-A', { lat: 13.5, lon: 2.1, radius: 25, limit: 30 });

    // The raw query is built as a Prisma.Sql; its `values` carry the bound
    // params. The radius (25) must be among them — proving the cap is applied
    // and not silently dropped (the bug this guards against).
    const sql = prisma.$queryRaw.mock.calls[0]![0] as { values: unknown[] };
    expect(sql.values).toContain(25);
    // lat/lon are bound too (appear twice: distance expr in SELECT + WHERE).
    expect(sql.values).toContain(13.5);
    expect(sql.values).toContain(2.1);
  });
});
