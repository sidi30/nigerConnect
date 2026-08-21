import { selectOfficerInviteBanner, visibleOfficers } from '@/constants/lookups';

/**
 * Bureau exécutif (app/associations/[id].tsx) : logique pure extraite pour
 * être prouvée sans monter tout l'écran (imports lourds : expo-image,
 * expo-linear-gradient, react-query infinite, PostCard…).
 */

interface Seat {
  id: string;
  sortOrder: number;
  acceptedAt: string | null;
}

function seat(id: string, sortOrder: number, acceptedAt: string | null = '2026-01-01T00:00:00.000Z'): Seat {
  return { id, sortOrder, acceptedAt };
}

describe('visibleOfficers — seuls les sièges acceptés, dans l’ordre sortOrder', () => {
  it('respecte sortOrder même si l’API renvoie un ordre différent', () => {
    const officers = [seat('c', 2), seat('a', 0), seat('b', 1)];
    expect(visibleOfficers(officers).map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('exclut tout siège sans acceptedAt (proposé mais pas encore accepté)', () => {
    const officers = [seat('accepted', 0), seat('pending', 1, null)];
    expect(visibleOfficers(officers).map((o) => o.id)).toEqual(['accepted']);
  });

  it('liste vide si aucun siège n’est accepté', () => {
    expect(visibleOfficers([seat('a', 0, null), seat('b', 1, null)])).toEqual([]);
  });

  it('ne modifie pas le tableau reçu (pas de tri en place)', () => {
    const officers = [seat('b', 1), seat('a', 0)];
    const copy = [...officers];
    visibleOfficers(officers);
    expect(officers).toEqual(copy);
  });
});

describe('selectOfficerInviteBanner — le bandeau accepter/refuser', () => {
  const NOTIF = (associationId: string) => ({
    type: 'association_officer_invite',
    data: { associationId },
  });

  it('affiche le bandeau : invitation en attente pour CETTE association, pas encore membre du bureau', () => {
    expect(
      selectOfficerInviteBanner({
        notifications: [NOTIF('assoc-1')],
        associationId: 'assoc-1',
        alreadyOfficer: false,
        actionTaken: false,
      }),
    ).toBe(true);
  });

  it('pas de bandeau si déjà membre du bureau (l’invitation a déjà été acceptée)', () => {
    expect(
      selectOfficerInviteBanner({
        notifications: [NOTIF('assoc-1')],
        associationId: 'assoc-1',
        alreadyOfficer: true,
        actionTaken: false,
      }),
    ).toBe(false);
  });

  it('pas de bandeau une fois qu’une action a été prise cette session', () => {
    expect(
      selectOfficerInviteBanner({
        notifications: [NOTIF('assoc-1')],
        associationId: 'assoc-1',
        alreadyOfficer: false,
        actionTaken: true,
      }),
    ).toBe(false);
  });

  it('pas de bandeau si l’invitation concerne une AUTRE association', () => {
    expect(
      selectOfficerInviteBanner({
        notifications: [NOTIF('assoc-2')],
        associationId: 'assoc-1',
        alreadyOfficer: false,
        actionTaken: false,
      }),
    ).toBe(false);
  });

  it('pas de bandeau si le type de notification ne correspond pas', () => {
    expect(
      selectOfficerInviteBanner({
        notifications: [{ type: 'friend_request', data: { associationId: 'assoc-1' } }],
        associationId: 'assoc-1',
        alreadyOfficer: false,
        actionTaken: false,
      }),
    ).toBe(false);
  });

  it('pas de bandeau sans aucune notification', () => {
    expect(
      selectOfficerInviteBanner({
        notifications: [],
        associationId: 'assoc-1',
        alreadyOfficer: false,
        actionTaken: false,
      }),
    ).toBe(false);
  });

  it('pas de bandeau tant que l’id d’association n’est pas résolu (écran en chargement)', () => {
    expect(
      selectOfficerInviteBanner({
        notifications: [NOTIF('assoc-1')],
        associationId: undefined,
        alreadyOfficer: false,
        actionTaken: false,
      }),
    ).toBe(false);
  });
});
