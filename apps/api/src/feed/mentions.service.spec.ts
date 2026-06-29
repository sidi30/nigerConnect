import { MentionsService, extractMentionIds } from './mentions.service';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

describe('extractMentionIds', () => {
  it('pulls uuids from @[Name](uuid) tokens, deduped + lowercased', () => {
    const content = `Salut @[Aïcha Maïga](${A}) et @[Ous S.](${B.toUpperCase()}) et encore @[Aïcha](${A})`;
    expect(extractMentionIds(content).sort()).toEqual([A, B].sort());
  });
  it('returns [] for plain text / null', () => {
    expect(extractMentionIds('coucou tout le monde')).toEqual([]);
    expect(extractMentionIds(null)).toEqual([]);
    expect(extractMentionIds('email a@b.com pas une mention')).toEqual([]);
  });
});

describe('MentionsService.notify', () => {
  it('notifies ONLY mentioned ids that are accepted friends, never self', async () => {
    const create = jest.fn(async () => ({}));
    // A mentions B and C. Only B is an accepted friend → only B is notified.
    const prisma = {
      friendship: {
        findMany: jest.fn(async () => [{ requesterId: A, addresseeId: B }]),
      },
    };
    const svc = new MentionsService(prisma as never, { create } as never);
    await svc.notify({
      authorId: A,
      authorName: 'Amadou',
      content: `Hey @[B](${B}) @[C](${C}) @[Me](${A})`,
      preview: 'vous a mentionné',
      data: { postId: 'p1' },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: B, actorId: A, type: 'mention' }),
    );
    // The candidate ids queried excluded the self-mention (A) — only B, C.
    const calls = prisma.friendship.findMany.mock.calls as unknown as Array<
      [{ where: { OR: Array<{ addresseeId?: { in: string[] }; requesterId?: { in: string[] } }> } }]
    >;
    const queried = calls[0]![0].where.OR[0]!.addresseeId!.in;
    expect(queried.sort()).toEqual([B, C].sort());
    expect(queried).not.toContain(A);
  });

  it('does nothing when there are no mentions', async () => {
    const create = jest.fn();
    const prisma = { friendship: { findMany: jest.fn() } };
    const svc = new MentionsService(prisma as never, { create } as never);
    await svc.notify({ authorId: A, authorName: 'x', content: 'plain', preview: 'p', data: {} });
    expect(prisma.friendship.findMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
