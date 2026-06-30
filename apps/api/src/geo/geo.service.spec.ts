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
      // pipeline().exists(k)...exec() → 1 (online) for every queried key.
      pipeline: jest.fn(() => {
        const calls: string[] = [];
        const p = {
          exists: (k: string) => {
            calls.push(k);
            return p;
          },
          exec: async () => calls.map(() => [null, 1]),
        };
        return p;
      }),
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
    proximityEncounter: {
      upsert: jest.fn(async () => ({ id: 'enc-1', status: 'active' }) as unknown),
    },
    friendship: { findMany: jest.fn(async () => [] as unknown[]) },
    post: { findMany: jest.fn(async () => [] as unknown[]) },
    $queryRaw: jest.fn(async () => [] as unknown[]),
  };
  const notifications = { create: jest.fn(async () => ({ id: 'n1' })) };
  return { redis, prisma, notifications };
}

describe('GeoService', () => {
  it('scopes the marker cache key to the viewer (no cross-viewer bleed)', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false), isProximityEnabled: jest.fn(async () => true), isProximityRegionAllowed: jest.fn(async () => true) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

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
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false), isProximityEnabled: jest.fn(async () => true), isProximityRegionAllowed: jest.fn(async () => true) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    const resultForB = await svc.getMarkers('viewer-B', BOUNDS);

    // viewer-B must miss the cache and not receive viewer-A's payload.
    expect(resultForB).toEqual([]);
    expect(prisma.block.findMany).toHaveBeenCalledTimes(1);
  });

  it('counts map-hidden users in country clusters (anonymous aggregate), no show_on_map filter', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false), isProximityEnabled: jest.fn(async () => true), isProximityRegionAllowed: jest.fn(async () => true) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

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
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false), isProximityEnabled: jest.fn(async () => true), isProximityRegionAllowed: jest.fn(async () => true) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    // zoom 5 (>= 4, < 9) -> city clusters branch.
    await svc.getMarkers('viewer-A', { ...BOUNDS, type: 'people', zoom: 5 });

    const sql = (prisma.$queryRaw.mock.calls[0] as unknown[])[0] as { strings: string[] };
    const query = sql.strings.join('');
    expect(query).not.toContain('show_on_map');
    expect(query).toContain("status = 'active'");
  });

  it('getNearby caps results to the requested radius (km)', async () => {
    const { redis, prisma, notifications } = makeMocks();
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false), isProximityEnabled: jest.fn(async () => true), isProximityRegionAllowed: jest.fn(async () => true) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

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

  it('story ring + online halo are FRIENDS-ONLY on the map (no leak to non-friends)', async () => {
    const { redis, prisma, notifications } = makeMocks();
    // Two map-visible individuals at the same spot: a friend and a stranger.
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'friend-1', displayName: 'F', avatarUrl: null, city: null, countryCode: null, latitude: 1, longitude: 1 },
      { id: 'stranger-1', displayName: 'S', avatarUrl: null, city: null, countryCode: null, latitude: 1, longitude: 1 },
    ]);
    // Viewer is friends with friend-1 only.
    prisma.friendship.findMany.mockResolvedValueOnce([
      { requesterId: 'viewer', addresseeId: 'friend-1' },
    ]);
    // activeStoryAuthors is only ever called with the friend ids → returns friend-1.
    prisma.post.findMany.mockResolvedValueOnce([{ authorId: 'friend-1' }]);
    const svc = new GeoService(prisma as never, redis as never, notifications as never, { isAdminFullVisibility: jest.fn(async () => false), isProximityEnabled: jest.fn(async () => true), isProximityRegionAllowed: jest.fn(async () => true) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);

    // zoom 9 → individual markers branch.
    const markers = await svc.getMarkers('viewer', { ...BOUNDS, type: 'people', zoom: 9 });
    const friend = markers.find((m) => 'userId' in m && m.userId === 'friend-1') as unknown as Record<string, unknown>;
    const stranger = markers.find((m) => 'userId' in m && m.userId === 'stranger-1') as unknown as Record<string, unknown>;

    // Friend: enriched. Stranger: both bits false (no friends-only metadata leak).
    expect(friend.hasActiveStory).toBe(true);
    expect(friend.activeRecently).toBe(true);
    expect(stranger.hasActiveStory).toBe(false);
    expect(stranger.activeRecently).toBe(false);
    // The story query must never be asked about the stranger.
    const storyWhere = (prisma.post.findMany as jest.Mock).mock.calls[0]?.[0]?.where;
    expect(storyWhere.authorId.in).toEqual(['friend-1']);
  });

  describe('proximityPing', () => {
    it('is fully inert when the proximity kill-switch is OFF (ships DARK)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      const svc = new GeoService(
        prisma as never,
        redis as never,
        notifications as never,
        {
          isAdminFullVisibility: jest.fn(async () => false),
          isProximityEnabled: jest.fn(async () => false),
          isProximityRegionAllowed: jest.fn(async () => true),
        } as never,
        { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never,
      );

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      // Kill-switch OFF: no user lookup, no position write, no matching, no notif.
      expect(result).toEqual({ matches: [] });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('returns empty when enabled but the pinger is outside the pilot city allowlist', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce({
        proximityAlerts: true,
        proximityRadius: 100,
        showOnMap: true,
        privacyLevel: 'public',
        city: 'Agadez',
      });
      const svc = new GeoService(
        prisma as never,
        redis as never,
        notifications as never,
        {
          isAdminFullVisibility: jest.fn(async () => false),
          isProximityEnabled: jest.fn(async () => true),
          isProximityRegionAllowed: jest.fn(async () => false),
        } as never,
        { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never,
      );

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result).toEqual({ matches: [] });
      // Gated before any live-location write or matching.
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    // Verified (approved) + 18+ pinger; map flags are irrelevant now.
    const eligiblePinger = {
      proximityAlerts: true,
      proximityRadius: 500,
      city: null,
      identityStatus: 'approved',
      identityDocuments: [{ dateOfBirth: new Date('1990-01-01') }],
    };
    const makeSvc = (prisma: unknown, redis: unknown, notifications: unknown) =>
      new GeoService(
        prisma as never,
        redis as never,
        notifications as never,
        {
          isAdminFullVisibility: jest.fn(async () => false),
          isProximityEnabled: jest.fn(async () => true),
          isProximityRegionAllowed: jest.fn(async () => true),
        } as never,
        { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never,
      );

    it('returns empty and never notifies when the pinger has not opted in', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce({
        proximityAlerts: false,
        proximityRadius: 100,
        city: null,
        identityStatus: 'approved',
        identityDocuments: [{ dateOfBirth: new Date('1990-01-01') }],
      });
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result).toEqual({ matches: [] });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('returns empty when the pinger is not identity-verified', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce({
        proximityAlerts: true,
        proximityRadius: 100,
        city: null,
        identityStatus: 'pending',
        identityDocuments: [],
      });
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result).toEqual({ matches: [] });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns empty when approved but no adult DOB on record (fail-closed 18+)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce({
        proximityAlerts: true,
        proximityRadius: 100,
        city: null,
        identityStatus: 'approved',
        identityDocuments: [], // no DOB recorded → not adult
      });
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result).toEqual({ matches: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('a map-hidden / private but verified-adult pinger IS eligible (decoupled from the map)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce(eligiblePinger);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cand-1', distance: 0.12 }]);
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      // Live position written (no show_on_map gate), encounter created, matched.
      expect(prisma.user.updateMany).toHaveBeenCalled();
      expect(prisma.proximityEncounter.upsert).toHaveBeenCalled();
      expect(result.matches).toHaveLength(1);
    });

    it('stays silent when already notified in this zone (dedup key exists)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce(eligiblePinger);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cand-1', distance: 0.04 }]);
      redis.client.set.mockResolvedValueOnce(null); // SET NX → already claimed
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result.matches).toHaveLength(0);
      expect(notifications.create).not.toHaveBeenCalled();
      expect(prisma.proximityEncounter.upsert).not.toHaveBeenCalled();
    });

    it('mutes a habitual pair (co-located ≥ threshold distinct days)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce(eligiblePinger);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cand-1', distance: 0.04 }]);
      redis.client.scard.mockResolvedValueOnce(3);
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result.matches).toHaveLength(0);
      expect(notifications.create).not.toHaveBeenCalled();
      expect(redis.client.set).toHaveBeenCalledWith(
        expect.stringMatching(/^prox:familiar:/),
        '1',
        'EX',
        expect.any(Number),
      );
    });

    it('a declined encounter stays silent (permanent anti-spam)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce(eligiblePinger);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cand-1', distance: 0.04 }]);
      prisma.proximityEncounter.upsert.mockResolvedValueOnce({ id: 'enc-1', status: 'declined' });
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      expect(result.matches).toHaveLength(0);
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('creates an ANONYMOUS mutual encounter for a fresh crossing (no identity leaked)', async () => {
      const { redis, prisma, notifications } = makeMocks();
      prisma.user.findUnique.mockResolvedValueOnce(eligiblePinger);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cand-1', distance: 0.12 }]);
      const svc = makeSvc(prisma, redis, notifications);

      const result = await svc.proximityPing('pinger', { lat: 13.5, lon: 2.1 });

      // Pair stored sorted (cand-1 < pinger) for unordered-pair dedup.
      const upsertArg = (prisma.proximityEncounter.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertArg.where.userAId_userBId).toEqual({ userAId: 'cand-1', userBId: 'pinger' });
      expect(upsertArg.create.distanceBucket).toBe(500); // 120 m → 500 m tier
      expect(upsertArg.update).toEqual({}); // frozen — never recomputed

      // Match surfaced to the pinger is the opaque handle ONLY — no peer identity.
      expect(result.matches).toEqual([{ encounterId: 'enc-1', distance: 500 }]);
      const match = result.matches[0] as unknown as Record<string, unknown>;
      expect(match.userId).toBeUndefined();
      expect(match.name).toBeUndefined();
      expect(match.avatarUrl).toBeUndefined();

      // Notification to the peer is anonymous: no name/userId/avatar/actorId.
      expect(notifications.create).toHaveBeenCalledTimes(1);
      const notifArg = (notifications.create as jest.Mock).mock.calls[0][0];
      expect(notifArg).toMatchObject({
        userId: 'cand-1',
        type: 'proximity',
        data: { encounterId: 'enc-1' },
      });
      expect(notifArg.actorId).toBeUndefined();
      expect(JSON.stringify(notifArg)).not.toContain('pinger');
    });
  });
});
