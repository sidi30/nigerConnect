import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ServicesService } from './services.service';
import { createServiceSchema } from './dto/service.dto';

// Passthrough S3 stub: echoes the URL back as its "canonical" form so we can
// assert it was invoked per-media with the owner id (owner-binding contract).
/** No block relationship between any two users unless a test says otherwise. */
function noBlocks() {
  return { isBlocked: jest.fn(async () => false) };
}

const passthroughS3 = () => ({
  assertOwnedPublicImage: jest.fn(async (url: string) => `cdn:${url}`),
});

describe('ServicesService', () => {
  it('rejects responding to own request', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ id: 'r1', authorId: 'me', status: 'open' })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(svc.respond('me', 'r1', { message: 'hi' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects responding to closed request', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ id: 'r1', authorId: 'other', status: 'resolved' })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(svc.respond('me', 'r1', { message: 'hi' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects rating before resolution', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ authorId: 'me', status: 'open' })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(
      svc.rate('me', 'r1', { ratedUserId: 'u2', rating: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only author can resolve request', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ id: 'r1', authorId: 'other', status: 'open' })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(svc.resolve('me', 'r1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound on unknown request', async () => {
    const prisma = { serviceRequest: { findUnique: jest.fn(async () => null) } };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(svc.getById('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- S4 E-MARKET (M2) ---------------------------------------------------

  it('(a) create binds each media URL to the owner before persisting', async () => {
    const s3 = passthroughS3();
    const prisma = {
      serviceRequest: {
        create: jest.fn(async () => ({ id: 'r1' })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, s3 as never, noBlocks() as never);

    await svc.create('me', {
      intent: 'paid_service',
      title: 'Plombier',
      category: 'logement',
      urgency: 'normal',
      budget: '5000',
      media: [
        { mediaUrl: 'https://cdn/x/users/me/photo/1.jpg', mediaType: 'image' },
        { mediaUrl: 'https://cdn/x/users/me/photo/2.jpg', mediaType: 'image' },
      ],
    } as never);

    // Both gallery URLs were owner-bound with the caller's id (no raw URL kept).
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledTimes(2);
    expect(s3.assertOwnedPublicImage).toHaveBeenNthCalledWith(1, 'https://cdn/x/users/me/photo/1.jpg', 'me');
    expect(s3.assertOwnedPublicImage).toHaveBeenNthCalledWith(2, 'https://cdn/x/users/me/photo/2.jpg', 'me');
    const calls = prisma.serviceRequest.create.mock.calls as unknown as Array<
      [{ data: { media: { createMany: { data: Array<{ mediaUrl: string; sortOrder: number }> } } } }]
    >;
    const persisted = calls[0]![0].data.media.createMany.data;
    expect(persisted.map((m) => m.mediaUrl)).toEqual([
      'cdn:https://cdn/x/users/me/photo/1.jpg',
      'cdn:https://cdn/x/users/me/photo/2.jpg',
    ]);
    expect(persisted.map((m) => m.sortOrder)).toEqual([0, 1]);
  });

  it('(b) Zod rejects a budget on a help_free request', () => {
    const parsed = createServiceSchema.safeParse({
      intent: 'help_free',
      title: 'Besoin d aide',
      category: 'autre',
      budget: '2000',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.budget).toBeTruthy();
    }
  });

  it('(b bis) Zod accepts help_free without a budget, defaults intent', () => {
    const parsed = createServiceSchema.safeParse({
      title: 'Besoin d aide',
      category: 'autre',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.intent).toBe('help_free');
  });

  it('(c) update by a non-owner is forbidden (no IDOR)', async () => {
    const s3 = passthroughS3();
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ authorId: 'someone_else', intent: 'help_free', budget: null })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, s3 as never, noBlocks() as never);
    await expect(svc.update('me', 'r1', { title: 'hijack' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Guard fires before any media binding.
    expect(s3.assertOwnedPublicImage).not.toHaveBeenCalled();
  });

  it('(d) create propagates the rejection when a media URL is not owned', async () => {
    const s3 = {
      assertOwnedPublicImage: jest.fn(async () => {
        throw new BadRequestException('Media does not belong to you');
      }),
    };
    const prisma = { serviceRequest: { create: jest.fn() } };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, s3 as never, noBlocks() as never);

    await expect(
      svc.create('me', {
        intent: 'help_free',
        title: 'x',
        category: 'autre',
        urgency: 'normal',
        media: [{ mediaUrl: 'https://cdn/x/users/attacker/photo/1.jpg', mediaType: 'image' }],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nothing persisted once the owner guard refuses the foreign key.
    expect(prisma.serviceRequest.create).not.toHaveBeenCalled();
  });

  it('(c bis) delete by a non-owner is forbidden and never hits the DB', async () => {
    const del = jest.fn();
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ authorId: 'someone_else' })),
        delete: del,
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(svc.remove('me', 'r1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(del).not.toHaveBeenCalled();
  });

  it('(e) update rebinds each replacement-gallery URL to the owner (userId, not body)', async () => {
    const s3 = passthroughS3();
    const update = jest.fn(async () => ({ id: 'r1' }));
    const deleteMany = jest.fn();
    const createMany = jest.fn();
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ authorId: 'me', intent: 'paid_service', budget: '10' })),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          serviceMedia: { deleteMany, createMany },
          serviceRequest: { update },
        }),
      ),
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, s3 as never, noBlocks() as never);

    await svc.update('me', 'r1', {
      media: [
        { mediaUrl: 'https://cdn/x/users/me/photo/9.jpg', mediaType: 'image' },
      ],
    } as never);

    // Owner binding uses the authenticated caller id, and the old gallery is
    // wiped before recreate (full-replacement semantics).
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith('https://cdn/x/users/me/photo/9.jpg', 'me');
    expect(deleteMany).toHaveBeenCalledWith({ where: { requestId: 'r1' } });
    const persisted = createMany.mock.calls[0]![0].data as Array<{ mediaUrl: string; requestId: string }>;
    expect(persisted[0]!.mediaUrl).toBe('cdn:https://cdn/x/users/me/photo/9.jpg');
    expect(persisted[0]!.requestId).toBe('r1');
  });

  it('update budget onto a request that stays help_free is rejected', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ authorId: 'me', intent: 'help_free', budget: null })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(svc.update('me', 'r1', { budget: '999' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects rating a user who never responded to the request', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ authorId: 'me', status: 'resolved' })),
      },
      serviceResponse: {
        findFirst: jest.fn(async () => null),
      },
      serviceRating: {
        upsert: jest.fn(),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);
    await expect(
      svc.rate('me', 'r1', { ratedUserId: 'stranger', rating: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.serviceRating.upsert).not.toHaveBeenCalled();
  });

  it('does not stack a second rating for the same (requestId, ratedUserId)', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ authorId: 'me', status: 'resolved' })),
      },
      serviceResponse: {
        findFirst: jest.fn(async () => ({ id: 'resp1' })),
      },
      serviceRating: {
        create: jest.fn(),
        upsert: jest.fn(async () => ({ id: 'rating1' })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never, passthroughS3() as never, noBlocks() as never);

    await svc.rate('me', 'r1', { ratedUserId: 'u2', rating: 4 });
    await svc.rate('me', 'r1', { ratedUserId: 'u2', rating: 2 });

    // Idempotent on the unique (requestId, ratedUserId) pair: upsert, never a raw create.
    expect(prisma.serviceRating.create).not.toHaveBeenCalled();
    expect(prisma.serviceRating.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.serviceRating.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { requestId_ratedUserId: { requestId: 'r1', ratedUserId: 'u2' } },
      }),
    );
  });

  it('a blocked member cannot answer a help request from the blocker', async () => {
    // A response carries free text plus a notification straight to the author —
    // that is a messaging channel, and a block must close it like it does chat.
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ id: 'r1', authorId: 'author', status: 'open' })),
      },
      serviceResponse: { create: jest.fn() },
    };
    const blocks = { isBlocked: jest.fn(async () => true) };
    const svc = new ServicesService(
      prisma as never,
      { create: jest.fn() } as never,
      passthroughS3() as never,
      blocks as never,
    );

    await expect(svc.respond('blocked-user', 'r1', { message: 'coucou' } as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.serviceResponse.create).not.toHaveBeenCalled();
  });
});
