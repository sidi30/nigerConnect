import { NotificationService } from './notification.service';

const makePush = () => ({ sendToUser: jest.fn(async () => undefined) });

/** Le membre a laissé toutes ses préférences push à leur valeur d'origine. */
const allPrefsOn = { findUnique: jest.fn(async () => ({})) };

/** Laisse la chaîne `void ...then(...)` du push se dérouler avant l'assertion. */
const flush = () => new Promise((r) => setImmediate(r));

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
      user: allPrefsOn,
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

  describe('préférences push par catégorie', () => {
    const setup = (prefs: Record<string, boolean>) => {
      const push = makePush();
      const prisma = {
        notification: { create: jest.fn(async () => ({ id: 'n1' })) },
        user: { findUnique: jest.fn(async () => prefs) },
      };
      return { push, prisma, svc: new NotificationService(prisma as never, push as never) };
    };

    it('pousse quand la catégorie est active', async () => {
      const { push, svc } = setup({ notifyReactions: true });
      await svc.create({ userId: 'u1', type: 'like', title: 'X aime', actorId: 'u2' });
      await flush();
      expect(push.sendToUser).toHaveBeenCalled();
    });

    it('ne pousse pas quand le membre a coupé la catégorie', async () => {
      const { push, prisma, svc } = setup({ notifyReactions: false });
      const result = await svc.create({
        userId: 'u1',
        type: 'like',
        title: 'X aime',
        actorId: 'u2',
      });
      await flush();
      expect(push.sendToUser).not.toHaveBeenCalled();
      // L'historique in-app, lui, reste écrit : couper une catégorie ne doit
      // pas faire disparaître l'événement de la liste.
      expect(prisma.notification.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 'n1' });
    });

    it('pousse toujours les notifications de service, non réglables', async () => {
      // `identity_approved` n'est dans aucune catégorie : aucune préférence ne
      // doit pouvoir l'éteindre, et on ne va même pas lire la table.
      const { push, prisma, svc } = setup({});
      await svc.create({ userId: 'u1', type: 'identity_approved', title: 'Vérifié' });
      await flush();
      expect(push.sendToUser).toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('pousse si la préférence est illisible (compte supprimé en pleine course)', async () => {
      const push = makePush();
      const prisma = {
        notification: { create: jest.fn(async () => ({ id: 'n1' })) },
        user: { findUnique: jest.fn(async () => null) },
      };
      const svc = new NotificationService(prisma as never, push as never);
      await svc.create({ userId: 'u1', type: 'message', title: 'Nouveau message' });
      await flush();
      expect(push.sendToUser).toHaveBeenCalled();
    });
  });

  it('upserts a push token', async () => {
    const tx = {
      pushToken: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        upsert: jest.fn(async () => ({ id: 'p1' })),
      },
    };
    const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const svc = new NotificationService(prisma as never, makePush() as never);
    await svc.registerPushToken('u1', 'token', 'ios');
    expect(tx.pushToken.upsert).toHaveBeenCalled();
  });

  it('réclame l’appareil aux autres comptes avant de l’attacher', async () => {
    // Bob se connecte sur le téléphone d'Alice : la ligne d'Alice doit partir,
    // sinon les messages privés d'Alice continuent d'arriver chez Bob.
    const tx = {
      pushToken: {
        deleteMany: jest.fn(async () => ({ count: 1 })),
        upsert: jest.fn(async () => ({ id: 'p1' })),
      },
    };
    const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const svc = new NotificationService(prisma as never, makePush() as never);
    await svc.registerPushToken('bob', 'ExponentPushToken[T]', 'android');

    expect(tx.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[T]', userId: { not: 'bob' } },
    });
    // Revendication et attache dans la MÊME transaction : sinon un envoi qui
    // tombe entre les deux touche encore l'ancien compte.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.pushToken.upsert).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[T]' },
      create: { userId: 'bob', token: 'ExponentPushToken[T]', platform: 'android' },
      update: { platform: 'android' },
    });
  });
});
