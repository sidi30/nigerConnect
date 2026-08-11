import { ForbiddenException } from '@nestjs/common';
import { OfficialService } from './official.service';

// Mocks à la main (même style que newsletter.service.spec) : le service ne
// dépend que de Prisma + de services applicatifs, pas d'un TestingModule Nest.

const OFFICIAL_ID = 'official-1';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findFirst: jest.fn(async (): Promise<{ id: string } | null> => ({ id: OFFICIAL_ID })),
      findUnique: jest.fn(async () => ({ id: 'u1', status: 'active' })),
      findUniqueOrThrow: jest.fn(async () => ({ id: OFFICIAL_ID, displayName: 'NigerConnect' })),
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: OFFICIAL_ID })),
      update: jest.fn(async () => ({ id: OFFICIAL_ID })),
      count: jest.fn(async () => 0),
    },
    post: {
      findUnique: jest.fn(
        async (): Promise<{ authorId: string; isStory: boolean; deletedAt: Date | null } | null> =>
          null,
      ),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    block: {
      findMany: jest.fn(
        async (): Promise<{ blockerId: string; blockedId: string }[]> => [],
      ),
    },
    conversationMember: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    officialBroadcast: {
      create: jest.fn(async () => ({ id: 'bc-1' })),
      update: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
}

function makeSettings(pinned = OFFICIAL_ID) {
  return {
    getSetting: jest.fn(async () => pinned),
    setSetting: jest.fn(async () => undefined),
  };
}

function makeDeps(prisma: ReturnType<typeof makePrisma>, settings = makeSettings()) {
  const notifications = {
    create: jest.fn(async (_payload: Record<string, unknown>) => ({ id: 'n1' })),
  };
  const posts = {
    create: jest.fn(async () => ({ id: 'post-1' })),
    createStory: jest.fn(async () => ({ id: 'story-1' })),
    softDelete: jest.fn(async () => undefined),
    deleteStory: jest.fn(async () => undefined),
  };
  const chat = {
    createConversation: jest.fn(async () => ({ id: 'conv-1' })),
    sendMessage: jest.fn(async () => ({
      message: { id: 'msg-1' },
      memberIds: [OFFICIAL_ID, 'u1'],
    })),
    listMessages: jest.fn(async () => ({ items: [], nextCursor: null })),
    markAsRead: jest.fn(async () => new Date()),
  };
  const gateway = { broadcastNewMessage: jest.fn() };
  const s3 = {
    assertOwnedPublicImage: jest.fn(async (url: string) => url),
    createPresignedUpload: jest.fn(async () => ({
      uploadUrl: 'https://cdn/put',
      publicUrl: 'https://cdn/users/official-1/a.jpg',
      key: 'users/official-1/a.jpg',
      sseRequired: false,
      expiresIn: 600,
    })),
  };
  const diaspora = { invalidate: jest.fn(async () => undefined) };
  const service = new OfficialService(
    prisma as never,
    s3 as never,
    settings as never,
    notifications as never,
    posts as never,
    chat as never,
    gateway as never,
    diaspora as never,
  );
  return { service, notifications, posts, chat, gateway, s3, settings };
}

/** Laisse tourner la diffusion lancée en tâche de fond (`void this.dispatch`). */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe('OfficialService — le compte', () => {
  it('crée le compte officiel au premier appel et épingle son id', async () => {
    const prisma = makePrisma();
    prisma.user.findFirst = jest.fn(async () => null);
    prisma.user.create = jest.fn(async () => ({ id: 'new-official' }));
    const settings = makeSettings('');
    const { service } = makeDeps(prisma, settings);

    const id = await service.ensureAccountId();

    expect(id).toBe('new-official');
    const created = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
    // Ni mot de passe ni fournisseur OAuth : le compte n'est pas connectable.
    expect(created.isOfficial).toBe(true);
    expect(created.passwordHash).toBeUndefined();
    expect(created.showOnMap).toBe(false);
    expect(settings.setSetting).toHaveBeenCalledWith('official_account_id', 'new-official');
  });

  it("réutilise le compte épinglé plutôt que d'en créer un second", async () => {
    const prisma = makePrisma();
    const { service } = makeDeps(prisma);

    await service.ensureAccountId();
    await service.ensureAccountId();

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('OfficialService — diffusion', () => {
  it('notifie chaque destinataire et clôt la ligne de diffusion', async () => {
    const prisma = makePrisma();
    prisma.user.count = jest.fn(async () => 2);
    prisma.user.findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
      .mockResolvedValue([]);
    const { service, notifications } = makeDeps(prisma);

    const broadcast = await service.broadcastNotification(
      { title: 'Mise à jour', body: 'Nouvelle version disponible', linkPath: '/post/x' },
      'admin-1',
    );
    await flush();

    expect(broadcast.id).toBe('bc-1');
    expect(notifications.create).toHaveBeenCalledTimes(2);
    const payload = notifications.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      userId: 'u1',
      actorId: OFFICIAL_ID,
      type: 'announcement',
      title: 'Mise à jour',
    });
    expect(payload.data).toMatchObject({ official: true, path: '/post/x' });
    expect(prisma.officialBroadcast.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'sent', sentCount: 2, failedCount: 0 }),
      }),
    );
  });

  it('exclut le compte officiel, les comptes bloqués et les désinscrits', async () => {
    const prisma = makePrisma();
    prisma.block.findMany = jest.fn(async () => [
      { blockerId: 'u9', blockedId: OFFICIAL_ID },
    ]);
    const { service } = makeDeps(prisma);

    await service.broadcastNotification({ title: 'Titre', body: 'Corps' }, 'admin-1');
    await flush();

    const where = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: 'active',
      isOfficial: false,
      newsletterOptIn: true,
    });
    expect(where.id).toEqual({ not: OFFICIAL_ID, notIn: ['u9'] });
  });

  it('un échec sur un membre ne coupe pas la diffusion', async () => {
    const prisma = makePrisma();
    prisma.user.findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
      .mockResolvedValue([]);
    const { service, notifications } = makeDeps(prisma);
    notifications.create
      .mockRejectedValueOnce(new Error('push down'))
      .mockResolvedValue({ id: 'n' });

    await service.broadcastNotification({ title: 'Titre', body: 'Corps' }, 'admin-1');
    await flush();

    expect(prisma.officialBroadcast.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'sent', sentCount: 1, failedCount: 1 }),
      }),
    );
  });

  it('un message à tous arrive comme un vrai message (conversation + socket)', async () => {
    const prisma = makePrisma();
    prisma.user.findMany = jest.fn().mockResolvedValueOnce([{ id: 'u1' }]).mockResolvedValue([]);
    const { service, chat, gateway } = makeDeps(prisma);

    await service.broadcastMessage({ content: 'Bonjour à tous' }, 'admin-1');
    await flush();

    expect(chat.createConversation).toHaveBeenCalledWith(OFFICIAL_ID, ['u1']);
    expect(chat.sendMessage).toHaveBeenCalledWith(OFFICIAL_ID, 'conv-1', {
      content: 'Bonjour à tous',
      messageType: 'text',
      mediaUrl: undefined,
    });
    expect(gateway.broadcastNewMessage).toHaveBeenCalledWith(
      'conv-1',
      { id: 'msg-1' },
      [OFFICIAL_ID, 'u1'],
    );
  });
});

describe('OfficialService — publier', () => {
  it('publie en visibilité publique et annonce quand on le demande', async () => {
    const prisma = makePrisma();
    prisma.user.findMany = jest.fn(async () => []);
    const { service, posts, notifications } = makeDeps(prisma);

    await service.publishPost(
      { content: 'Une annonce importante', announce: true },
      'admin-1',
    );
    await flush();

    expect(posts.create).toHaveBeenCalledWith(OFFICIAL_ID, {
      content: 'Une annonce importante',
      visibility: 'public',
      media: undefined,
    });
    // L'annonce pointe sur la publication qui vient d'être créée.
    expect(prisma.officialBroadcast.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'notification', linkPath: '/post/post-1' }),
      }),
    );
    expect(notifications.create).not.toHaveBeenCalled(); // aucun destinataire ici
  });

  it("refuse de supprimer une publication qui n'est pas celle du compte officiel", async () => {
    const prisma = makePrisma();
    prisma.post.findUnique = jest.fn(async () => ({
      authorId: 'someone-else',
      isStory: false,
      deletedAt: null,
    }));
    const { service, posts } = makeDeps(prisma);

    await expect(service.deleteContent('post-9')).rejects.toBeInstanceOf(ForbiddenException);
    expect(posts.softDelete).not.toHaveBeenCalled();
  });
});
