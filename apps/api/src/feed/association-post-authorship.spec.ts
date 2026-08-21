import { ForbiddenException } from '@nestjs/common';
import { PostsService } from './posts.service';

/**
 * Publishing under an association's name is reserved to its officers (owner
 * decision, 2026-08-21). Before that, ANY approved member could publish to
 * every other member's feed.
 *
 * The rule lives in a single Prisma `count` filter, which is exactly the kind
 * of line a later refactor drops without anything lighting up — hence a spec
 * that emulates the row rather than stubbing the count to a constant: stubbing
 * `count: () => 1` would keep passing with the role filter removed.
 */

/** One membership row, filtered the way Postgres would filter it. */
function membershipOf(role: 'member' | 'moderator' | 'admin' | 'owner', status = 'approved') {
  return {
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.status !== status) return 0;
      const roleFilter = where.role as { in: string[] } | undefined;
      if (roleFilter && !roleFilter.in.includes(role)) return 0;
      return 1;
    }),
    findMany: jest.fn(async () => []),
  };
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
    client: {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
      pipeline: jest.fn(() => ({ del: jest.fn().mockReturnThis(), exec: jest.fn(async () => []) })),
    },
  };
}

/**
 * S3 stub mirroring the real guards closely enough to be worth trusting:
 * `parsePublicKey` only recognises our own CDN prefix, and each assertion
 * refuses a key outside the space it was asked to check.
 */
function makeS3() {
  const CDN = 'https://cdn.test/';
  return {
    parsePublicKey: jest.fn((url: string) => (url.startsWith(CDN) ? url.slice(CDN.length) : null)),
    assertOwnedPublicImage: jest.fn(async (url: string, ownerId?: string) => {
      const key = url.startsWith(CDN) ? url.slice(CDN.length) : null;
      if (!key) throw new Error('foreign host');
      if (ownerId && !key.startsWith(`users/${ownerId}/`)) throw new Error('not yours');
      return url;
    }),
    assertOwnedPublicMediaDetailed: jest.fn(
      async (url: string, _kind: string, prefix: string) => {
        const key = url.startsWith(CDN) ? url.slice(CDN.length) : null;
        if (!key || !key.startsWith(prefix)) throw new Error('wrong prefix');
        return { url, bytes: 1024, contentType: 'image/jpeg' };
      },
    ),
  };
}

function buildService(prisma: unknown, s3: unknown = makeS3()) {
  return new PostsService(
    prisma as never,
    makeRedis() as never,
    { isBlocked: jest.fn(async () => false) } as never,
    s3 as never,
    { notify: jest.fn(async () => undefined) } as never,
    { isVideoEnabled: jest.fn(async () => false) } as never,
    { sharesContentScope: jest.fn(async () => true) } as never,
  );
}

describe("publier au nom d'une association", () => {
  const dto = { content: 'Assemblée générale samedi', visibility: 'association', associationId: 'a1' };

  it.each(['admin', 'moderator', 'owner'] as const)('laisse publier un %s', async (role) => {
    const prisma = {
      associationMember: membershipOf(role),
      post: {
        create: jest.fn(async () => ({
          id: 'p1',
          authorId: 'u1',
          visibility: 'association',
          associationId: 'a1',
        })),
      },
      friendship: { findMany: jest.fn(async () => []) },
    };
    const svc = buildService(prisma);

    const post = await svc.create('u1', dto as never);

    expect(post.id).toBe('p1');
    expect(prisma.post.create).toHaveBeenCalled();
  });

  it('refuse un membre simple, même approuvé', async () => {
    const prisma = {
      associationMember: membershipOf('member'),
      post: { create: jest.fn() },
    };
    const svc = buildService(prisma);

    await expect(svc.create('u1', dto as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('refuse un dirigeant dont l’adhésion est encore en attente', async () => {
    const prisma = {
      associationMember: membershipOf('admin', 'pending'),
      post: { create: jest.fn() },
    };
    const svc = buildService(prisma);

    await expect(svc.create('u1', dto as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('demande bien les trois rôles dirigeants, et seulement eux', async () => {
    const membership = membershipOf('admin');
    const prisma = {
      associationMember: membership,
      post: {
        create: jest.fn(async () => ({
          id: 'p1',
          authorId: 'u1',
          visibility: 'association',
          associationId: 'a1',
        })),
      },
      friendship: { findMany: jest.fn(async () => []) },
    };
    const svc = buildService(prisma);

    await svc.create('u1', dto as never);

    const where = membership.count.mock.calls[0]![0].where as {
      role: { in: string[] };
      status: string;
      associationId: string;
      userId: string;
    };
    expect(new Set(where.role.in)).toEqual(new Set(['admin', 'moderator', 'owner']));
    expect(where.status).toBe('approved');
    expect(where.associationId).toBe('a1');
    expect(where.userId).toBe('u1');
  });

  it("n'impose rien de tout cela à une publication ordinaire", async () => {
    const membership = membershipOf('member');
    const prisma = {
      associationMember: membership,
      post: { create: jest.fn(async () => ({ id: 'p2', authorId: 'u1', visibility: 'public' })) },
      friendship: { findMany: jest.fn(async () => []) },
    };
    const svc = buildService(prisma);

    await svc.create('u1', { content: 'salut', visibility: 'public' } as never);

    expect(membership.count).not.toHaveBeenCalled();
    expect(prisma.post.create).toHaveBeenCalled();
  });
});

/**
 * ADR-002 — an association's images live in the association's own space, not
 * in the personal space of whichever officer happened to upload them. The
 * author's own space stays accepted because the MOBILE app still uploads
 * there; the day it stops, that branch can go.
 */
describe("images d'une publication d'association", () => {
  let prismaDouble: unknown;

  function officerPrisma() {
    const base = {
      associationMember: membershipOf('admin'),
      post: {
        create: jest.fn(async () => ({
          id: 'p1',
          authorId: 'u1',
          visibility: 'association',
          associationId: 'a1',
        })),
      },
      friendship: { findMany: jest.fn(async () => []) },
      // Le quota (B5) réclame la place dans une transaction dès qu'une image
      // atterrit dans l'espace de l'association.
      association: { updateMany: jest.fn(async () => ({ count: 1 })) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaDouble)),
    };
    prismaDouble = base;
    return base;
  }

  const assocPost = (mediaUrl: string) => ({
    content: 'Photo de la fête',
    visibility: 'association',
    associationId: 'a1',
    media: [{ mediaUrl, mediaType: 'image' }],
  });

  it("accepte une image déposée dans l'espace de l'association", async () => {
    const s3 = makeS3();
    const prisma = officerPrisma();
    const svc = buildService(prisma, s3);

    await svc.create('u1', assocPost('https://cdn.test/associations/a1/photo.jpg') as never);

    expect(s3.assertOwnedPublicMediaDetailed).toHaveBeenCalledWith(
      'https://cdn.test/associations/a1/photo.jpg',
      'image',
      'associations/a1/',
    );
    expect(prisma.post.create).toHaveBeenCalled();
  });

  it("refuse une image rangée dans l'espace d'une AUTRE association", async () => {
    const svc = buildService(officerPrisma());

    await expect(
      svc.create('u1', assocPost('https://cdn.test/associations/a2/vol.jpg') as never),
    ).rejects.toBeTruthy();
  });

  it("laisse passer le chemin mobile, qui dépose encore sous users/{id}/", async () => {
    const s3 = makeS3();
    const prisma = officerPrisma();
    const svc = buildService(prisma, s3);

    await svc.create('u1', assocPost('https://cdn.test/users/u1/photo.jpg') as never);

    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith(
      'https://cdn.test/users/u1/photo.jpg',
      'u1',
    );
    expect(prisma.post.create).toHaveBeenCalled();
  });

  it("n'ouvre pas l'espace association aux publications ordinaires", async () => {
    const s3 = makeS3();
    const prisma = {
      associationMember: membershipOf('admin'),
      post: { create: jest.fn() },
      friendship: { findMany: jest.fn(async () => []) },
    };
    const svc = buildService(prisma, s3);

    await expect(
      svc.create('u1', {
        content: 'salut',
        visibility: 'public',
        media: [{ mediaUrl: 'https://cdn.test/associations/a1/photo.jpg', mediaType: 'image' }],
      } as never),
    ).rejects.toBeTruthy();
    expect(s3.assertOwnedPublicMediaDetailed).not.toHaveBeenCalled();
  });
});
