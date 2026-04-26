import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AssociationService } from './association.service';

function makeNotifsStub() {
  return { create: jest.fn(async () => ({ id: 'n1' })) };
}

describe('AssociationService', () => {
  it('requires identity verification to create an association', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ identityStatus: 'not_submitted' })) },
    };
    const svc = new AssociationService(prisma as never, makeNotifsStub() as never);
    await expect(
      svc.create('u1', {
        name: 'A',
        category: 'generaliste',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('conflict when joining twice (already approved)', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ userId: 'u1', status: 'approved' })),
      },
    };
    const svc = new AssociationService(prisma as never, makeNotifsStub() as never);
    await expect(svc.join('u1', 'a1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('conflict when a pending request is already open', async () => {
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => ({ userId: 'u1', status: 'pending' })),
      },
    };
    const svc = new AssociationService(prisma as never, makeNotifsStub() as never);
    await expect(svc.join('u1', 'a1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('join on approval-required association creates pending membership and notifies admins', async () => {
    const create = jest.fn(async () => ({ userId: 'u1', status: 'pending' }));
    const notifs = makeNotifsStub();
    const prisma = {
      associationMember: {
        findUnique: jest.fn(async () => null),
        create,
        findMany: jest.fn(async () => [{ userId: 'admin1' }, { userId: 'admin2' }]),
      },
      association: {
        findUnique: jest.fn(async () => ({
          id: 'a1',
          name: 'Club Niamey',
          requiresApproval: true,
        })),
      },
      user: {
        findUnique: jest.fn(async () => ({ displayName: 'Aïcha', firstName: 'Aïcha' })),
      },
    };
    const svc = new AssociationService(prisma as never, notifs as never);
    const result = (await svc.join('u1', 'a1')) as { pending: boolean };
    expect(result.pending).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending' }) }),
    );
    expect(notifs.create).toHaveBeenCalledTimes(2);
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
    const svc = new AssociationService(prisma as never, makeNotifsStub() as never);
    await expect(svc.leave('u1', 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound on unknown association', async () => {
    const prisma = { association: { findUnique: jest.fn(async () => null) } };
    const svc = new AssociationService(prisma as never, makeNotifsStub() as never);
    await expect(svc.getById('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
