import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ProfileService } from './profile.service';

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
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never);
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
    const svc = new ProfileService(prisma as never, redis as never, makeS3() as never);
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
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never);
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
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never);
    const result = await svc.getById('viewer', 'other');
    expect(result.id).toBe('other');
  });

  it('friends-only profile returns NotFound when not friend', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'other',
          privacyLevel: 'friends',
          status: 'active',
        })),
      },
      $queryRaw: jest.fn(async () => [{ count: 0n }]),
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never);
    await expect(svc.getById('viewer', 'other')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prevents deleting photos owned by others', async () => {
    const prisma = {
      userPhoto: {
        findUnique: jest.fn(async () => ({ id: 'p1', userId: 'other' })),
        delete: jest.fn(),
      },
    };
    const svc = new ProfileService(prisma as never, makeRedis() as never, makeS3() as never);
    await expect(svc.deletePhoto('me', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
