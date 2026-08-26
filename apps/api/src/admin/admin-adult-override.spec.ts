import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * Dérogation de majorité. Elle ouvre à la main une garde qui protège des
 * mineurs : elle doit donc rester bornée, nominative et révocable.
 *
 * La règle qui compte : elle comble une ABSENCE de date, elle n'en contredit
 * jamais une. Sans ça, elle deviendrait le moyen de faire entrer quelqu'un dont
 * on sait qu'il est mineur.
 */
function makeService(user: Record<string, unknown> | null) {
  const update = jest.fn(async () => ({}));
  const log = jest.fn(async () => undefined);
  const prisma = { user: { findUnique: jest.fn(async () => user), update } };
  const admin = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never, // notifications
    {} as never, // mailer
    { get: jest.fn(() => 'private-bucket') } as never,
  );
  // L'audit est injecté par le conteneur ; on le remplace pour l'observer.
  (admin as unknown as { audit: { log: unknown } }).audit = { log };
  return { admin, update, log };
}

function dataOf(mock: jest.Mock): Record<string, unknown> {
  return ((mock.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> }).data;
}

describe('AdminService — dérogation de majorité', () => {
  it('accorde la dérogation à un membre validé sans date, en gardant qui et pourquoi', async () => {
    const { admin, update, log } = makeService({
      identityStatus: 'approved',
      dateOfBirth: null,
      adultOverrideAt: null,
    });

    await admin.grantAdultOverride('admin-1', 'user-1', 'Profil connu personnellement, majeur');

    const data = dataOf(update);
    expect(data.adultOverrideById).toBe('admin-1');
    expect(data.adultOverrideReason).toBe('Profil connu personnellement, majeur');
    expect(data.adultOverrideAt).toBeInstanceOf(Date);
    // Une garde ouverte à la main sans trace nominative ne vaut rien.
    expect(log).toHaveBeenCalledWith('admin-1', 'adult_override_grant', 'user-1');
  });

  it("refuse quand une date existe déjà — il n'y a rien à déroger", async () => {
    const { admin, update } = makeService({
      identityStatus: 'approved',
      dateOfBirth: new Date('2015-01-01'),
      adultOverrideAt: null,
    });

    await expect(
      admin.grantAdultOverride('admin-1', 'user-1', 'Je le connais, il est majeur'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Le cas qui compte : la date dit « mineur ». La dérogation ne doit pas
    // offrir un chemin pour passer outre.
    expect(update).not.toHaveBeenCalled();
  });

  it("refuse un membre qui n'est pas vérifié — on ne déroge qu'à la majorité", async () => {
    const { admin, update } = makeService({
      identityStatus: 'pending',
      dateOfBirth: null,
      adultOverrideAt: null,
    });

    await expect(
      admin.grantAdultOverride('admin-1', 'user-1', 'Profil connu, à valider'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('404 sur un compte inconnu', async () => {
    const { admin, update } = makeService(null);
    await expect(
      admin.grantAdultOverride('admin-1', 'nobody', 'Profil connu personnellement'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('révoque et efface les trois champs, en le traçant', async () => {
    const { admin, update, log } = makeService({ adultOverrideAt: new Date() });

    await admin.revokeAdultOverride('admin-2', 'user-1');

    expect(dataOf(update)).toEqual({
      adultOverrideAt: null,
      adultOverrideById: null,
      adultOverrideReason: null,
    });
    expect(log).toHaveBeenCalledWith('admin-2', 'adult_override_revoke', 'user-1');
  });

  it('refuse de révoquer une dérogation qui n’existe pas', async () => {
    const { admin, update } = makeService({ adultOverrideAt: null });
    await expect(admin.revokeAdultOverride('admin-2', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
