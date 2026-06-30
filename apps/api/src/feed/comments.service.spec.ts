import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

function makeNotifs() {
  return { create: jest.fn(async () => ({ id: 'n1' })) };
}

function makePostsStub(opts?: {
  assert?: () => Promise<{ id: string; authorId: string; visibility: string; associationId: string | null }>;
}) {
  const defaultAssert = async () => ({
    id: 'p1',
    authorId: 'u2',
    visibility: 'public',
    associationId: null,
  });
  return {
    assertCanViewPost: jest.fn(opts?.assert ?? defaultAssert),
    invalidateFeedCache: jest.fn(async () => undefined),
    invalidateFeedForUsers: jest.fn(async () => undefined),
  };
}

describe('CommentsService', () => {
  it('throws NotFound when the visibility gate refuses the viewer', async () => {
    const prisma = { post: {}, comment: {}, $transaction: jest.fn() };
    const posts = makePostsStub({
      assert: async () => {
        throw new NotFoundException('Post not found');
      },
    });
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      makeNotifs() as never,
      posts as never,
      { notify: jest.fn(async () => undefined) } as never,
    );
    await expect(svc.create('u1', 'p1', 'hello')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects nested reply beyond one level', async () => {
    // The reply targets `c-parent`, which is already at depth 3 (parent →
    // grandparent → root). Walking its ancestor chain must terminate at the
    // root: return rows by id so parentDepth reaches 3 and the create is
    // rejected. A non-terminating chain here is what previously hung the loop.
    const rows: Record<string, { id: string; postId: string; parentId: string | null }> = {
      'c-parent': { id: 'c-parent', postId: 'p1', parentId: 'c-grandparent' },
      'c-grandparent': { id: 'c-grandparent', postId: 'p1', parentId: 'c-root' },
      'c-root': { id: 'c-root', postId: 'p1', parentId: null },
    };
    const prisma = {
      comment: {
        findUnique: jest.fn(async (args: { where: { id: string } }) => rows[args.where.id] ?? null),
      },
      $transaction: jest.fn(),
    };
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      makeNotifs() as never,
      makePostsStub() as never,
      { notify: jest.fn(async () => undefined) } as never,
    );
    await expect(svc.create('u1', 'p1', 'hi', 'c-parent')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates comment and increments commentCount in a transaction', async () => {
    const tx = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
    const prisma = {
      post: { update: jest.fn() },
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
      { notify: jest.fn(async () => undefined) } as never,
    );
    const result = await svc.create('u1', 'p1', 'hello');
    expect(result.id).toBe('c1');
    expect(tx).toHaveBeenCalled();
  });

  it('list throws NotFound when the viewer cannot see the post', async () => {
    const prisma = { comment: { findMany: jest.fn() } };
    const posts = makePostsStub({
      assert: async () => {
        throw new NotFoundException('Post not found');
      },
    });
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      makeNotifs() as never,
      posts as never,
      { notify: jest.fn(async () => undefined) } as never,
    );
    await expect(svc.list('viewer', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    // Must not reach the DB if the gate refused.
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });

  it('toggleLike is visibility-gated: refuses a comment on a post the viewer cannot see', async () => {
    // IDOR guard for B3 — liking a comment must inherit the parent post's
    // visibility. If assertCanViewPost refuses, no like row may be written.
    const prisma = {
      comment: {
        findUnique: jest.fn(async () => ({
          id: 'c1',
          postId: 'p1',
          authorId: 'u2',
          deletedAt: null,
        })),
      },
      commentLike: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
      $transaction: jest.fn(),
    };
    const posts = makePostsStub({
      assert: async () => {
        throw new NotFoundException('Post not found');
      },
    });
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      makeNotifs() as never,
      posts as never,
      { notify: jest.fn(async () => undefined) } as never,
    );
    await expect(svc.toggleLike('viewer', 'c1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.commentLike.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('toggleLike never self-notifies when liker is the comment author', async () => {
    const notifs = makeNotifs();
    const prisma = {
      comment: {
        findUnique: jest.fn(async () => ({
          id: 'c1',
          postId: 'p1',
          authorId: 'u1', // same as liker
          deletedAt: null,
        })),
        update: jest.fn(async () => ({ likeCount: 1 })),
      },
      commentLike: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(),
        delete: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(async () => [undefined, { likeCount: 1 }]),
    };
    const svc = new CommentsService(
      prisma as never,
      makeBlocks() as never,
      notifs as never,
      makePostsStub() as never,
      { notify: jest.fn(async () => undefined) } as never,
    );
    const res = await svc.toggleLike('u1', 'c1');
    expect(res).toEqual({ liked: true, count: 1 });
    expect(notifs.create).not.toHaveBeenCalled();
  });
});
