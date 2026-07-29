import { DigestService } from './digest.service';

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

type FakeUser = {
  id: string;
  city: string | null;
  countryCode: string | null;
  status: string;
  digestOptIn: boolean;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
  lastDigestSentAt: Date | null;
};

/** Applies the same eligibility predicate the service encodes in its `where`. */
function isEligible(u: FakeUser, now: Date): boolean {
  const cutoff = now.getTime() - SEVEN_DAYS;
  return (
    u.status === 'active' &&
    u.digestOptIn === true &&
    u.countryCode != null &&
    // Dormancy needs BOTH signals cold — see the `where` in processBatch.
    (u.lastSeenAt == null || u.lastSeenAt.getTime() < cutoff) &&
    (u.lastLoginAt == null || u.lastLoginAt.getTime() < cutoff) &&
    (u.lastDigestSentAt == null || u.lastDigestSentAt.getTime() < cutoff)
  );
}

/**
 * Stateful fake Prisma backed by an in-memory user list. `findMany` honours the
 * eligibility predicate and `update` mutates in place, so idempotence/opt-out are
 * exercised functionally (not just by inspecting a `where` object).
 */
function makeStatefulPrisma(
  users: FakeUser[],
  counts: { events: number; annonces: number; newMembers: number },
) {
  const now = () => new Date();
  return {
    __users: users,
    associationEvent: { count: jest.fn(async (_args: { where: Record<string, unknown> }) => counts.events) },
    serviceRequest: { count: jest.fn(async (_args: { where: Record<string, unknown> }) => counts.annonces) },
    user: {
      count: jest.fn(async (_args: { where: Record<string, unknown> }) => counts.newMembers),
      findMany: jest.fn(async (_args: { where: Record<string, unknown> }) =>
        users
          .filter((u) => isEligible(u, now()))
          .map((u) => ({ id: u.id, city: u.city, countryCode: u.countryCode })),
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = users.find((x) => x.id === where.id);
        if (u) Object.assign(u, data);
        return u;
      }),
    },
  };
}

type NotifParams = {
  userId: string;
  type: string;
  title: string;
  body?: string;
  data: Record<string, unknown>;
  actorId?: string;
};
const makeNotification = () => ({ create: jest.fn(async (_params: NotifParams) => ({ id: 'n1' })) });
const makeSettings = (enabled = true) => ({ isDigestEnabled: jest.fn(async () => enabled) });

const dormant = (over: Partial<FakeUser> = {}): FakeUser => ({
  id: 'u',
  city: 'Niamey',
  countryCode: 'NE',
  status: 'active',
  digestOptIn: true,
  lastLoginAt: null,
  lastSeenAt: null,
  lastDigestSentAt: null,
  ...over,
});

describe('DigestService', () => {
  // ── PRIVACY ────────────────────────────────────────────────────────────
  describe('privacy (aggregate-only, no third-party identity)', () => {
    it('counts ONLY public + active new members, excluding the recipient', async () => {
      const prisma = makeStatefulPrisma([], { events: 0, annonces: 0, newMembers: 1 });
      const svc = new DigestService(prisma as never, makeNotification() as never, makeSettings() as never);

      await svc.computeAggregates({ id: 'me', city: 'Niamey', countryCode: 'NE' }, new Date());

      const where = prisma.user.count.mock.calls[0]![0].where;
      // A private / friends account must never be reachable by this query.
      expect(where.privacyLevel).toBe('public');
      expect(where.status).toBe('active');
      expect(where.id).toEqual({ not: 'me' });
      expect(where.countryCode).toBe('NE');
      expect(where.city).toBe('Niamey');
    });

    it('digest payload carries plain numbers only — never a name/id/avatar', async () => {
      const users = [dormant({ id: 'u1' })];
      const prisma = makeStatefulPrisma(users, { events: 3, annonces: 5, newMembers: 1 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      await svc.processBatch(new Date());

      const params = notification.create.mock.calls[0]![0];
      expect(params.type).toBe('weekly_digest');
      // data keys are exactly the safe aggregate set — nothing that can identify a third party.
      expect(Object.keys(params.data).sort()).toEqual(
        ['annoncesCount', 'eventsCount', 'newMembersCount', 'screen'].sort(),
      );
      expect(params.data.eventsCount).toBe(3);
      expect(params.data.annoncesCount).toBe(5);
      expect(params.data.newMembersCount).toBe(1);
      // No actorId → no third-party actor attached to the notification.
      expect(params.actorId).toBeUndefined();
    });
  });

  // ── OPT-OUT ────────────────────────────────────────────────────────────
  describe('opt-out respected', () => {
    it('never selects a digestOptIn=false member, even if dormant & eligible otherwise', async () => {
      const users = [
        dormant({ id: 'in', digestOptIn: true }),
        dormant({ id: 'out', digestOptIn: false }),
      ];
      const prisma = makeStatefulPrisma(users, { events: 1, annonces: 0, newMembers: 0 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      const sent = await svc.processBatch(new Date());

      expect(sent).toBe(1);
      const pushedIds = notification.create.mock.calls.map((c) => c[0].userId);
      expect(pushedIds).toEqual(['in']);
      // The opted-out member is never stamped either.
      const stampedIds = prisma.user.update.mock.calls.map((c) => c[0].where.id);
      expect(stampedIds).not.toContain('out');
    });

    it('static guarantee: the batch query filters on digestOptIn=true', async () => {
      const prisma = makeStatefulPrisma([], { events: 0, annonces: 0, newMembers: 0 });
      const svc = new DigestService(prisma as never, makeNotification() as never, makeSettings() as never);
      await svc.processBatch(new Date());
      const where = prisma.user.findMany.mock.calls[0]![0].where;
      expect(where.digestOptIn).toBe(true);
      expect(where.status).toBe('active');
      expect(where.countryCode).toEqual({ not: null });
    });
  });

  // ── IDEMPOTENCE (at-most-once) ──────────────────────────────────────────
  describe('idempotence', () => {
    it('does not double-send when the batch is re-run in the same window', async () => {
      const users = [dormant({ id: 'u1' })];
      const prisma = makeStatefulPrisma(users, { events: 2, annonces: 0, newMembers: 0 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      await svc.processBatch(new Date());
      // Second run a minute later — the member is now stamped, so ineligible.
      await svc.processBatch(new Date(Date.now() + 60_000));

      expect(notification.create).toHaveBeenCalledTimes(1);
      expect(users[0]!.lastDigestSentAt).not.toBeNull();
    });

    it('stamps lastDigestSentAt BEFORE firing the push (at-most-once, crash-safe)', async () => {
      const users = [dormant({ id: 'u1' })];
      const prisma = makeStatefulPrisma(users, { events: 2, annonces: 0, newMembers: 0 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      await svc.processBatch(new Date());

      const stampOrder = prisma.user.update.mock.invocationCallOrder[0]!;
      const pushOrder = notification.create.mock.invocationCallOrder[0]!;
      expect(stampOrder).toBeLessThan(pushOrder);
    });

    it('0/0/0 digest: stamps the member but sends no hollow push', async () => {
      const users = [dormant({ id: 'u1' })];
      const prisma = makeStatefulPrisma(users, { events: 0, annonces: 0, newMembers: 0 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      const sent = await svc.processBatch(new Date());

      expect(sent).toBe(0);
      expect(notification.create).not.toHaveBeenCalled();
      expect(users[0]!.lastDigestSentAt).not.toBeNull(); // stamped → not re-scanned
    });
  });

  // ── KILL-SWITCH (fail-closed) ───────────────────────────────────────────
  describe('kill-switch', () => {
    it('sends nothing and touches no member when digest_enabled is off', async () => {
      const users = [dormant({ id: 'u1' })];
      const prisma = makeStatefulPrisma(users, { events: 5, annonces: 5, newMembers: 5 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings(false) as never);

      const sent = await svc.processBatch(new Date());

      expect(sent).toBe(0);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(notification.create).not.toHaveBeenCalled();
      expect(users[0]!.lastDigestSentAt).toBeNull();
    });
  });

  // ── ELIGIBILITY (dormant + region) ──────────────────────────────────────
  describe('eligibility', () => {
    it('excludes recently-active members and members with no region', async () => {
      const users = [
        dormant({ id: 'dormant' }),
        dormant({ id: 'active-recent', lastLoginAt: new Date() }),
        dormant({ id: 'no-region', countryCode: null }),
      ];
      const prisma = makeStatefulPrisma(users, { events: 1, annonces: 0, newMembers: 0 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      await svc.processBatch(new Date());

      const pushedIds = notification.create.mock.calls.map((c) => c[0].userId);
      expect(pushedIds).toEqual(['dormant']);
    });

    it('does not nudge a member who uses the app daily on a stale login', async () => {
      // The regression this guards: refresh tokens are long-lived, so a daily
      // user can carry a month-old lastLoginAt. Keying dormancy on the login
      // alone sent them "come back and see your region" while they were reading
      // the feed. lastSeenAt is the signal that reflects reality.
      const users = [
        dormant({ id: 'truly-dormant' }),
        dormant({
          id: 'daily-user-stale-login',
          lastLoginAt: new Date(Date.now() - 30 * 24 * 3_600_000),
          lastSeenAt: new Date(),
        }),
      ];
      const prisma = makeStatefulPrisma(users, { events: 3, annonces: 2, newMembers: 1 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      await svc.processBatch(new Date());

      const pushedIds = notification.create.mock.calls.map((c) => c[0].userId);
      expect(pushedIds).toEqual(['truly-dormant']);
    });

    it('still selects legacy accounts whose lastSeenAt predates the column', async () => {
      // Rows created before the migration have lastSeenAt = NULL; dormancy must
      // then fall back to the login test rather than excluding them forever.
      const users = [dormant({ id: 'legacy', lastSeenAt: null, lastLoginAt: null })];
      const prisma = makeStatefulPrisma(users, { events: 1, annonces: 0, newMembers: 0 });
      const notification = makeNotification();
      const svc = new DigestService(prisma as never, notification as never, makeSettings() as never);

      await svc.processBatch(new Date());

      expect(notification.create.mock.calls.map((c) => c[0].userId)).toEqual(['legacy']);
    });
  });
});
