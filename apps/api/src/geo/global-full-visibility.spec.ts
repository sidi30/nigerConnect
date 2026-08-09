import { GeoService } from './geo.service';
import { ProfileService } from '../profile/profile.service';

/**
 * Tests for the COMMUNITY-WIDE visibility override (`global_full_visibility`):
 * when ON, every member sees every profile — the privacyLevel gates drop for
 * everyone (not just admins). Two invariants are pinned here:
 *   - showOnMap (the explicit location opt-in) is STILL honoured on the map,
 *   - blocks still apply (unlike the admin support override).
 */
const settings = (globalVis: boolean) => ({
  isAdminFullVisibility: jest.fn(async () => false),
  isGlobalFullVisibility: jest.fn(async () => globalVis),
});

function makeGeo(globalVis: boolean, findMany: jest.Mock) {
  const prisma = {
    user: { findMany },
    block: { findMany: jest.fn(async () => []) },
  };
  const redis = { client: { get: jest.fn(async () => null), set: jest.fn() } };
  return new GeoService(
    prisma as never,
    redis as never,
    {} as never,
    settings(globalVis) as never,
    { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never,
  );
}

const BOUNDS = { north: 20, south: 0, east: 20, west: 0, zoom: 10, type: 'people' } as never;

/** First call's first arg's `where`, untyped-mock-safe. */
function whereOf(findMany: jest.Mock): Record<string, unknown> {
  return (findMany.mock.calls[0] as unknown[])[0]!['where' as never];
}

/** Diaspora rule: permissive by default here — the rule has its own spec. */
const makeDiaspora = () => ({
  isHomeBased: jest.fn(async () => false),
  mayInitiateContact: jest.fn(async () => true),
  assertMayInitiateContact: jest.fn(async () => undefined),
  mayReply: jest.fn(async () => true),
  assertMayReply: jest.fn(async () => undefined),
  invalidate: jest.fn(async () => undefined),
});

describe('GeoService — global full visibility (map)', () => {
  it('override ON: keeps the showOnMap opt-in but drops the privacy gate', async () => {
    const findMany = jest.fn(async () => []);
    await makeGeo(true, findMany).getMarkers('viewer', BOUNDS, 'user');
    const where = whereOf(findMany);
    expect(where.showOnMap).toBe(true);
    expect(where.privacyLevel).toBeUndefined();
  });

  it('override OFF: default path keeps both gates', async () => {
    const findMany = jest.fn(async () => []);
    await makeGeo(false, findMany).getMarkers('viewer', BOUNDS, 'user');
    const where = whereOf(findMany);
    expect(where.showOnMap).toBe(true);
    expect(where.privacyLevel).toEqual({ not: 'private' });
  });
});

function makeProfile(globalVis: boolean, target: { privacyLevel: string } | null, blocked = false) {
  const prisma = {
    user: { findUnique: jest.fn(async () => target) },
    friendship: { count: jest.fn(async () => 0) },
  };
  const redis = { client: { get: jest.fn(async () => null), set: jest.fn() } };
  const blocks = { isBlocked: jest.fn(async () => blocked) };
  const svc = new ProfileService(
    prisma as never,
    redis as never,
    {} as never,
    blocks as never,
    {} as never,
    settings(globalVis) as never,
    { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never,
      makeDiaspora() as never,
    );
  jest.spyOn(svc as never, 'loadNetwork').mockResolvedValue({} as never);
  jest
    .spyOn(svc as never, 'loadCounts')
    .mockResolvedValue({ friendsCount: null, postsCount: null, photosCount: 0 } as never);
  return { svc, blocks };
}

describe('ProfileService — global full visibility (profile detail)', () => {
  it('override ON: a PRIVATE profile is visible to a plain member', async () => {
    const { svc } = makeProfile(true, { id: 'u2', privacyLevel: 'private' } as never);
    await expect(svc.getById('viewer', 'u2', 'user')).resolves.toMatchObject({ id: 'u2' });
  });

  it('override OFF: a PRIVATE profile still 404s (default behaviour intact)', async () => {
    const { svc } = makeProfile(false, { id: 'u2', privacyLevel: 'private' } as never);
    await expect(svc.getById('viewer', 'u2', 'user')).rejects.toThrow();
  });

  it('override ON: blocks STILL apply (unlike the admin support override)', async () => {
    const { svc } = makeProfile(true, { id: 'u2', privacyLevel: 'public' } as never, true);
    await expect(svc.getById('viewer', 'u2', 'user')).rejects.toThrow();
  });

  it('override ON: search no longer excludes private profiles', async () => {
    const findMany = jest.fn(async () => []);
    const prisma = { user: { findMany }, block: { findMany: jest.fn(async () => []) } };
    const redis = { client: { get: jest.fn(async () => null), set: jest.fn() } };
    const svc = new ProfileService(
      prisma as never,
      redis as never,
      {} as never,
      { isBlocked: jest.fn(async () => false), blockedIdsOf: jest.fn(async () => []) } as never,
      {} as never,
      settings(true) as never,
      { log: jest.fn(async () => undefined) } as never,
      makeDiaspora() as never,
    );
    await svc.search('viewer', { limit: 10 } as never);
    const where = whereOf(findMany) as { AND: Array<Record<string, unknown>> };
    expect(where.AND.some((c) => 'privacyLevel' in c)).toBe(false);
  });
});
