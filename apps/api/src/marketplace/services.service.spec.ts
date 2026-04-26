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
});
