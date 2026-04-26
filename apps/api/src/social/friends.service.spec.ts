import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FriendsService } from './friends.service';

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

function makeNotifs() {
  return { create: jest.fn(async () => ({ id: 'n1' })) };
}

describe('FriendsService', () => {
  it('cannot send request to self', async () => {
    const prisma = { friendship: {}, user: {} } as never;
    const svc = new FriendsService(prisma, makeBlocks() as never, makeNotifs() as never);
    await expect(svc.sendRequest('me', 'me')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks friend request when users are blocked', async () => {
    const prisma = { friendship: {}, user: {} } as never;
    const svc = new FriendsService(prisma, makeBlocks(true) as never, makeNotifs() as never);
    await expect(svc.sendRequest('me', 'other')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound when addressee does not exist', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => null) },
      friendship: { findFirst: jest.fn() },
    };
    const svc = new FriendsService(prisma as never, makeBlocks() as never, makeNotifs() as never);
    await expect(svc.sendRequest('me', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws Conflict when already friends', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 'other' })) },
      friendship: { findFirst: jest.fn(async () => ({ id: 'f1', status: 'accepted' })) },
    };
    const svc = new FriendsService(prisma as never, makeBlocks() as never, makeNotifs() as never);
    await expect(svc.sendRequest('me', 'other')).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a new pending request when none exists', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'other' })
          .mockResolvedValueOnce({ displayName: 'Me', firstName: 'Me', lastName: null }),
      },
      friendship: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'f1' })),
      },
    };
    const svc = new FriendsService(prisma as never, makeBlocks() as never, makeNotifs() as never);
    const result = await svc.sendRequest('me', 'other');
    expect(result.id).toBe('f1');
    expect(prisma.friendship.create).toHaveBeenCalledWith({
      data: { requesterId: 'me', addresseeId: 'other', status: 'pending' },
    });
  });

  it('only the addressee can accept', async () => {
    const prisma = {
      friendship: {
        findUnique: jest.fn(async () => ({ id: 'f1', addresseeId: 'other', status: 'pending' })),
        update: jest.fn(),
      },
    };
    const svc = new FriendsService(prisma as never, makeBlocks() as never, makeNotifs() as never);
    await expect(svc.accept('me', 'f1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accept marks friendship as accepted', async () => {
    const prisma = {
      friendship: {
        findUnique: jest.fn(async () => ({
          id: 'f1',
          addresseeId: 'me',
          requesterId: 'other',
          status: 'pending',
        })),
        update: jest.fn(async () => ({ id: 'f1', status: 'accepted' })),
      },
      user: {
        findUnique: jest.fn(async () => ({
          displayName: 'Me',
          firstName: 'Me',
          lastName: null,
        })),
      },
    };
    const svc = new FriendsService(prisma as never, makeBlocks() as never, makeNotifs() as never);
    const result = await svc.accept('me', 'f1');
    expect(result.status).toBe('accepted');
  });
});
