import { HttpException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { ASSOCIATION_MEDIA_QUOTA_BYTES } from '../association/association-storage';

/**
 * B5 — a per-association disk quota.
 *
 * Two properties are worth a test each, because both are invisible in a happy
 * path: the claim must be CONDITIONAL (so two officers publishing at the same
 * instant cannot each pass a check they read before the other wrote), and
 * deleting must give the bytes back (a quota that never frees is an expiry
 * date, not a quota).
 */

const CDN = 'https://cdn.test/';

function makeS3(sizes: Record<string, number> = {}) {
  return {
    parsePublicKey: jest.fn((url: string) => (url.startsWith(CDN) ? url.slice(CDN.length) : null)),
    assertOwnedPublicImage: jest.fn(async (url: string) => url),
    assertOwnedPublicMediaDetailed: jest.fn(async (url: string, _kind: string, prefix: string) => {
      const key = url.slice(CDN.length);
      if (!key.startsWith(prefix)) throw new Error('wrong prefix');
      return { url, bytes: sizes[key] ?? 1024, contentType: 'image/jpeg' };
    }),
    assertOwnedPublicMedia: jest.fn(async (url: string) => url),
    objectSize: jest.fn(async (key: string) => sizes[key] ?? 0),
    deleteObject: jest.fn(async () => undefined),
  };
}

function makeRedis() {
  return {
    get: jest.fn(async () => null),
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
 * Prisma double where `association.updateMany` behaves like Postgres: it
 * applies only to rows matching the WHERE, and reports how many it touched.
 */
function makePrisma(initialBytes: number) {
  const association = { id: 'a1', mediaBytes: initialBytes };
  const db = {
    association: {
      updateMany: jest.fn(async ({ where, data }: { where: never; data: never }) => {
        const w = where as {
          id: string;
          mediaBytes?: { lte?: number; gte?: number; lt?: number };
        };
        if (w.id !== association.id) return { count: 0 };
        const cond = w.mediaBytes;
        if (cond?.lte !== undefined && association.mediaBytes > cond.lte) return { count: 0 };
        if (cond?.gte !== undefined && association.mediaBytes < cond.gte) return { count: 0 };
        if (cond?.lt !== undefined && association.mediaBytes >= cond.lt) return { count: 0 };
        const d = data as { mediaBytes: number | { increment?: number; decrement?: number } };
        if (typeof d.mediaBytes === 'number') association.mediaBytes = d.mediaBytes;
        else if (d.mediaBytes.increment) association.mediaBytes += d.mediaBytes.increment;
        else if (d.mediaBytes.decrement) association.mediaBytes -= d.mediaBytes.decrement;
        return { count: 1 };
      }),
    },
    associationMember: { count: jest.fn(async () => 1), findMany: jest.fn(async () => []) },
    post: {
      create: jest.fn(async () => ({
        id: 'p1',
        authorId: 'u1',
        visibility: 'association',
        associationId: 'a1',
      })),
      findUnique: jest.fn(),
      update: jest.fn(async () => ({ id: 'p1' })),
    },
    friendship: { findMany: jest.fn(async () => []) },
  };
  // Attaché après coup : `$transaction` reçoit le double lui-même, et
  // l'écrire dans le littéral rendrait le type circulaire.
  (db as Record<string, unknown>).$transaction = jest.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  );
  return { db, association };
}

function buildService(prisma: unknown, s3: unknown) {
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

const IMAGE = CDN + 'associations/a1/photo.jpg';
const postDto = {
  content: 'photo',
  visibility: 'association',
  associationId: 'a1',
  media: [{ mediaUrl: IMAGE, mediaType: 'image' }],
};

describe("quota disque d'une association", () => {
  it("compte les octets déposés dans l'espace de l'association", async () => {
    const { db, association } = makePrisma(0);
    const svc = buildService(db, makeS3({ 'associations/a1/photo.jpg': 5_000_000 }));

    await svc.create('u1', postDto as never);

    expect(association.mediaBytes).toBe(5_000_000);
  });

  it('refuse la publication qui ferait déborder, et ne crée alors aucune ligne', async () => {
    const { db } = makePrisma(ASSOCIATION_MEDIA_QUOTA_BYTES - 1_000);
    const svc = buildService(db, makeS3({ 'associations/a1/photo.jpg': 5_000_000 }));

    await expect(svc.create('u1', postDto as never)).rejects.toBeInstanceOf(HttpException);
    expect(db.post.create).not.toHaveBeenCalled();
  });

  it("laisse passer une publication qui tient EXACTEMENT dans ce qui reste", async () => {
    const remaining = 5_000_000;
    const { db, association } = makePrisma(ASSOCIATION_MEDIA_QUOTA_BYTES - remaining);
    const svc = buildService(db, makeS3({ 'associations/a1/photo.jpg': remaining }));

    await svc.create('u1', postDto as never);

    expect(association.mediaBytes).toBe(ASSOCIATION_MEDIA_QUOTA_BYTES);
  });

  it('réclame la place sous condition, pas après une simple lecture', async () => {
    const { db } = makePrisma(0);
    const svc = buildService(db, makeS3({ 'associations/a1/photo.jpg': 5_000_000 }));

    await svc.create('u1', postDto as never);

    const where = db.association.updateMany.mock.calls[0]![0].where as {
      mediaBytes: { lte: number };
    };
    // Sans ce `lte`, deux dirigeants qui publient au même instant passeraient
    // tous les deux : c'est la condition qui fait l'arbitrage, pas la lecture.
    expect(where.mediaBytes.lte).toBe(ASSOCIATION_MEDIA_QUOTA_BYTES - 5_000_000);
  });

  it("ne compte pas une image déposée dans l'espace personnel de l'auteur", async () => {
    const { db, association } = makePrisma(0);
    const svc = buildService(db, makeS3());

    await svc.create('u1', {
      ...postDto,
      media: [{ mediaUrl: CDN + 'users/u1/photo.jpg', mediaType: 'image' }],
    } as never);

    expect(association.mediaBytes).toBe(0);
    expect(db.association.updateMany).not.toHaveBeenCalled();
  });

  it('rend les octets à la suppression, et purge les objets', async () => {
    const sizes = { 'associations/a1/photo.jpg': 5_000_000 };
    const { db, association } = makePrisma(5_000_000);
    const s3 = makeS3(sizes);
    db.post.findUnique = jest.fn(async () => ({
      id: 'p1',
      authorId: 'u1',
      deletedAt: null,
      associationId: 'a1',
      media: [{ mediaUrl: IMAGE, thumbnailUrl: null }],
    })) as never;
    const svc = buildService(db, s3);

    await svc.softDelete('u1', 'p1');

    expect(s3.deleteObject).toHaveBeenCalledWith('associations/a1/photo.jpg');
    expect(association.mediaBytes).toBe(0);
  });

  it("ne purge pas, et ne décompte pas, un média rangé hors de l'espace de l'association", async () => {
    const { db, association } = makePrisma(5_000_000);
    const s3 = makeS3({ 'users/u1/photo.jpg': 5_000_000 });
    db.post.findUnique = jest.fn(async () => ({
      id: 'p1',
      authorId: 'u1',
      deletedAt: null,
      associationId: 'a1',
      media: [{ mediaUrl: CDN + 'users/u1/photo.jpg', thumbnailUrl: null }],
    })) as never;
    const svc = buildService(db, s3);

    await svc.softDelete('u1', 'p1');

    expect(s3.deleteObject).not.toHaveBeenCalled();
    expect(association.mediaBytes).toBe(5_000_000);
  });
});
