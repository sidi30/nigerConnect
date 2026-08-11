/**
 * AdminService.listReferrals — recherche par email (parrain OU filleul).
 *
 * `q` doit filtrer les lignes de parrainage via un where paramétré Prisma
 * (jamais de raw SQL avec input client) matchant l'email du filleul (la ligne
 * = le User) OU du parrain (relation invitedBy), en `contains` insensible à la
 * casse — TOUT en conservant le prédicat de base `invitedById != null` et la
 * pagination cursor+limit. L'email ne doit jamais être renvoyé (parité vue).
 */

import { AdminService } from './admin.service';

function makeService(): {
  admin: AdminService;
  findMany: jest.Mock;
} {
  const findMany = jest.fn(async () => []);
  const prisma = { user: { findMany } };
  const admin = new AdminService(
    prisma as never,
    {} as never, // s3
    {} as never, // settings
    {} as never, // profile
    {} as never, // audit
    {} as never, // notifications
    {} as never, // mailer
    { get: jest.fn(() => 'private-bucket') } as never, // config
  );
  return { admin, findMany };
}

describe('AdminService — listReferrals (recherche email)', () => {
  it('SANS q : ne pose que le prédicat de base, pas de OR email', async () => {
    const { admin, findMany } = makeService();

    await admin.listReferrals(30);

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ invitedById: { not: null } });
    expect(arg.where.OR).toBeUndefined();
    // Pagination : take = limit + 1 pour détecter hasMore.
    expect(arg.take).toBe(31);
  });

  it('AVEC q : filtre email filleul OU parrain (contains, insensitive) + garde le prédicat de base', async () => {
    const { admin, findMany } = makeService();

    await admin.listReferrals(30, undefined, 'AMINA@Example');

    const where = findMany.mock.calls[0][0].where;
    expect(where.invitedById).toEqual({ not: null });
    expect(where.OR).toEqual([
      { email: { contains: 'AMINA@Example', mode: 'insensitive' } },
      { invitedBy: { email: { contains: 'AMINA@Example', mode: 'insensitive' } } },
    ]);
  });

  it('AVEC q + cursor : conserve la pagination cursor+limit', async () => {
    const { admin, findMany } = makeService();

    await admin.listReferrals(10, '11111111-1111-1111-1111-111111111111', 'diallo');

    const arg = findMany.mock.calls[0][0];
    expect(arg.take).toBe(11);
    expect(arg.cursor).toEqual({ id: '11111111-1111-1111-1111-111111111111' });
    expect(arg.skip).toBe(1);
    expect(arg.where.OR).toHaveLength(2);
  });

  it("ne renvoie jamais l'email (le select n'expose que displayName/avatar)", async () => {
    const { admin, findMany } = makeService();
    findMany.mockResolvedValueOnce([
      {
        id: 'u-1',
        displayName: 'Amina',
        avatarUrl: null,
        createdAt: new Date(),
        invitedBy: { id: 'p-1', displayName: 'Parrain' },
        invitedVia: { kind: 'reusable' },
        _count: { invitees: 3 },
      },
    ]);

    const res = await admin.listReferrals(30, undefined, 'amina');

    // Le select passé à Prisma ne demande pas email (ni pour le user, ni invitedBy).
    const select = findMany.mock.calls[0][0].select;
    expect(select.email).toBeUndefined();
    expect(select.invitedBy.select.email).toBeUndefined();
    // Et l'objet renvoyé n'a pas de champ email.
    const row = res.items[0]!;
    expect(row).not.toHaveProperty('email');
    expect(row.invitedBy).not.toHaveProperty('email');
  });
});
