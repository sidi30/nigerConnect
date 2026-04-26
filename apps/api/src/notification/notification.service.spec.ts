import { NotificationService } from './notification.service';

const makePush = () => ({ sendToUser: jest.fn(async () => undefined) });

describe('NotificationService', () => {
  it('does not self-notify (actorId === userId)', async () => {
    const prisma = {
      notification: { create: jest.fn() },
    };
    const svc = new NotificationService(prisma as never, makePush() as never);
    const result = await svc.create({
      userId: 'u1',
      type: 'like',
      title: 'Someone liked',
      actorId: 'u1',
    });
    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('creates notification when actor is someone else', async () => {
    const prisma = {
      notification: { create: jest.fn(async () => ({ id: 'n1' })) },
    };
    const svc = new NotificationService(prisma as never, makePush() as never);
    const result = await svc.create({
      userId: 'u1',
      type: 'like',
      title: 'X liked',
      actorId: 'u2',
    });
    expect(result).toEqual({ id: 'n1' });
  });

  it('upserts a push token', async () => {
    const prisma = {
      pushToken: { upsert: jest.fn(async () => ({ id: 'p1' })) },
    };
    const svc = new NotificationService(prisma as never, makePush() as never);
    await svc.registerPushToken('u1', 'token', 'ios');
    expect(prisma.pushToken.upsert).toHaveBeenCalled();
  });
});
