import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ServicesService } from './services.service';

describe('ServicesService', () => {
  it('rejects responding to own request', async () => {
    const prisma = {
      serviceRequest: {
        findUnique: jest.fn(async () => ({ id: 'r1', authorId: 'me', status: 'open' })),
      },
    };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never);
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
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never);
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
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never);
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
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never);
    await expect(svc.resolve('me', 'r1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound on unknown request', async () => {
    const prisma = { serviceRequest: { findUnique: jest.fn(async () => null) } };
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never);
    await expect(svc.getById('x')).rejects.toBeInstanceOf(NotFoundException);
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
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never);
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
    const svc = new ServicesService(prisma as never, { create: jest.fn() } as never);

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
});
