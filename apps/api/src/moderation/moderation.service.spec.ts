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
      user: { update: jest.fn(async () => ({})) },
      post: { update: jest.fn() },
    };
    const svc = new ModerationService(prisma as never);
    await svc.resolve('admin', 'r1', { action: 'banned' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'banned' },
    });
  });
});
