import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';

function makeRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      del: jest.fn(async (k: string) => {
        store.delete(k);
        return 1;
      }),
      pipeline: jest.fn(() => ({
        del: jest.fn().mockReturnThis(),
        exec: jest.fn(async () => []),
      })),
    },
  };
}

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

describe('PostsService', () => {
  it('rejects association post without associationId', async () => {
    const prisma = { post: {}, friendship: {} } as never;
    const svc = new PostsService(prisma, makeRedis() as never, makeBlocks() as never);
    await expect(
      svc.create('u1', { content: 'x', visibility: 'association' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create persists a post with media and invalidates cache', async () => {
    const prisma = {
      post: { create: jest.fn(async () => ({ id: 'p1', authorId: 'u1' })) },
      friendship: { findMany: jest.fn(async () => []) },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never);
    const result = await svc.create('u1', {
      content: 'hello',
      visibility: 'friends',
      media: [{ mediaUrl: 'https://cdn/x.jpg', mediaType: 'image' }],
    });
    expect(result.id).toBe('p1');
  });

  it('refuses to edit a post older than 24h', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const prisma = {
      post: {
        findUnique: jest.fn(async () => ({
          id: 'p1',
          authorId: 'u1',
          createdAt: old,
          deletedAt: null,
        })),
      },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never);
    await expect(svc.update('u1', 'p1', { content: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('only author can delete', async () => {
    const prisma = {
      post: {
        findUnique: jest.fn(async () => ({
          id: 'p1',
          authorId: 'other',
          deletedAt: null,
        })),
      },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never);
    await expect(svc.softDelete('u1', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getById rejects when viewer is blocked by author', async () => {
    const prisma = {
      post: {
        findFirst: jest.fn(async () => ({
          id: 'p1',
          authorId: 'other',
          deletedAt: null,
          visibility: 'public',
          associationId: null,
          media: [],
          author: {},
          likes: [],
        })),
      },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks(true) as never);
    await expect(svc.getById('viewer', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertCanViewPost lets the author see their own friends-only post without a friendship lookup', async () => {
    const prisma = {
      post: {
        findFirst: jest.fn(async () => ({
          id: 'p1',
          authorId: 'me',
          visibility: 'friends',
          associationId: null,
        })),
      },
      friendship: { count: jest.fn() },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never);
    const result = await svc.assertCanViewPost('me', 'p1');
    expect(result.id).toBe('p1');
    // Must short-circuit — counting friendships against yourself would be
    // wasteful and is the wrong semantics anyway.
    expect(prisma.friendship.count).not.toHaveBeenCalled();
  });

  it('assertCanViewPost 404s a friends-only post for a non-friend viewer', async () => {
    const prisma = {
      post: {
        findFirst: jest.fn(async () => ({
          id: 'p1',
          authorId: 'other',
          visibility: 'friends',
          associationId: null,
        })),
      },
      friendship: { count: jest.fn(async () => 0) },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never);
    await expect(svc.assertCanViewPost('viewer', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertCanViewPost 404s an association post for a non-member viewer', async () => {
    const prisma = {
      post: {
        findFirst: jest.fn(async () => ({
          id: 'p1',
          authorId: 'other',
          visibility: 'association',
          associationId: 'a1',
        })),
      },
      associationMember: { count: jest.fn(async () => 0) },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never);
    await expect(svc.assertCanViewPost('viewer', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertCanViewPost lets a public post be viewed by anyone', async () => {
    const prisma = {
      post: {
        findFirst: jest.fn(async () => ({
          id: 'p1',
          authorId: 'other',
          visibility: 'public',
          associationId: null,
        })),
      },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never);
    const result = await svc.assertCanViewPost('viewer', 'p1');
    expect(result.id).toBe('p1');
  });
});
