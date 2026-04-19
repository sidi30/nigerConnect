import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AssociationService } from './association.service';

describe('AssociationService', () => {
  it('requires identity verification to create an association', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ identityStatus: 'not_submitted' })) },
    };
    const svc = new AssociationService(prisma as never);
    await expect(
      svc.create('u1', {
        name: 'A',
        category: 'generaliste',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('conflict when joining twice', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ userId: 'u1' })),
      },
    };
    const svc = new AssociationService(prisma as never);
    await expect(svc.join('u1', 'a1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents last admin from leaving', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ userId: 'u1', role: 'admin' })),
        count: jest.fn(async () => 1),
        delete: jest.fn(),
      },
      association: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = new AssociationService(prisma as never);
    await expect(svc.leave('u1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound on unknown association', async () => {
    const prisma = { association: { findUnique: jest.fn(async () => null) } };
    const svc = new AssociationService(prisma as never);
    await expect(svc.getById('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
