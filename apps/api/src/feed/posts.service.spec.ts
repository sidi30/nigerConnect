import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { PostsService } from './posts.service';

function makeRedis(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    del: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    incrementCounter: jest.fn(async (k: string) => {
      const next = Number(store.get(k) ?? '0') + 1;
      store.set(k, String(next));
      return next;
    }),
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
      incrby: jest.fn(async (k: string, n: number) => {
        const next = Number(store.get(k) ?? '0') + n;
        store.set(k, String(next));
        return next;
      }),
      expire: jest.fn(async () => 1),
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

function makeS3(overrides: Record<string, unknown> = {}) {
  return {
    // Echoes back a canonical URL, mirroring assertOwnedPublicImage's contract.
    assertOwnedPublicImage: jest.fn(async (url: string) => url),
    assertOwnedPublicMediaDetailed: jest.fn(async (url: string) => ({
      url,
      bytes: 1024,
      contentType: 'video/mp4',
    })),
    parsePublicKey: jest.fn((url: string) => (url.startsWith('https://cdn/') ? url.slice(12) : null)),
    deleteObject: jest.fn(async () => undefined),
    ...overrides,
  };
}

/** Kill-switch OFF by default (fail-closed), verified by default when overridden. */
function makeSettings(videoEnabled = false) {
  return { isVideoEnabled: jest.fn(async () => videoEnabled) };
}

describe('PostsService', () => {
  it('rejects association post without associationId', async () => {
    const prisma = { post: {}, friendship: {} } as never;
    const svc = new PostsService(prisma, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
    await expect(
      svc.create('u1', { content: 'x', visibility: 'association' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create persists a post with media and invalidates cache', async () => {
    const prisma = {
      post: { create: jest.fn(async () => ({ id: 'p1', authorId: 'u1' })) },
      friendship: { findMany: jest.fn(async () => []) },
    };
    const s3 = makeS3();
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, s3 as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
    const result = await svc.create('u1', {
      content: 'hello',
      visibility: 'friends',
      media: [{ mediaUrl: 'https://cdn/x.jpg', mediaType: 'image' }],
    });
    expect(result.id).toBe('p1');
    // Media URLs must be host-bound before persistence, scoped to the author.
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith('https://cdn/x.jpg', 'u1');
  });

  it('rejects an association post when the author is not an approved member', async () => {
    const prisma = {
      associationMember: { count: jest.fn(async () => 0) },
      post: { create: jest.fn() },
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
    await expect(
      svc.create('u1', { visibility: 'association', associationId: 'a1' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('rejects post media whose URL is not on our bucket', async () => {
    const prisma = { post: { create: jest.fn() } };
    const s3 = {
      assertOwnedPublicImage: jest.fn(async () => {
        throw new BadRequestException('bad');
      }),
    };
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, s3 as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
    await expect(
      svc.create('u1', {
        visibility: 'friends',
        media: [{ mediaUrl: 'https://evil.example/x.jpg', mediaType: 'image' }],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('share refuses a non-public original post', async () => {
    const prisma = {
      post: {
        findFirst: jest.fn(async () => ({
          id: 'p1',
          authorId: 'u1',
          visibility: 'friends',
          associationId: null,
        })),
        create: jest.fn(),
      },
    };
    // Sharer is the author so assertCanViewPost passes, isolating the
    // public-only restriction under test.
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
    await expect(svc.share('u1', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.post.create).not.toHaveBeenCalled();
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
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
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
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
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
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks(true) as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
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
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
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
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
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
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
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
    const svc = new PostsService(prisma as never, makeRedis() as never, makeBlocks() as never, makeS3() as never, { notify: jest.fn(async () => undefined) } as never, makeSettings() as never);
    const result = await svc.assertCanViewPost('viewer', 'p1');
    expect(result.id).toBe('p1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stories VIDEO — kill-switch (inertie), verified gate, quotas, S3 purge.
// ─────────────────────────────────────────────────────────────────────────────
describe('PostsService — stories video', () => {
  const videoMedia = {
    mediaUrl: 'https://cdn/stories/u1/abc.mp4',
    mediaType: 'video' as const,
  };

  function build(opts: {
    videoEnabled?: boolean;
    identityStatus?: string;
    activeVideos?: number;
    redisSeed?: Record<string, string>;
    s3?: Record<string, unknown>;
  }) {
    const postCreate = jest.fn(async () => ({ id: 'p-vid', authorId: 'u1', media: [] }));
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ identityStatus: opts.identityStatus ?? 'approved' })),
      },
      post: {
        count: jest.fn(async () => opts.activeVideos ?? 0),
        create: postCreate,
      },
      friendship: { findMany: jest.fn(async () => []) },
    };
    const redis = makeRedis(opts.redisSeed ?? {});
    const s3 = makeS3(opts.s3 ?? {});
    const svc = new PostsService(
      prisma as never,
      redis as never,
      makeBlocks() as never,
      s3 as never,
      { notify: jest.fn(async () => undefined) } as never,
      makeSettings(opts.videoEnabled ?? false) as never,
    );
    return { svc, prisma, redis, s3, postCreate };
  }

  it('INERTE: rejects a video story when the kill-switch is OFF (no create, code VIDEO_DISABLED)', async () => {
    const { svc, postCreate } = build({ videoEnabled: false });
    await expect(svc.createStory('u1', { media: videoMedia } as never)).rejects.toMatchObject({
      response: { code: 'VIDEO_DISABLED' },
    });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('INERTE: rejects a video presign when the kill-switch is OFF (never signs)', async () => {
    const createPresignedUpload = jest.fn();
    const { svc } = build({ videoEnabled: false, s3: { createPresignedUpload } });
    await expect(
      svc.presignStoryVideo('u1', { contentType: 'video/mp4' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createPresignedUpload).not.toHaveBeenCalled(); // gate cuts before the signer
  });

  it('rejects a video story from a non-verified account (IDENTITY_NOT_APPROVED)', async () => {
    const { svc, postCreate } = build({ videoEnabled: true, identityStatus: 'pending' });
    await expect(svc.createStory('u1', { media: videoMedia } as never)).rejects.toMatchObject({
      response: { code: 'IDENTITY_NOT_APPROVED' },
    });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('rejects when the active-video ceiling (10) is reached (429)', async () => {
    const { svc, postCreate } = build({ videoEnabled: true, activeVideos: 10 });
    await expect(svc.createStory('u1', { media: videoMedia } as never)).rejects.toMatchObject({
      response: { code: 'ACTIVE_VIDEO_QUOTA_EXCEEDED' },
    });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('rejects when the daily upload cap (5) is already spent (429)', async () => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { svc, postCreate } = build({
      videoEnabled: true,
      redisSeed: { [`video:uploads:u1:${day}`]: '5' },
    });
    await expect(svc.createStory('u1', { media: videoMedia } as never)).rejects.toMatchObject({
      response: { code: 'UPLOAD_QUOTA_EXCEEDED' },
    });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('rejects when this upload would breach the 200 Mo/24h byte quota (429)', async () => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { svc, postCreate } = build({
      videoEnabled: true,
      redisSeed: { [`video:bytes:u1:${day}`]: String(200 * 1024 * 1024) },
      s3: {
        assertOwnedPublicMediaDetailed: jest.fn(async (url: string) => ({
          url,
          bytes: 1,
          contentType: 'video/mp4',
        })),
      },
    });
    await expect(svc.createStory('u1', { media: videoMedia } as never)).rejects.toMatchObject({
      response: { code: 'BYTES_QUOTA_EXCEEDED' },
    });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('happy path: binds under stories/{userId}/ (anti-spoof), creates, bumps counters', async () => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const detailed = jest.fn(async (url: string) => ({ url, bytes: 5_000_000, contentType: 'video/mp4' }));
    const { svc, redis, postCreate } = build({
      videoEnabled: true,
      s3: { assertOwnedPublicMediaDetailed: detailed },
    });
    const res = await svc.createStory('u1', { media: videoMedia } as never);
    expect(res.id).toBe('p-vid');
    // Ownership prefix is enforced by passing the caller's stories/ prefix + declared type.
    expect(detailed).toHaveBeenCalledWith(videoMedia.mediaUrl, 'video', 'stories/u1/');
    expect(postCreate).toHaveBeenCalledTimes(1);
    // Daily counters incremented AFTER the create.
    expect(redis.incrementCounter).toHaveBeenCalledWith(`video:uploads:u1:${day}`, 24 * 60 * 60);
    expect(redis.client.incrby).toHaveBeenCalledWith(`video:bytes:u1:${day}`, 5_000_000);
  });

  it('EXISTING image stories keep working while video is OFF (no video gate, uses image binding)', async () => {
    const { svc, s3, postCreate } = build({ videoEnabled: false });
    await svc.createStory('u1', {
      media: { mediaUrl: 'https://cdn/users/u1/x.jpg', mediaType: 'image' },
    } as never);
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith('https://cdn/users/u1/x.jpg', 'u1');
    expect(postCreate).toHaveBeenCalledTimes(1);
  });

  it('presign happy path returns a presigned upload under stories/{userId}', async () => {
    const createPresignedUpload = jest.fn(async () => ({ uploadUrl: 'PUT', key: 'stories/u1/z.mp4' }));
    const { svc } = build({ videoEnabled: true, s3: { createPresignedUpload } });
    const out = await svc.presignStoryVideo('u1', { contentType: 'video/mp4' } as never);
    expect(out).toMatchObject({ key: 'stories/u1/z.mp4' });
    expect(createPresignedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'stories/u1', contentType: 'video/mp4', expiresIn: 900 }),
    );
  });

  it('spoofing (declared video ≠ real image) is rejected by the binding guard (400)', async () => {
    const { svc, postCreate } = build({
      videoEnabled: true,
      s3: {
        assertOwnedPublicMediaDetailed: jest.fn(async () => {
          throw new BadRequestException('Declared media type does not match the uploaded file');
        }),
      },
    });
    await expect(svc.createStory('u1', { media: videoMedia } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('429 quota errors are HttpExceptions with a 429 status', async () => {
    const { svc } = build({ videoEnabled: true, activeVideos: 99 });
    const err = await svc.createStory('u1', { media: videoMedia } as never).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Disk reclamation — S3 purge on manual delete AND on expiry sweep.
// ─────────────────────────────────────────────────────────────────────────────
describe('PostsService — story S3 purge (disk dette corrigée)', () => {
  it('deleteStory purges each media object BEFORE the soft-delete (owner only)', async () => {
    const update = jest.fn(async () => ({}));
    const prisma = {
      post: {
        findUnique: jest.fn(async () => ({
          id: 's1',
          authorId: 'u1',
          isStory: true,
          deletedAt: null,
          media: [{ mediaUrl: 'https://cdn/stories/u1/a.mp4', thumbnailUrl: 'https://cdn/stories/u1/a.jpg' }],
        })),
        update,
      },
    };
    const s3 = makeS3();
    const svc = new PostsService(
      prisma as never,
      makeRedis() as never,
      makeBlocks() as never,
      s3 as never,
      { notify: jest.fn(async () => undefined) } as never,
      makeSettings() as never,
    );
    await svc.deleteStory('u1', 's1');
    // Both the video and its thumbnail get deleteObject'd.
    expect(s3.deleteObject).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });

  it('deleteStory refuses a non-owner (403, no purge)', async () => {
    const s3 = makeS3();
    const prisma = {
      post: {
        findUnique: jest.fn(async () => ({
          id: 's1',
          authorId: 'someone-else',
          isStory: true,
          deletedAt: null,
          media: [],
        })),
        update: jest.fn(),
      },
    };
    const svc = new PostsService(
      prisma as never,
      makeRedis() as never,
      makeBlocks() as never,
      s3 as never,
      { notify: jest.fn(async () => undefined) } as never,
      makeSettings() as never,
    );
    await expect(svc.deleteStory('u1', 's1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(s3.deleteObject).not.toHaveBeenCalled();
  });

  it('deleteExpiredStories purges S3 objects THEN soft-deletes the batch', async () => {
    const findMany = jest
      .fn()
      // First pass returns two expired stories, second pass returns none (loop ends).
      .mockResolvedValueOnce([
        { id: 's1', media: [{ mediaUrl: 'https://cdn/stories/u1/a.mp4', thumbnailUrl: null }] },
        { id: 's2', media: [{ mediaUrl: 'https://cdn/stories/u2/b.mp4', thumbnailUrl: null }] },
      ])
      .mockResolvedValueOnce([]);
    const updateMany = jest.fn(async () => ({ count: 2 }));
    const prisma = { post: { findMany, updateMany } };
    const s3 = makeS3();
    const svc = new PostsService(
      prisma as never,
      makeRedis() as never,
      makeBlocks() as never,
      s3 as never,
      { notify: jest.fn(async () => undefined) } as never,
      makeSettings() as never,
    );
    const count = await svc.deleteExpiredStories();
    expect(count).toBe(2);
    expect(s3.deleteObject).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['s1', 's2'] } } }),
    );
  });
});
