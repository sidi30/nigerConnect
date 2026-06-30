import { GeoService } from './geo.service';

/**
 * PX4 — connect/accept/decline flow for the double-blind proximity encounter.
 * Pins the security-critical invariants: non-participants get 404 (not 403),
 * the requester reveals only themselves, accept creates a friendship, the
 * version lock resolves a near-simultaneous mutual tap as an accept, and the
 * daily request cap returns 429.
 */
function makeMocks() {
  const redis = {
    client: {
      incr: jest.fn<Promise<number>, [string]>(async () => 1),
      expire: jest.fn(async () => 1),
    },
  };
  const prisma = {
    proximityEncounter: {
      findUnique: jest.fn(async () => null as unknown),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => [] as unknown[]),
    },
    friendship: {
      findFirst: jest.fn(async () => null as unknown),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    user: { findUnique: jest.fn(async () => ({ displayName: 'Aïcha', firstName: null })) },
  };
  const notifications = { create: jest.fn(async () => ({ id: 'n1' })) };
  const settings = { isProximityEnabled: jest.fn(async () => true) };
  const svc = new GeoService(
    prisma as never,
    redis as never,
    notifications as never,
    settings as never,
    {} as never,
  );
  return { svc, prisma, redis, notifications, settings };
}

const ENC = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
// A < B lexically.
const A = 'user-a';
const B = 'user-b';

describe('GeoService — proximity encounters (PX4)', () => {
  it('connect on an active encounter requests it and reveals the requester to the peer', async () => {
    const { svc, prisma, notifications } = makeMocks();
    prisma.proximityEncounter.findUnique.mockResolvedValueOnce({
      id: ENC,
      userAId: A,
      userBId: B,
      status: 'active',
      requesterId: null,
      version: 0,
    });

    const res = await svc.connectEncounter(A, ENC);

    expect(res).toEqual({ status: 'requested' });
    const upd = (prisma.proximityEncounter.updateMany as jest.Mock).mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: ENC, status: 'active', version: 0 });
    expect(upd.data).toMatchObject({ status: 'requested', requesterId: A });
    // Peer B is notified; requester A is revealed (actorId + requesterId).
    const n = (notifications.create as jest.Mock).mock.calls[0][0];
    expect(n).toMatchObject({ userId: B, actorId: A, data: { encounterId: ENC, requesterId: A } });
  });

  it('treats a near-simultaneous mutual connect as an accept (collision)', async () => {
    const { svc, prisma } = makeMocks();
    // B already requested; A now connects.
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC,
      userAId: A,
      userBId: B,
      status: 'requested',
      requesterId: B,
      version: 1,
    });

    const res = await svc.connectEncounter(A, ENC);

    expect(res).toEqual({ status: 'accepted' });
    // Friendship materialised between requester (B) and accepter (A).
    expect(prisma.friendship.create).toHaveBeenCalled();
  });

  it('returns 404 (not 403) for a non-participant', async () => {
    const { svc, prisma } = makeMocks();
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC,
      userAId: A,
      userBId: B,
      status: 'active',
      requesterId: null,
      version: 0,
    });

    await expect(svc.connectEncounter('intruder', ENC)).rejects.toMatchObject({ status: 404 });
    await expect(svc.acceptEncounter('intruder', ENC)).rejects.toMatchObject({ status: 404 });
    await expect(svc.declineEncounter('intruder', ENC)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to let the requester accept their own request', async () => {
    const { svc, prisma } = makeMocks();
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC,
      userAId: A,
      userBId: B,
      status: 'requested',
      requesterId: A,
      version: 1,
    });

    await expect(svc.acceptEncounter(A, ENC)).rejects.toMatchObject({ status: 400 });
  });

  it('accept transitions to accepted and ensures a friendship', async () => {
    const { svc, prisma, notifications } = makeMocks();
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC,
      userAId: A,
      userBId: B,
      status: 'requested',
      requesterId: B, // B requested, A accepts
      version: 1,
    });

    const res = await svc.acceptEncounter(A, ENC);

    expect(res).toEqual({ status: 'accepted' });
    expect(prisma.friendship.create).toHaveBeenCalledWith({
      data: { requesterId: B, addresseeId: A, status: 'accepted' },
    });
    // Requester B is told it was accepted, with A revealed.
    expect((notifications.create as jest.Mock).mock.calls[0][0]).toMatchObject({
      userId: B,
      type: 'friend_accepted',
      data: { encounterId: ENC, actorId: A },
    });
  });

  it('decline sets the encounter to declined', async () => {
    const { svc, prisma } = makeMocks();
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC,
      userAId: A,
      userBId: B,
      status: 'requested',
      requesterId: B,
      version: 1,
    });

    const res = await svc.declineEncounter(A, ENC);

    expect(res).toEqual({ status: 'declined' });
    expect((prisma.proximityEncounter.updateMany as jest.Mock).mock.calls[0][0].data.status).toBe(
      'declined',
    );
  });

  describe('listEncounters — double-blind anonymity', () => {
    it('reveals ONLY the requester to the target of an incoming request, and never the peer otherwise', async () => {
      const { svc, prisma } = makeMocks();
      const requesterProfile = { id: B, displayName: 'Requester', avatarUrl: null };
      (prisma.proximityEncounter.findMany as jest.Mock).mockResolvedValueOnce([
        // active crossing — both anonymous
        { id: 'e-active', userAId: A, userBId: B, status: 'active', requesterId: null, distanceBucket: 100, createdAt: new Date(), requester: null },
        // I (A) requested someone — peer stays hidden to me
        { id: 'e-out', userAId: A, userBId: B, status: 'requested', requesterId: A, distanceBucket: 100, createdAt: new Date(), requester: { id: A } },
        // someone (B) requested ME (A) — requester B revealed so I can decide
        { id: 'e-in', userAId: A, userBId: B, status: 'requested', requesterId: B, distanceBucket: 500, createdAt: new Date(), requester: requesterProfile },
      ]);

      const list = (await svc.listEncounters(A)) as Array<Record<string, unknown>>;

      const active = list.find((e) => e.encounterId === 'e-active')!;
      const outgoing = list.find((e) => e.encounterId === 'e-out')!;
      const incoming = list.find((e) => e.encounterId === 'e-in')!;

      // Active + my outgoing request: NO peer identity exposed.
      expect(active.requester).toBeUndefined();
      expect(JSON.stringify(active)).not.toContain(B);
      expect(outgoing.requester).toBeUndefined();
      expect(outgoing.outgoing).toBe(true);

      // Incoming request: the requester (and only the requester) is revealed.
      expect(incoming.requester).toEqual(requesterProfile);
      expect(incoming.outgoing).toBe(false);
    });
  });

  it('freezes connect/accept when the kill-switch is OFF (incident freeze)', async () => {
    const { svc, prisma, settings } = makeMocks();
    settings.isProximityEnabled.mockResolvedValue(false);
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC, userAId: A, userBId: B, status: 'active', requesterId: null, version: 0,
    });

    await expect(svc.connectEncounter(A, ENC)).rejects.toMatchObject({ status: 503 });
    // Loaded nothing / acted on nothing.
    expect(prisma.proximityEncounter.updateMany).not.toHaveBeenCalled();
  });

  it('treats an expired open encounter as gone (404)', async () => {
    const { svc, prisma } = makeMocks();
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC, userAId: A, userBId: B, status: 'active', requesterId: null, version: 0,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(svc.connectEncounter(A, ENC)).rejects.toMatchObject({ status: 404 });
  });

  it('caps daily outgoing requests with a 429', async () => {
    const { svc, prisma, redis } = makeMocks();
    prisma.proximityEncounter.findUnique.mockResolvedValue({
      id: ENC,
      userAId: A,
      userBId: B,
      status: 'active',
      requesterId: null,
      version: 0,
    });
    redis.client.incr.mockResolvedValueOnce(11); // over the cap of 10

    await expect(svc.connectEncounter(A, ENC)).rejects.toMatchObject({ status: 429 });
    expect(prisma.proximityEncounter.updateMany).not.toHaveBeenCalled();
  });
});
