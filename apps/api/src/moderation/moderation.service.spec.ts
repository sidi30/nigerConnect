import { NotFoundException } from '@nestjs/common';
import { ModerationService } from './moderation.service';

describe('ModerationService', () => {
  it('throws NotFound on unknown report', async () => {
    const prisma = { report: { findUnique: jest.fn(async () => null) } };
    const svc = new ModerationService(prisma as never);
    await expect(
      svc.resolve('admin', 'r1', { action: 'warning' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft-deletes post content when action is content_removed', async () => {
    const prisma = {
      report: {
        findUnique: jest.fn(async () => ({ id: 'r1', targetType: 'post', targetId: 'p1' })),
        update: jest.fn(async () => ({})),
      },
      post: { update: jest.fn(async () => ({})) },
      user: { update: jest.fn() },
      message: { update: jest.fn() },
      comment: { update: jest.fn() },
    };
    const svc = new ModerationService(prisma as never);
    await svc.resolve('admin', 'r1', { action: 'content_removed' });
    expect(prisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('bans user when target is user', async () => {
    const prisma = {
      report: {
        findUnique: jest.fn(async () => ({ id: 'r1', targetType: 'user', targetId: 'u1' })),
        update: jest.fn(async () => ({})),
      },
      user: {
        findUnique: jest.fn(async () => ({ status: 'active', invitedById: null })),
        update: jest.fn(async () => ({})),
      },
      post: { update: jest.fn() },
    };
    const svc = new ModerationService(prisma as never);
    await svc.resolve('admin', 'r1', { action: 'banned' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'banned' },
    });
    // No inviter → no abuse flag increment (single status update only).
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('flags the inviter abuse counter when a banned user was invited (§11)', async () => {
    const prisma = {
      report: {
        findUnique: jest.fn(async () => ({ id: 'r1', targetType: 'user', targetId: 'u1' })),
        update: jest.fn(async () => ({})),
      },
      user: {
        findUnique: jest.fn(async () => ({ status: 'active', invitedById: 'parrain-1' })),
        update: jest.fn(async () => ({})),
      },
      post: { update: jest.fn() },
    };
    const svc = new ModerationService(prisma as never);
    await svc.resolve('admin', 'r1', { action: 'banned' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'parrain-1' },
      data: { inviteAbuseFlags: { increment: 1 } },
    });
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-flag the inviter when re-banning an already-banned user (idempotent)', async () => {
    const prisma = {
      report: {
        findUnique: jest.fn(async () => ({ id: 'r1', targetType: 'user', targetId: 'u1' })),
        update: jest.fn(async () => ({})),
      },
      user: {
        findUnique: jest.fn(async () => ({ status: 'banned', invitedById: 'parrain-1' })),
        update: jest.fn(async () => ({})),
      },
      post: { update: jest.fn() },
    };
    const svc = new ModerationService(prisma as never);
    await svc.resolve('admin', 'r1', { action: 'banned' });
    // Already banned → only the (idempotent) status update, no flag increment.
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('does NOT flag the inviter on suspend (only ban)', async () => {
    const prisma = {
      report: {
        findUnique: jest.fn(async () => ({ id: 'r1', targetType: 'user', targetId: 'u1' })),
        update: jest.fn(async () => ({})),
      },
      user: {
        findUnique: jest.fn(async () => ({ status: 'active', invitedById: 'parrain-1' })),
        update: jest.fn(async () => ({})),
      },
      post: { update: jest.fn() },
    };
    const svc = new ModerationService(prisma as never);
    await svc.resolve('admin', 'r1', { action: 'suspended' });
    // Status update only — no second update to flag the inviter.
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
