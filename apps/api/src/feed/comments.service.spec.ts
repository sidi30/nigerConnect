import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

function makeNotifs() {
  return { create: jest.fn(async () => ({ id: 'n1' })) };
}

function makePostsStub() {
  return {
    invalidateFeedCache: jest.fn(async () => undefined),
    invalidateFeedForUsers: jest.fn(async () => undefined),
  };
}

describe('CommentsService', () => {
  it('throws NotFound if post does not exist', async () => {
    const prisma = {
      post: { findFirst: jest.fn(async () => null) },
      comment: {},
      $transaction: jest.fn(),
    };
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      makeNotifs() as never,
      makePostsStub() as never,
    );
    await expect(svc.create('u1', 'p1', 'hello')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects nested reply beyond one level', async () => {
    const prisma = {
      post: { findFirst: jest.fn(async () => ({ id: 'p1', authorId: 'u2' })) },
      comment: {
        findUnique: jest.fn(async () => ({
          id: 'c-parent',
          postId: 'p1',
          parentId: 'c-grandparent',
        })),
      },
      $transaction: jest.fn(),
    };
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      makeNotifs() as never,
      makePostsStub() as never,
    );
    await expect(svc.create('u1', 'p1', 'hi', 'c-parent')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates comment and increments commentCount in a transaction', async () => {
    const tx = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
    const prisma = {
      post: { findFirst: jest.fn(async () => ({ id: 'p1', authorId: 'u2' })), update: jest.fn() },
      comment: {
        findUnique: jest.fn(),
        create: jest.fn(async () => ({
          id: 'c1',
          content: 'hello',
          author: { id: 'u1', displayName: 'Me', firstName: 'Me', lastName: null },
        })),
      },
      $transaction: tx,
    };
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      makeNotifs() as never,
      makePostsStub() as never,
    );
    const result = await svc.create('u1', 'p1', 'hello');
    expect(result.id).toBe('c1');
    expect(tx).toHaveBeenCalled();
  });
});
