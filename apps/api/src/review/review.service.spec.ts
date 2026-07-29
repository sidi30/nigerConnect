import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReviewService } from './review.service';

function makeNotifications() {
  return { create: jest.fn(async () => ({ id: 'n1' })) };
}

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

describe('ReviewService.upsert — target resolution', () => {
  it('refuses a review from someone on either side of a block', async () => {
    // Rating carries a public score plus a notification to the target. Left
    // open, a blocked member could keep damaging the reputation of the person
    // who blocked them, and ping them each time — the exact contact a block
    // exists to sever.
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 'target' })) },
      review: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    const svc = new ReviewService(
      prisma as never,
      makeNotifications() as never,
      makeBlocks(true) as never,
    );

    await expect(
      svc.upsert('author', { targetType: 'user', targetId: 'target', rating: 1 } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.review.upsert).not.toHaveBeenCalled();
  });

  it('allows a review when no block stands between the two members', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 'target' })) },
      review: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async () => ({ id: 'rev-1' })),
    };
    const blocks = makeBlocks(false);
    const svc = new ReviewService(prisma as never, makeNotifications() as never, blocks as never);

    await svc.upsert('author', { targetType: 'user', targetId: 'target', rating: 5 } as never);

    expect(blocks.isBlocked).toHaveBeenCalledWith('author', 'target');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('refuses a self-review before doing anything else', async () => {
    const prisma = { user: { findUnique: jest.fn() } };
    const blocks = makeBlocks(false);
    const svc = new ReviewService(prisma as never, makeNotifications() as never, blocks as never);

    await expect(
      svc.upsert('me', { targetType: 'user', targetId: 'me', rating: 5 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a review targeting a user who does not exist', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => null) } };
    const svc = new ReviewService(
      prisma as never,
      makeNotifications() as never,
      makeBlocks(false) as never,
    );

    await expect(
      svc.upsert('author', { targetType: 'user', targetId: 'ghost', rating: 3 } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
