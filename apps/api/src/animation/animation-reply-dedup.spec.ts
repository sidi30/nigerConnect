import { AnimationChatService } from './animation-chat.service';

/**
 * Un compte d'animation ne doit répondre qu'UNE fois à quelqu'un qui vient
 * d'écrire trois messages d'affilée.
 *
 * L'unicité en base porte sur `incomingMessageId` : trois messages font trois
 * identifiants, donc trois lignes, donc trois réponses envoyées coup sur coup.
 * Rien ne trahit plus vite un compte fabriqué. Le défaut a été signalé par
 * l'atelier lui-même, qui contournait en ne rédigeant qu'une réponse par
 * conversation — laissant les sœurs `pending` pour toujours.
 *
 * Deux gardes, testées séparément parce qu'elles couvrent deux moments :
 * la mise en file (ne pas créer le doublon) et l'envoi (absorber ceux qui
 * existent déjà, y compris ceux d'avant ce correctif).
 */

type Reply = {
  id: string;
  botId: string;
  conversationId: string;
  incomingMessageId: string;
  status: string;
  attempt: number;
  dueAt: Date;
  draft: string | null;
  sentMessageId: string | null;
  updatedAt: Date;
};

/** Prisma en mémoire, limité aux requêtes que le service utilise vraiment. */
function makePrisma(replies: Reply[] = []) {
  const store = [...replies];
  let seq = store.length;

  const matches = (r: Reply, where: Record<string, unknown>): boolean => {
    for (const [field, cond] of Object.entries(where)) {
      const value = (r as unknown as Record<string, unknown>)[field];
      if (cond !== null && typeof cond === 'object') {
        const c = cond as { not?: unknown; lte?: Date; gte?: Date };
        if ('not' in c) {
          if (c.not === null ? value === null : value === c.not) return false;
        }
        if (c.lte !== undefined && !((value as Date) <= c.lte)) return false;
        if (c.gte !== undefined && !((value as Date) >= c.gte)) return false;
      } else if (value !== cond) {
        return false;
      }
    }
    return true;
  };

  return {
    store,
    animationBot: {
      findMany: jest.fn(async () => [{ id: 'b1', userId: 'bot-user' }]),
    },
    conversation: { findMany: jest.fn(async () => []) },
    animationReply: {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        store.filter((r) => matches(r, where)).length,
      ),
      create: jest.fn(async ({ data }: { data: Partial<Reply> }) => {
        seq += 1;
        const row: Reply = {
          id: `r${seq}`,
          botId: data.botId!,
          conversationId: data.conversationId!,
          incomingMessageId: data.incomingMessageId!,
          status: data.status ?? 'pending',
          attempt: data.attempt ?? 0,
          dueAt: data.dueAt!,
          draft: null,
          sentMessageId: null,
          updatedAt: new Date('2026-08-22T12:00:00Z'),
        };
        store.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        store
          .filter((r) => matches(r, where))
          .map((r) => ({ ...r, bot: { userId: 'bot-user', active: true } })),
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Reply> }) => {
        const row = store.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Partial<Reply> }) => {
          const hit = store.filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        },
      ),
    },
  };
}

function makeChat() {
  let n = 0;
  return {
    sendMessage: jest.fn(async () => {
      n += 1;
      return { message: { id: `m${n}` } };
    }),
  };
}

function build(prisma: unknown, chat: unknown) {
  return new AnimationChatService(prisma as never, chat as never);
}

/**
 * Une conversation telle que le balayage la lit : ses membres et son DERNIER
 * message. `senderId` decide de tout — si c'est le compte, il n'attend rien.
 */
function conv(id: string, lastMessageId: string, content = 'salut', senderId = 'humain') {
  return {
    id,
    members: [{ userId: 'bot-user' }, { userId: 'humain' }],
    messages: [
      { id: lastMessageId, senderId, content, createdAt: new Date('2026-08-22T10:00:00Z') },
    ],
  };
}

function pending(id: string, conversationId: string, draft: string | null, dueAt: string): Reply {
  return {
    id,
    botId: 'b1',
    conversationId,
    incomingMessageId: `in-${id}`,
    status: 'pending',
    attempt: 0,
    dueAt: new Date(dueAt),
    draft,
    sentMessageId: null,
    updatedAt: new Date(dueAt),
  };
}

const NOW = new Date('2026-08-22T12:00:00Z');

describe("mise en file : une seule reponse en attente par conversation", () => {
  it('trois messages d’affilee ne font qu’une reponse', async () => {
    const prisma = makePrisma();
    // Le membre a ecrit trois fois de suite : le balayage ne retient que le
    // dernier message, donc une seule reponse est due.
    prisma.conversation.findMany = jest.fn(async () => [
      conv('conv-1', 'm3', 'bon, a plus'),
    ]) as never;

    const queued = await build(prisma, makeChat()).scanIncoming(NOW);

    expect(queued).toBe(1);
    expect(prisma.store.filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('deux conversations distinctes gardent chacune la leur', async () => {
    const prisma = makePrisma();
    prisma.conversation.findMany = jest.fn(async () => [
      conv('conv-1', 'm1'),
      conv('conv-2', 'm2'),
    ]) as never;

    expect(await build(prisma, makeChat()).scanIncoming(NOW)).toBe(2);
  });

  it('ne repond pas quand le compte a deja le dernier mot', async () => {
    const prisma = makePrisma();
    prisma.conversation.findMany = jest.fn(async () => [
      conv('conv-1', 'm1', 'a bientot !', 'bot-user'),
    ]) as never;

    expect(await build(prisma, makeChat()).scanIncoming(NOW)).toBe(0);
    expect(prisma.store).toHaveLength(0);
  });

  it('une conversation deja repondue peut en accueillir une nouvelle', async () => {
    const prisma = makePrisma([
      { ...pending('r0', 'conv-1', 'deja envoye', '2026-08-22T09:00:00Z'), status: 'sent' },
    ]);
    prisma.conversation.findMany = jest.fn(async () => [conv('conv-1', 'm9')]) as never;

    expect(await build(prisma, makeChat()).scanIncoming(NOW)).toBe(1);
    // L'echange suivant attend plus longtemps que le premier.
    expect(prisma.store.find((r) => r.status === 'pending')!.attempt).toBe(1);
  });

  it("repart de zero quand l'echange precedent date de plus de douze heures", async () => {
    // Meme situation que ci-dessus, mais la reponse remonte a l'avant-veille :
    // le membre qui revient ne doit pas payer sa conversation d'il y a deux
    // jours par une attente plafonnee.
    const prisma = makePrisma([
      { ...pending('r0', 'conv-1', 'deja envoye', '2026-08-20T09:00:00Z'), status: 'sent' },
    ]);
    prisma.conversation.findMany = jest.fn(async () => [conv('conv-1', 'm9')]) as never;

    expect(await build(prisma, makeChat()).scanIncoming(NOW)).toBe(1);
    expect(prisma.store.find((r) => r.status === 'pending')!.attempt).toBe(0);
  });

  it('ne rearme jamais une conversation remontee au proprietaire', async () => {
    const prisma = makePrisma([
      { ...pending('r0', 'conv-1', null, '2026-08-22T09:00:00Z'), status: 'escalated' },
    ]);
    prisma.conversation.findMany = jest.fn(async () => [conv('conv-1', 'm9')]) as never;

    expect(await build(prisma, makeChat()).scanIncoming(NOW)).toBe(0);
  });
});

describe("envoi : les réponses en double sont absorbées", () => {
  it('deux réponses prêtes dans la même conversation → un seul message', async () => {
    const prisma = makePrisma([
      pending('r1', 'conv-1', 'première', '2026-08-22T11:00:00Z'),
      pending('r2', 'conv-1', 'seconde', '2026-08-22T11:30:00Z'),
    ]);
    const chat = makeChat();

    const sent = await build(prisma, chat).sendDue(NOW);

    expect(sent).toBe(1);
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    expect(prisma.store.find((r) => r.id === 'r1')!.status).toBe('sent');
    expect(prisma.store.find((r) => r.id === 'r2')!.status).toBe('skipped');
  });

  it("absorbe aussi les sœurs dont l'heure n'est pas encore venue", async () => {
    const prisma = makePrisma([
      pending('r1', 'conv-1', 'première', '2026-08-22T11:00:00Z'),
      // Pas encore due : elle n'apparaît pas dans la passe, mais elle promet
      // quand même un deuxième message pour plus tard.
      pending('r2', 'conv-1', 'plus tard', '2026-08-22T18:00:00Z'),
    ]);

    await build(prisma, makeChat()).sendDue(NOW);

    expect(prisma.store.find((r) => r.id === 'r2')!.status).toBe('skipped');
  });

  it("absorbe la sœur sans brouillon, qui traînerait sinon indéfiniment", async () => {
    const prisma = makePrisma([
      pending('r1', 'conv-1', 'la vraie réponse', '2026-08-22T11:00:00Z'),
      pending('r2', 'conv-1', null, '2026-08-22T11:10:00Z'),
    ]);

    await build(prisma, makeChat()).sendDue(NOW);

    expect(prisma.store.find((r) => r.id === 'r2')!.status).toBe('skipped');
  });

  it('ne touche pas aux réponses des autres conversations', async () => {
    const prisma = makePrisma([
      pending('r1', 'conv-1', 'pour la une', '2026-08-22T11:00:00Z'),
      pending('r2', 'conv-2', 'pour la deux', '2026-08-22T11:05:00Z'),
    ]);
    const chat = makeChat();

    const sent = await build(prisma, chat).sendDue(NOW);

    expect(sent).toBe(2);
    expect(chat.sendMessage).toHaveBeenCalledTimes(2);
    expect(prisma.store.every((r) => r.status === 'sent')).toBe(true);
  });
});
