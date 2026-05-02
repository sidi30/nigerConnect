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
  };
}

describe('ProfileService', () => {
  it('throws NotFoundException when user does not exist', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => null), update: jest.fn() },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never);
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
    const svc = new ProfileService(prisma as never, redis as never, makeS3() as never, makeBlocks() as never);
    const result = await svc.updateMe('u1', { bio: 'hello' });
    expect(result.bio).toBe('hello');
    expect(redis.client.del).toHaveBeenCalledWith('profile:u1');
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
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never);
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
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never);
    const result = await svc.getById('viewer', 'other');
    expect(result.id).toBe('other');
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
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never);
    const result = await svc.getById('viewer', 'other');
    expect(result.id).toBe('other');
    expect(result.privacyLevel).toBe('friends');
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
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never);
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
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never);
    const result = await svc.listFriendsOf('viewer', 'other');
    expect(result.items).toEqual([]);
    expect(prisma.friendship.findMany).toHaveBeenCalled();
  });

  it('prevents deleting photos owned by others', async () => {
    const prisma = {
      userPhoto: {
        findUnique: jest.fn(async () => ({ id: 'p1', userId: 'other' })),
        delete: jest.fn(),
      },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never, makeBlocks() as never);
    await expect(svc.deletePhoto('me', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
