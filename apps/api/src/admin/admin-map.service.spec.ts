import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AdminMapService } from './admin-map.service';

/**
 * Security tests for the admin members map, and above all for the "bris de
 * glace": the real GPS position is served only inside a 30-minute window the
 * calling admin opened with a live TOTP, and only while the last ping is fresh.
 * Everything else falls back to the public city pin.
 */

const ADMIN = 'admin-1';
const GPS_KEY = `admin:map:preciseloc:${ADMIN}`;

/** A member row as Prisma returns it for the map select (city position only). */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    displayName: 'Aïcha',
    firstName: 'Aïcha',
    lastName: 'Moussa',
    avatarUrl: null,
    city: 'Niamey',
    countryCode: 'NE',
    latitude: 13.51,
    longitude: 2.11,
    status: 'active',
    identityStatus: 'approved',
    isAmbassador: false,
    emailVerified: true,
    phoneVerified: false,
    privacyLevel: 'private',
    lastSeenAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    _count: { posts: 3, friendshipsSent: 2, friendshipsReceived: 1, invitees: 0 },
    ...over,
  };
}

function makeService(opts: {
  /** ISO string when the window is open, null when it is shut. */
  window?: string | null;
  rows?: unknown[];
  /** groupBy result — drives `withoutPosition` and the facets. */
  groups?: unknown[];
  mfaOk?: boolean;
  mfaEnabled?: boolean;
  failures?: string | null;
} = {}) {
  const store = new Map<string, string>();
  if (opts.window) store.set(GPS_KEY, opts.window);
  if (opts.failures) store.set(`admin:map:preciseloc:fail:${ADMIN}`, opts.failures);

  const findMany = jest.fn(async () => opts.rows ?? [row()]);
  const groupBy = jest.fn(async () => opts.groups ?? []);
  const prisma = {
    user: {
      findMany,
      groupBy,
      findUnique: jest.fn(async () => ({ mfaEnabled: opts.mfaEnabled ?? true })),
      count: jest.fn(async () => 0),
    },
    refreshToken: { findMany: jest.fn(async () => []) },
    adminAuditLog: { create: jest.fn(async () => ({})) },
  };
  const redis = {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      // 'NX' set is the audit debounce — always "first" here so audit rows fire.
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    },
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => void store.delete(k)),
    incrementCounter: jest.fn(async () => 1),
  };
  const mfa = { verifyForUser: jest.fn(async () => opts.mfaOk ?? true) };
  const audit = { log: jest.fn(async () => undefined) };

  const service = new AdminMapService(
    prisma as never,
    redis as never,
    mfa as never,
    audit as never,
  );
  return { service, prisma, redis, mfa, audit, findMany, groupBy };
}

/** The `select` Prisma was called with on the list query. */
const selectOf = (m: jest.Mock): Record<string, unknown> =>
  ((m.mock.calls as unknown[][])[0]![0] as { select: Record<string, unknown> }).select;

const OPEN = () => new Date(Date.now() + 10 * 60_000).toISOString();
const FRESH_GPS = {
  proximityLat: 13.523456,
  proximityLon: 2.098765,
  proximityUpdatedAt: new Date(Date.now() - 60_000),
};

describe('AdminMapService — bris de glace (position GPS réelle)', () => {
  it('window shut: GPS columns are not even SELECTed, city position is served', async () => {
    const { service, findMany } = makeService({ window: null });

    const page = await service.listUsers(ADMIN, { limit: 50 });

    const select = selectOf(findMany);
    expect(select.proximityLat).toBe(false);
    expect(select.proximityLon).toBe(false);
    expect(select.proximityUpdatedAt).toBe(false);
    expect(page.items[0]!.precision).toBe('city');
    expect(page.items[0]!.lat).toBe(13.51);
    expect(page.items[0]!.positionUpdatedAt).toBeNull();
  });

  it('window shut: a row that somehow carries GPS is STILL served as city', async () => {
    // Defence in depth. The columns are not selected outside the window, so this
    // row cannot occur today — but if a future caller passes a fully-loaded User
    // through, the window state alone must be enough to refuse the GPS point.
    const { service } = makeService({ window: null, rows: [row(FRESH_GPS)] });

    const page = await service.listUsers(ADMIN, { limit: 50 });

    expect(page.items[0]!.precision).toBe('city');
    expect(page.items[0]!.lat).toBe(13.51);
    expect(page.items[0]!.positionUpdatedAt).toBeNull();
  });

  it('window open + fresh ping: serves GPS, and audits the read', async () => {
    const { service, findMany, audit } = makeService({
      window: OPEN(),
      rows: [row(FRESH_GPS)],
    });

    const page = await service.listUsers(ADMIN, { limit: 50 });

    expect(selectOf(findMany).proximityLat).toBe(true);
    expect(page.items[0]!.precision).toBe('gps');
    expect(page.items[0]!.lat).toBe(13.523456);
    expect(page.items[0]!.lng).toBe(2.098765);
    expect(page.items[0]!.positionUpdatedAt).toBe(FRESH_GPS.proximityUpdatedAt.toISOString());
    expect(audit.log).toHaveBeenCalledWith(ADMIN, 'precise_location_read', undefined);
  });

  it('window open but the ping is stale (> 24 h): falls back to city, no gps audit', async () => {
    const { service, audit } = makeService({
      window: OPEN(),
      rows: [
        row({
          ...FRESH_GPS,
          proximityUpdatedAt: new Date(Date.now() - 25 * 3_600_000),
        }),
      ],
    });

    const page = await service.listUsers(ADMIN, { limit: 50 });

    expect(page.items[0]!.precision).toBe('city');
    expect(page.items[0]!.lat).toBe(13.51);
    expect(audit.log).not.toHaveBeenCalledWith(ADMIN, 'precise_location_read', undefined);
  });

  it('expired window value: treated as shut even if Redis still holds it', async () => {
    const { service, findMany } = makeService({
      window: new Date(Date.now() - 1_000).toISOString(),
      rows: [row(FRESH_GPS)],
    });

    expect(await service.preciseWindow(ADMIN)).toEqual({ active: false, until: null });
    await service.listUsers(ADMIN, { limit: 50 });
    expect(selectOf(findMany).proximityLat).toBe(false);
  });

  it('Redis unreachable: window reads fail CLOSED', async () => {
    const { service, redis } = makeService({ window: OPEN() });
    redis.client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    expect(await service.preciseWindow(ADMIN)).toEqual({ active: false, until: null });
  });

  it('detail view: GPS read is audited against the member it revealed', async () => {
    const { service, prisma, audit } = makeService({ window: OPEN() });
    prisma.user.findUnique = jest.fn(async () => ({
      ...row(FRESH_GPS),
      email: 'a@example.com',
      phone: null,
      bio: null,
      languages: ['fr'],
      lastLoginAt: null,
      invitedBy: null,
    })) as never;

    const detail = await service.getUser(ADMIN, 'u1');

    expect(detail.precision).toBe('gps');
    expect(audit.log).toHaveBeenCalledWith(ADMIN, 'precise_location_read', 'u1');
  });
});

describe('AdminMapService — unlocking the window', () => {
  it('admin without MFA enrolled: 400, and no window is opened', async () => {
    const { service, redis, mfa } = makeService({ mfaEnabled: false });

    await expect(service.unlockPreciseLocation(ADMIN, '123456', 'membre en danger')).rejects.toThrow(
      BadRequestException,
    );
    expect(mfa.verifyForUser).not.toHaveBeenCalled();
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it('wrong code: 401, no window, failure counted', async () => {
    const { service, redis, audit } = makeService({ mfaOk: false });

    await expect(service.unlockPreciseLocation(ADMIN, '000000', 'membre en danger')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(redis.incrementCounter).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('too many wrong codes: 429 before the verifier is even called', async () => {
    const { service, mfa } = makeService({ failures: '5' });

    await expect(
      service.unlockPreciseLocation(ADMIN, '123456', 'membre en danger'),
    ).rejects.toThrow(HttpException);
    expect(mfa.verifyForUser).not.toHaveBeenCalled();
  });

  it('valid code: 30-minute per-admin window, audited with the written motive', async () => {
    const { service, redis, audit, prisma } = makeService();

    const res = await service.unlockPreciseLocation(ADMIN, '123456', 'signalement de disparition');

    expect(res.active).toBe(true);
    const ttlMinutes = (Date.parse(res.until!) - Date.now()) / 60_000;
    expect(ttlMinutes).toBeGreaterThan(29);
    expect(ttlMinutes).toBeLessThanOrEqual(30);
    // Per-admin key with a hard TTL — never a global setting.
    expect(redis.client.set).toHaveBeenCalledWith(GPS_KEY, res.until, 'EX', 1800);
    expect(audit.log).toHaveBeenCalledWith(ADMIN, 'precise_location_unlock');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: ADMIN,
        action: 'map.precise_location.unlock',
        meta: { reason: 'signalement de disparition', until: res.until },
      },
    });
  });

  it('revoke: key dropped, closure audited', async () => {
    const { service, redis, audit } = makeService({ window: OPEN() });

    expect(await service.revokePreciseLocation(ADMIN)).toEqual({ active: false, until: null });
    expect(redis.del).toHaveBeenCalledWith(GPS_KEY);
    expect(audit.log).toHaveBeenCalledWith(ADMIN, 'precise_location_revoke');
  });

  it('the window belongs to ONE admin: another admin stays locked out', async () => {
    const { service } = makeService({ window: OPEN() });

    expect((await service.preciseWindow(ADMIN)).active).toBe(true);
    expect((await service.preciseWindow('admin-2')).active).toBe(false);
  });
});

describe('AdminMapService — listing', () => {
  /** The `where` Prisma was called with on the list query. */
  const whereOf = (m: jest.Mock): Record<string, unknown> =>
    ((m.mock.calls as unknown[][])[0]![0] as { where: Record<string, unknown> }).where;

  it('filters live in the SQL clause, never after the query', async () => {
    const { service, findMany } = makeService();

    await service.listUsers(ADMIN, {
      limit: 50,
      q: 'aicha',
      countryCode: 'FR',
      city: 'Paris',
      status: 'active',
      privacyLevel: 'private',
      side: 'diaspora',
      activeWithinDays: 30,
      hasPosition: true,
    });

    const and = whereOf(findMany).AND as Array<Record<string, unknown>>;
    expect(and).toHaveLength(8);
    expect(and).toContainEqual({ countryCode: 'FR' });
    expect(and).toContainEqual({ status: 'active' });
    expect(and).toContainEqual({ privacyLevel: 'private' });
    expect(and).toContainEqual({ countryCode: { not: null, notIn: ['NE'] } });
    expect(and).toContainEqual({ latitude: { not: null }, longitude: { not: null } });
  });

  it("side 'niger' includes members who never filled in a country", async () => {
    const { service, findMany } = makeService();

    await service.listUsers(ADMIN, { limit: 50, side: 'niger' });

    const and = whereOf(findMany).AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ OR: [{ countryCode: null }, { countryCode: 'NE' }] });
  });

  it('no privacy gate: the console sees private accounts, and says so in the audit', async () => {
    const { service, findMany, audit } = makeService();

    const page = await service.listUsers(ADMIN, { limit: 50 });

    expect(whereOf(findMany)).toEqual({});
    expect(page.items[0]!.privacyLevel).toBe('private');
    expect(audit.log).toHaveBeenCalledWith(ADMIN, 'admin_map_browse', undefined);
  });

  it('paginates on the cursor and reports the total from the same clause', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => row({ id: `u${i}` }));
    const { service, prisma } = makeService({ rows });
    prisma.user.count = jest.fn(async () => 42) as never;

    const page = await service.listUsers(ADMIN, { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('u1');
    expect(page.total).toBe(42);
  });

  it('friend count sums both sides of the friendship, posts exclude deleted ones', async () => {
    const { service } = makeService();

    const page = await service.listUsers(ADMIN, { limit: 50 });

    expect(page.items[0]!.counts).toEqual({ posts: 3, friends: 3 });
  });

  it('member with nothing to go on: null coordinates, null precision, null source', async () => {
    // No coordinates, no city, and a country the centroid table does not carry.
    const { service } = makeService({
      rows: [row({ latitude: null, longitude: null, city: null, countryCode: 'IT' })],
    });

    const page = await service.listUsers(ADMIN, { limit: 50 });

    expect(page.items[0]!.lat).toBeNull();
    expect(page.items[0]!.lng).toBeNull();
    expect(page.items[0]!.precision).toBeNull();
    expect(page.items[0]!.positionSource).toBeNull();
  });
});

/**
 * No member should fall off the map just because nobody stored coordinates for
 * them. NB: `setWorldCitiesLookup` is not wired in a unit test, so only the
 * hardcoded diaspora table and the country centroids resolve here — the world
 * index tier is exercised in the running app.
 */
describe('AdminMapService — geocoding members with no stored coordinates', () => {
  const noCoords = { latitude: null, longitude: null };

  it('stored coordinates win and are reported as such', async () => {
    const { service } = makeService();

    const [item] = (await service.listUsers(ADMIN, { limit: 50 })).items;

    expect(item!.positionSource).toBe('stored');
    expect(item!.lat).toBe(13.51);
  });

  it('no coordinates but a known city: placed on the city centroid', async () => {
    const { service } = makeService({
      rows: [row({ ...noCoords, city: 'Niamey', countryCode: 'NE' })],
    });

    const [item] = (await service.listUsers(ADMIN, { limit: 50 })).items;

    expect(item!.positionSource).toBe('city');
    expect(item!.precision).toBe('city');
    // resolveCityCentroid is the un-jittered resolver: the exact table value.
    expect(item!.lat).toBe(13.5116);
    expect(item!.lng).toBe(2.1254);
  });

  it('the derived city point is stable across two reads (no jitter)', async () => {
    const { service } = makeService({
      rows: [row({ ...noCoords, city: 'Paris', countryCode: 'FR' })],
    });

    const first = (await service.listUsers(ADMIN, { limit: 50 })).items[0]!;
    const second = (await service.listUsers(ADMIN, { limit: 50 })).items[0]!;

    expect(first.lat).toBe(second.lat);
    expect(first.lng).toBe(second.lng);
  });

  it('country only: placed on the country centre and flagged as such', async () => {
    const { service } = makeService({
      rows: [row({ ...noCoords, city: null, countryCode: 'NE' })],
    });

    const [item] = (await service.listUsers(ADMIN, { limit: 50 })).items;

    expect(item!.positionSource).toBe('country');
    // Country centre of Niger (17.6, 8.08) ± the geocoder's own 0.25° scatter —
    // nowhere near Niamey, which is exactly why the front is told the source.
    expect(item!.lat).toBeGreaterThan(17.3);
    expect(item!.lat).toBeLessThan(17.9);
  });

  it('an unresolvable city still falls back to the country, never to nothing', async () => {
    const { service } = makeService({
      rows: [row({ ...noCoords, city: 'Ville Qui Nexiste Pas', countryCode: 'FR' })],
    });

    const [item] = (await service.listUsers(ADMIN, { limit: 50 })).items;

    expect(item!.positionSource).toBe('country');
    expect(item!.lat).not.toBeNull();
  });

  it('the detail card carries positionSource too, not just the list', async () => {
    // The front draws a 'country' point as a hollow ring and says so in words.
    // Dropping the field from either route would make that screen lie, and it
    // would do so silently — the client types it optional.
    const { service, prisma } = makeService();
    prisma.user.findUnique = jest.fn(async () => ({
      ...row({ ...noCoords, city: null, countryCode: 'NE' }),
      email: 'a@example.com',
      phone: null,
      bio: null,
      languages: ['fr'],
      lastLoginAt: null,
      invitedBy: null,
    })) as never;

    const detail = await service.getUser(ADMIN, 'u1');

    expect(detail.positionSource).toBe('country');
    expect(detail.lat).not.toBeNull();
  });

  it('withoutPosition counts only the truly unplaceable', async () => {
    // Mirrors production: one member with city+country only, two with nothing.
    const { service, groupBy } = makeService({
      groups: [
        { city: 'Niamey', countryCode: 'NE', _count: { _all: 1 } },
        { city: null, countryCode: null, _count: { _all: 2 } },
      ],
    });

    const page = await service.listUsers(ADMIN, { limit: 50 });

    expect(page.withoutPosition).toBe(2);
    // Grouped on the (city, country) pair, so the resolver runs once per pair
    // rather than once per member.
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['city', 'countryCode'] }),
    );
  });

  it('a country with no centroid entry counts as unplaceable', async () => {
    const { service } = makeService({
      groups: [{ city: null, countryCode: 'IT', _count: { _all: 4 } }],
    });

    expect((await service.listUsers(ADMIN, { limit: 50 })).withoutPosition).toBe(4);
  });
});

describe('AdminMapService — facets', () => {
  const facetGroups = (calls: jest.Mock, n: number): Record<string, unknown> =>
    (calls.mock.calls as unknown[][])[n]![0] as Record<string, unknown>;

  it('returns ISO codes and counts, never country names', async () => {
    const { service, prisma } = makeService();
    prisma.user.groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { countryCode: 'FR', _count: { _all: 12 } },
        { countryCode: null, _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([{ city: 'Paris', countryCode: 'FR', _count: { _all: 9 } }])
      .mockResolvedValueOnce([{ status: 'active', _count: { _all: 15 } }]) as never;

    const facets = await service.facets({});

    // The null-country bucket has no code to filter on, so it is dropped.
    expect(facets.countries).toEqual([{ code: 'FR', count: 12 }]);
    expect(facets.cities).toEqual([{ city: 'Paris', countryCode: 'FR', count: 9 }]);
    expect(facets.statuses).toEqual([{ value: 'active', count: 15 }]);
    expect(JSON.stringify(facets)).not.toContain('France');
  });

  it('each facet ignores the filter it drives, so a choice can be undone', async () => {
    const { service, groupBy } = makeService();

    await service.facets({ countryCode: 'FR', city: 'Paris', status: 'active' });

    // countries facet: no countryCode clause, but city + status still applied.
    const countries = facetGroups(groupBy, 0).where as { AND: unknown[] };
    expect(countries.AND).not.toContainEqual({ countryCode: 'FR' });
    expect(countries.AND).toContainEqual({ status: 'active' });

    // cities facet: no city clause, but countryCode still applied.
    const cities = facetGroups(groupBy, 1).where as { AND: unknown[] };
    expect(cities.AND).not.toContainEqual({ city: { contains: 'Paris', mode: 'insensitive' } });
    expect(cities.AND).toContainEqual({ countryCode: 'FR' });

    // statuses facet: no status clause.
    const statuses = facetGroups(groupBy, 2).where as { AND: unknown[] };
    expect(statuses.AND).not.toContainEqual({ status: 'active' });
    expect(statuses.AND).toContainEqual({ countryCode: 'FR' });
  });

  it('the city list is bounded — free text must not become an endless dropdown', async () => {
    const { service, groupBy } = makeService();

    await service.facets({});

    expect(facetGroups(groupBy, 1).take).toBe(200);
  });
});
