import { PushService } from './push.service';

/**
 * Le tri des tickets Expo décide si un token survit. Un mauvais tri a déjà
 * coûté toute la flotte : `InvalidCredentials` (clé APNs / FCM absente côté
 * projet Expo) était compté comme « appareil disparu », donc chaque tentative
 * d'envoi supprimait le token de tout le monde.
 */
describe('PushService — tri des tickets Expo', () => {
  const makeSvc = (tickets: unknown[]) => {
    const deleteMany = jest.fn(async () => ({ count: 0 }));
    const prisma = {
      pushToken: {
        findMany: jest.fn(async () => [{ id: 't1', token: 'ExponentPushToken[aaa]' }]),
        deleteMany,
      },
    };
    const config = { get: jest.fn(() => undefined) };
    const svc = new PushService(config as never, prisma as never);
    // Court-circuite le réseau : on ne teste que la lecture des tickets.
    const expo = (svc as unknown as { expo: Record<string, unknown> }).expo;
    expo.chunkPushNotifications = (m: unknown[]) => [m];
    expo.sendPushNotificationsAsync = async () => tickets;
    return { svc, deleteMany };
  };

  it('supprime le token quand l’appareil a vraiment disparu', async () => {
    const { svc, deleteMany } = makeSvc([
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ]);
    await svc.sendToUser('u1', 'Titre', 'Corps');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['t1'] } } });
  });

  it('garde le token quand ce sont NOS credentials qui manquent', async () => {
    const { svc, deleteMany } = makeSvc([
      {
        status: 'error',
        message: 'Could not find APNs credentials for com.nigerconnect.app',
        details: { error: 'InvalidCredentials' },
      },
    ]);
    await svc.sendToUser('u1', 'Titre', 'Corps');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('garde le token sur une erreur inconnue', async () => {
    const { svc, deleteMany } = makeSvc([
      { status: 'error', details: { error: 'MessageTooBig' } },
    ]);
    await svc.sendToUser('u1', 'Titre', 'Corps');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('ne touche à rien quand tout part bien', async () => {
    const { svc, deleteMany } = makeSvc([{ status: 'ok', id: 'r1' }]);
    await svc.sendToUser('u1', 'Titre', 'Corps');
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
