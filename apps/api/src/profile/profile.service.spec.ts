import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ProfileService } from './profile.service';

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

function makeRedis() {
  const store = new Map<string, string>();
  const client = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => {
      store.delete(k);
      return 1;
    }),
  };
  return { client, __store: store };
}

function makeS3() {
  return {
    createPresignedUpload: jest.fn(async () => ({
      uploadUrl: 'https://s3.example/upload',
      publicUrl: 'https://cdn.example/key',
      key: 'key',
      expiresIn: 600,
    })),
    // Mirrors S3Service.assertOwnedPublicImage: echoes back a canonical URL.
    assertOwnedPublicImage: jest.fn(async (url: string) => `https://cdn.example/${url}`),
  };
}

describe('ProfileService', () => {
  it('throws NotFoundException when user does not exist', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => null), update: jest.fn() },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await expect(svc.getMe('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates profile fields and invalidates cache', async () => {
    const redis = makeRedis();
    redis.__store.set('profile:u1', JSON.stringify({ id: 'u1' }));
    const prisma = {
      user: {
        update: jest.fn(async () => ({ id: 'u1', bio: 'hello', privacyLevel: 'friends' })),
      },
    };
    const svc = new ProfileService(prisma as never, redis as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.updateMe('u1', { bio: 'hello' });
    expect(result.bio).toBe('hello');
    expect(redis.client.del).toHaveBeenCalledWith('profile:u1');
  });

  it('recomputes coordinates when the city changes without explicit coords', async () => {
    const update = jest.fn(async (args: { data: { latitude?: number; longitude?: number } }) => ({
      id: 'u1',
      ...args.data,
    }));
    const prisma = { user: { update } };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    // City + country both provided → no need to read the current row.
    await svc.updateMe('u1', { city: 'Lyon', countryCode: 'FR' });
    const data = update.mock.calls[0]![0].data;
    // Lyon is ~45.76 / 4.84; jitter is ±0.02 so a loose range is enough.
    expect(data.latitude).toBeGreaterThan(45.7);
    expect(data.latitude).toBeLessThan(45.8);
    expect(data.longitude).toBeGreaterThan(4.8);
    expect(data.longitude).toBeLessThan(4.9);
  });

  it('rejects client coordinates that do not match the claimed city (anti-spoof) and uses the city centroid', async () => {
    // Security: latitude/longitude are a city-coarse, publicly read pin. A client
    // sending (1, 2) while claiming Lyon must NOT move the pin to those coords —
    // we fall back to the jittered Lyon centroid (mirrors the register guard).
    const update = jest.fn(async (args: { data: { latitude?: number; longitude?: number } }) => ({
      id: 'u1',
      ...args.data,
    }));
    const prisma = { user: { update } };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await svc.updateMe('u1', { city: 'Lyon', countryCode: 'FR', latitude: 1, longitude: 2 });
    const data = update.mock.calls[0]![0].data;
    expect(data.latitude).toBeGreaterThan(45.7);
    expect(data.latitude).toBeLessThan(45.8);
    expect(data.longitude).toBeGreaterThan(4.8);
    expect(data.longitude).toBeLessThan(4.9);
  });

  it('jitters raw client coordinates so the stored pin is never the exact device GPS', async () => {
    // BUG 3 scenario: a user with no resolvable city (e.g. OAuth sign-up) sends a
    // live GPS fix. There is no centroid to validate against, but the value is
    // still jittered (±0.02°) so the public pin never equals the precise location.
    const update = jest.fn(async (args: { data: { latitude?: number; longitude?: number } }) => ({
      id: 'u1',
      ...args.data,
    }));
    const findUnique = jest.fn(async () => ({ city: null, countryCode: null }));
    const prisma = { user: { update, findUnique } };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const exactLat = 48.86543;
    const exactLon = 2.33456;
    await svc.updateMe('u1', { latitude: exactLat, longitude: exactLon });
    const data = update.mock.calls[0]![0].data;
    expect(data.latitude).not.toBe(exactLat);
    expect(data.longitude).not.toBe(exactLon);
    // Jitter stays within ±half the COORD_JITTER span (0.04° → ±0.02°).
    expect(Math.abs(data.latitude! - exactLat)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(data.longitude! - exactLon)).toBeLessThanOrEqual(0.02);
  });

  it('reads the stored country when only the city changes, to geocode the move', async () => {
    const update = jest.fn(async (args: { data: { latitude?: number; longitude?: number } }) => ({
      id: 'u1',
      ...args.data,
    }));
    const findUnique = jest.fn(async () => ({ city: 'Paris', countryCode: 'FR' }));
    const prisma = { user: { update, findUnique } };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await svc.updateMe('u1', { city: 'Marseille' });
    expect(findUnique).toHaveBeenCalled();
    const data = update.mock.calls[0]![0].data;
    // Marseille ~43.30 / 5.37 (FR resolved from the stored row).
    expect(data.latitude).toBeGreaterThan(43.2);
    expect(data.latitude).toBeLessThan(43.4);
  });

  it('returns private profile as NotFound when viewer is not owner', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'private',
          status: 'active',
        })),
      },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await expect(svc.getById('viewer', 'other')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns public profile to any viewer', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'public',
          status: 'active',
        })),
      },
      userPhoto: { count: jest.fn(async () => 3) },
      friendship: { count: jest.fn(async () => 7) },
      associationMember: { findMany: jest.fn(async () => []) },
      post: { count: jest.fn(async () => 12) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.getById('viewer', 'other');
    expect(result.id).toBe('other');
    // Public profile: real totals, uncapped by any page size.
    expect(result.friendsCount).toBe(7);
    expect(result.postsCount).toBe(12);
    expect(result.photosCount).toBe(3);
  });

  it('friends-only profile returns the basic header to any viewer (so search hits stay clickable)', async () => {
    // Regression: previously 404'd when viewer was not a friend, which made
    // tapping a friends-only result on the map look like the profile vanished.
    // The header is the same fields already exposed by /profile/search and
    // /geo/members, so no new info is leaked.
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'friends',
          status: 'active',
        })),
      },
      userPhoto: { count: jest.fn(async () => 3) },
      friendship: { count: jest.fn(async () => 0) },
      post: { count: jest.fn(async () => 12) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.getById('viewer', 'other');
    expect(result.id).toBe('other');
    expect(result.privacyLevel).toBe('friends');
    // SECURITY: viewer is a stranger (0 accepted friendship rows) — the real
    // network size must NOT leak, and must be `null` (not 0, which would
    // itself be information the viewer isn't entitled to).
    expect(result.friendsCount).toBeNull();
    expect(result.postsCount).toBeNull();
    // photosCount is never gated beyond the header itself (see getPhotos).
    expect(result.photosCount).toBe(3);
  });

  it('listFriendsOf 404s when target is friends-only and viewer is not actually a friend', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'friends',
          status: 'active',
        })),
      },
      friendship: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(),
      },
      block: { findMany: jest.fn(async () => []) },
      userPhoto: { count: jest.fn(async () => 0) },
      post: { count: jest.fn(async () => 0) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await expect(svc.listFriendsOf('viewer', 'other')).rejects.toBeInstanceOf(NotFoundException);
    // We must NOT have queried the friendship list — the privacy gate
    // short-circuits before any data is read.
    expect(prisma.friendship.findMany).not.toHaveBeenCalled();
  });

  it('listFriendsOf returns the friend list to friends of a friends-only target', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'friends',
          status: 'active',
        })),
      },
      friendship: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => []),
      },
      block: { findMany: jest.fn(async () => []) },
      userPhoto: { count: jest.fn(async () => 0) },
      associationMember: { findMany: jest.fn(async () => []) },
      post: { count: jest.fn(async () => 0) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.listFriendsOf('viewer', 'other');
    expect(result.items).toEqual([]);
    expect(prisma.friendship.findMany).toHaveBeenCalled();
  });

  it('getMe returns the authoritative friends total, not capped by a page size', async () => {
    // Bug this PR fixes: mobile used to derive "nb d'amis" from the length of
    // the first friends-list page (capped ~30). A member with 500 friends
    // showed "30". getMe must return the real Prisma count instead.
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', privacyLevel: 'public' })),
      },
      userPhoto: { count: jest.fn(async () => 4) },
      friendship: { count: jest.fn(async () => 500) },
      post: { count: jest.fn(async () => 42) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.getMe('u1');
    // Page size elsewhere in this file (listFriendsOf) defaults/caps at 30.
    expect(result.friendsCount).toBe(500);
    expect(result.friendsCount).toBeGreaterThan(30);
    expect(result.postsCount).toBe(42);
    expect(result.photosCount).toBe(4);
  });

  it('getById of a friends-only profile viewed by an ACCEPTED friend reveals the real counts', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'friends',
          status: 'active',
        })),
      },
      userPhoto: { count: jest.fn(async () => 1) },
      friendship: { count: jest.fn(async () => 1) },
      associationMember: { findMany: jest.fn(async () => []) },
      post: { count: jest.fn(async () => 9) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.getById('viewer', 'other');
    expect(result.friendsCount).toBe(1);
    expect(result.postsCount).toBe(9);
  });

  it('stranger of a PUBLIC profile counts only PUBLIC posts, not friends-only ones', async () => {
    // BUG (S3 MEDIUM): loadCounts counted ALL non-story posts regardless of
    // per-post visibility. A stranger opening a public profile saw the header
    // total include `friends`/`association` posts they can't actually list —
    // the header diverged from the wall AND minorly leaked how many restricted
    // posts exist. postsCount must mirror getUserPosts: a stranger of a public
    // profile counts `public` posts only.
    const TOTAL = 12; // e.g. 4 public + 8 friends-only
    const PUBLIC_ONLY = 4;
    const postCount = jest.fn(async (args: { where: { visibility?: unknown } }) =>
      args.where.visibility === 'public' ? PUBLIC_ONLY : TOTAL,
    );
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'public',
          status: 'active',
        })),
      },
      userPhoto: { count: jest.fn(async () => 0) },
      // Viewer is NOT an accepted friend of the target.
      friendship: { count: jest.fn(async () => 0) },
      associationMember: { findMany: jest.fn(async () => []) },
      post: { count: postCount },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.getById('viewer', 'other');
    // Only PUBLIC posts are counted — not the friends-only ones the stranger
    // cannot see on the wall.
    expect(result.postsCount).toBe(PUBLIC_ONLY);
    expect(result.postsCount).not.toBe(TOTAL);
    // The count query was scoped to public visibility (mirrors getUserPosts).
    expect(postCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorId: 'other',
          isStory: false,
          deletedAt: null,
          visibility: 'public',
        }),
      }),
    );
  });

  it('validates the avatar URL against the owner bucket before storing it', async () => {
    const s3 = makeS3();
    const prisma = {
      user: { update: jest.fn(async (args: { data: { avatarUrl: string | null } }) => ({ id: 'u1', avatarUrl: args.data.avatarUrl })) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, s3 as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    const result = await svc.updateAvatar('u1', 'https://cdn.example/users/u1/avatar/a.jpg');
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith(
      'https://cdn.example/users/u1/avatar/a.jpg',
      'u1',
    );
    // Stored value is the canonical URL returned by the validator, not the raw input.
    expect(result.avatarUrl).toBe('https://cdn.example/https://cdn.example/users/u1/avatar/a.jpg');
  });

  it('clears the avatar without hitting S3 when null is passed', async () => {
    const s3 = makeS3();
    const prisma = { user: { update: jest.fn(async () => ({ id: 'u1', avatarUrl: null })) } };
    const svc = new ProfileService(prisma as never, makeRedis() as never, s3 as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await svc.updateAvatar('u1', null);
    expect(s3.assertOwnedPublicImage).not.toHaveBeenCalled();
  });

  it('does not search by email (no enumeration)', async () => {
    const findMany = jest.fn(async (_args: { where: { AND: Array<{ OR?: unknown[] }> } }) => []);
    const prisma = {
      $queryRawUnsafe: jest.fn(() => 'TRUE'),
      user: { findMany },
      block: { findMany: jest.fn(async () => []) },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await svc.search('viewer', { q: 'foo@bar.com', limit: 20 } as never);
    const where = findMany.mock.calls[0]![0].where;
    const orClause = where.AND.find((c: { OR?: unknown[] }) => Array.isArray(c.OR))!.OR as Array<
      Record<string, unknown>
    >;
    expect(orClause.some((cond) => 'email' in cond)).toBe(false);
    expect(orClause.map((c) => Object.keys(c)[0])).toEqual(['firstName', 'lastName', 'displayName']);
  });

  it('prevents deleting photos owned by others', async () => {
    const prisma = {
      userPhoto: {
        findUnique: jest.fn(async () => ({ id: 'p1', userId: 'other' })),
        delete: jest.fn(),
      },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never, {} as never, { isAdminFullVisibility: jest.fn(async () => false), isGlobalFullVisibility: jest.fn(async () => false) } as never, { log: jest.fn(async () => undefined), logMapOverride: jest.fn(async () => undefined) } as never);
    await expect(svc.deletePhoto('me', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
