import { GeoService } from './geo.service';
import { ProfileService } from '../profile/profile.service';

/**
 * Security tests for the "admin full visibility" support override: when the
 * setting is ON and the viewer is an admin, the map shows everyone (no showOnMap
 * / private gate) and any profile opens. Moderators and the default path never
 * get the override.
 */
const settings = (full: boolean) => ({
  isAdminFullVisibility: jest.fn(async (role?: string) => full && role === 'admin'),
});

function makeGeo(full: boolean, findMany: jest.Mock) {
  const prisma = { user: { findMany }, block: {} };
  const redis = { client: { get: jest.fn(async () => null), set: jest.fn() } };
  // blockedIds() reads block.findMany — stub via a prisma.block.findMany
  prisma.block = { findMany: jest.fn(async () => []) } as never;
  return new GeoService(
    prisma as never,
    redis as never,
    {} as never,
    settings(full) as never,
    { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never,
  );
}

const BOUNDS = { north: 20, south: 0, east: 20, west: 0, zoom: 10, type: 'people' } as never;

/** First call's first arg's `where`, untyped-mock-safe. */
const whereOf = (m: jest.Mock): Record<string, unknown> =>
  ((m.mock.calls as unknown[][])[0]![0] as { where: Record<string, unknown> }).where;

describe('GeoService — admin full visibility (map)', () => {
  it('admin + override ON: individuals query DROPS showOnMap + private gates', async () => {
    const findMany = jest.fn(async () => []);
    await makeGeo(true, findMany).getMarkers('admin-id', BOUNDS, 'admin');
    const where = whereOf(findMany);
    expect(where).not.toHaveProperty('showOnMap');
    expect(where).not.toHaveProperty('privacyLevel');
    expect(where.status).toBe('active');
  });

  it('admin but override OFF: keeps showOnMap + private gates', async () => {
    const findMany = jest.fn(async () => []);
    await makeGeo(false, findMany).getMarkers('admin-id', BOUNDS, 'admin');
    const where = whereOf(findMany);
    expect(where.showOnMap).toBe(true);
    expect(where).toHaveProperty('privacyLevel');
  });

  it('moderator with override ON: still gated (override is admin-only)', async () => {
    const findMany = jest.fn(async () => []);
    // settings(true) only returns true for role 'admin'; moderator → false.
    await makeGeo(true, findMany).getMarkers('mod-id', BOUNDS, 'moderator');
    const where = whereOf(findMany);
    expect(where.showOnMap).toBe(true);
  });
});

function makeProfile(full: boolean, target: { privacyLevel: string } | null) {
  const prisma = { user: { findUnique: jest.fn(async () => target) } };
  const redis = { client: { get: jest.fn(async () => null), set: jest.fn() } };
  const blocks = { isBlocked: jest.fn(async () => false) };
  const svc = new ProfileService(
    prisma as never,
    redis as never,
    {} as never,
    blocks as never,
    {} as never,
    settings(full) as never,
    { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never,
  );
  // loadNetwork hits prisma; stub it so getById resolves.
  jest.spyOn(svc as never, 'loadNetwork').mockResolvedValue({} as never);
  return { svc, blocks };
}

describe('ProfileService — admin full visibility (profile detail)', () => {
  it('admin + override ON: a PRIVATE profile is returned (no 404)', async () => {
    const { svc } = makeProfile(true, { id: 'u2', privacyLevel: 'private' } as never);
    await expect(svc.getById('admin-id', 'u2', 'admin')).resolves.toMatchObject({ id: 'u2' });
  });

  it('default viewer: a PRIVATE profile 404s', async () => {
    const { svc } = makeProfile(false, { id: 'u2', privacyLevel: 'private' } as never);
    await expect(svc.getById('viewer', 'u2', 'user')).rejects.toThrow();
  });

  it('admin + override ON: skips the block check (can open a blocked user)', async () => {
    const { svc, blocks } = makeProfile(true, { id: 'u2', privacyLevel: 'public' } as never);
    await svc.getById('admin-id', 'u2', 'admin');
    expect(blocks.isBlocked).not.toHaveBeenCalled();
  });
});
