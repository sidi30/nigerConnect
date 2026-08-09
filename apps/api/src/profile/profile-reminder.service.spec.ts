import { ProfileReminderService } from './profile-reminder.service';

const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

type FakeUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  status: string;
  emailVerified: boolean;
  countryCode: string | null;
  newsletterOptIn: boolean;
  createdAt: Date;
  profileReminderSentAt: Date | null;
};

/** Applies the same eligibility predicate the service encodes in its `where`. */
function isEligible(u: FakeUser, now: Date): boolean {
  return (
    u.status === 'active' &&
    u.emailVerified === true &&
    u.email != null &&
    u.countryCode == null &&
    u.newsletterOptIn === true &&
    u.createdAt.getTime() < now.getTime() - THREE_DAYS &&
    u.profileReminderSentAt == null
  );
}

/**
 * Stateful fake Prisma backed by an in-memory user list. `findMany` honours the
 * eligibility predicate and `update` mutates in place, so idempotence/opt-out
 * are exercised functionally (mirrors digest.service.spec).
 */
function makeStatefulPrisma(users: FakeUser[]) {
  const now = () => new Date();
  return {
    __users: users,
    user: {
      findMany: jest.fn(async (_args: { where: Record<string, unknown> }) =>
        users
          .filter((u) => isEligible(u, now()))
          .map((u) => ({ id: u.id, email: u.email, firstName: u.firstName })),
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = users.find((x) => x.id === where.id);
        if (u) Object.assign(u, data);
        return u;
      }),
    },
  };
}

const makeMailer = () => ({ sendProfileReminder: jest.fn(async () => undefined) });
const makeSettings = (enabled = true) => ({
  isProfileReminderEnabled: jest.fn(async () => enabled),
});

/** A verified OAuth-style account, 4 days old, without a country — due for the nudge. */
const due = (over: Partial<FakeUser> = {}): FakeUser => ({
  id: 'u',
  email: 'u@gmail.com',
  firstName: 'Ali',
  status: 'active',
  emailVerified: true,
  countryCode: null,
  newsletterOptIn: true,
  createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
  profileReminderSentAt: null,
  ...over,
});

function makeSvc(prisma: ReturnType<typeof makeStatefulPrisma>, opts: { enabled?: boolean } = {}) {
  const mailer = makeMailer();
  const settings = makeSettings(opts.enabled ?? true);
  const svc = new ProfileReminderService(prisma as never, mailer as never, settings as never);
  return { svc, mailer, settings };
}

describe('ProfileReminderService', () => {
  it('sends the reminder to a due member and stamps profileReminderSentAt BEFORE the send', async () => {
    const users = [due({ id: 'u1', email: 'ali@gmail.com' })];
    const prisma = makeStatefulPrisma(users);
    const { svc, mailer } = makeSvc(prisma);

    const sent = await svc.processBatch();

    expect(sent).toBe(1);
    expect(mailer.sendProfileReminder).toHaveBeenCalledWith('ali@gmail.com', 'Ali');
    expect(users[0]!.profileReminderSentAt).not.toBeNull();
    // Stamp-before-send ordering (at-most-once on crash/restart).
    expect(prisma.user.update.mock.invocationCallOrder[0]!).toBeLessThan(
      mailer.sendProfileReminder.mock.invocationCallOrder[0]!,
    );
  });

  it('is idempotent: a second batch run sends nothing (one reminder per account, ever)', async () => {
    const users = [due({ id: 'u1' })];
    const prisma = makeStatefulPrisma(users);
    const { svc, mailer } = makeSvc(prisma);

    expect(await svc.processBatch()).toBe(1);
    expect(await svc.processBatch()).toBe(0);
    expect(mailer.sendProfileReminder).toHaveBeenCalledTimes(1);
  });

  it('skips members inside the grace period, with a country, unverified, opted-out or emailless', async () => {
    const users = [
      due({ id: 'fresh', createdAt: new Date() }), // still in grace period
      due({ id: 'complete', countryCode: 'NE' }), // profile already complete
      due({ id: 'unverified', emailVerified: false }),
      due({ id: 'optout', newsletterOptIn: false }),
      due({ id: 'no-email', email: null }),
      due({ id: 'suspended', status: 'suspended' }),
    ];
    const prisma = makeStatefulPrisma(users);
    const { svc, mailer } = makeSvc(prisma);

    expect(await svc.processBatch()).toBe(0);
    expect(mailer.sendProfileReminder).not.toHaveBeenCalled();
    expect(users.every((u) => u.profileReminderSentAt === null)).toBe(true);
  });

  it('sends nothing and touches no member when profile_reminder_enabled is off (fail-closed)', async () => {
    const users = [due({ id: 'u1' })];
    const prisma = makeStatefulPrisma(users);
    const { svc, mailer } = makeSvc(prisma, { enabled: false });

    expect(await svc.processBatch()).toBe(0);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(mailer.sendProfileReminder).not.toHaveBeenCalled();
    expect(users[0]!.profileReminderSentAt).toBeNull();
  });

  it('a per-member mail failure does not abort the batch; the member stays stamped (at-most-once)', async () => {
    const users = [due({ id: 'u1', email: 'a@x.com' }), due({ id: 'u2', email: 'b@x.com' })];
    const prisma = makeStatefulPrisma(users);
    const { svc, mailer } = makeSvc(prisma);
    mailer.sendProfileReminder.mockRejectedValueOnce(new Error('smtp down'));

    const sent = await svc.processBatch();

    // First send blew up after the stamp, second succeeded.
    expect(sent).toBe(1);
    expect(users[0]!.profileReminderSentAt).not.toBeNull();
    expect(users[1]!.profileReminderSentAt).not.toBeNull();
    // No retry for the stamped failure on the next run.
    expect(await svc.processBatch()).toBe(0);
  });
});
