import { ForbiddenException } from '@nestjs/common';
import { DiasporaPolicyService } from './diaspora-policy.service';

/**
 * The rule: NigerConnect is for the diaspora. A member living in Niger reads
 * everything and talks to other members in Niger, but cannot reach OUT to a
 * diaspora member. One-directional on purpose — the diaspora keeps the right to
 * contact family back home, and the answer to that message is allowed.
 */
const COUNTRIES: Record<string, string | null> = {
  niamey: 'NE', // lives in Niger
  zinder: 'NE', // lives in Niger
  paris: 'FR', // diaspora
  montreal: 'CA', // diaspora
  unknown: null, // never filled in the registration form
};

const makeRedis = () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    },
  };
};

const makePrisma = (over: Record<string, unknown> = {}) => ({
  user: {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id in COUNTRIES ? { countryCode: COUNTRIES[where.id] } : null,
    ),
  },
  friendship: { findFirst: jest.fn(async () => null) },
  message: { findFirst: jest.fn(async () => null) },
  ...over,
});

const makeSettings = (restricted = true) => ({
  isDiasporaContactRestricted: jest.fn(async () => restricted),
});

const build = (prisma = makePrisma(), settings = makeSettings(), redis = makeRedis()) => ({
  svc: new DiasporaPolicyService(prisma as never, redis as never, settings as never),
  prisma,
  redis,
  settings,
});

describe('DiasporaPolicyService', () => {
  describe('who counts as living in Niger', () => {
    it.each([
      ['a member in Niger', 'niamey', true],
      ['a member in France', 'paris', false],
      ['a member who never set their country', 'unknown', true],
    ])('%s → homeBased=%s', async (_label, userId, expected) => {
      const { svc } = build();
      await expect(svc.isHomeBased(userId)).resolves.toBe(expected);
    });
  });

  describe('opening contact', () => {
    it.each([
      ['Niger → diaspora is refused', 'niamey', 'paris', false],
      ['Niger → Niger is allowed', 'niamey', 'zinder', true],
      ['diaspora → Niger is allowed', 'paris', 'niamey', true],
      ['diaspora → diaspora is allowed', 'paris', 'montreal', true],
      ['no country → diaspora is refused', 'unknown', 'paris', false],
      ['no country → Niger is allowed', 'unknown', 'niamey', true],
    ])('%s', async (_label, actor, target, expected) => {
      const { svc } = build();
      await expect(svc.mayInitiateContact(actor, target)).resolves.toBe(expected);
    });

    it('throws 403 when refused', async () => {
      const { svc } = build();
      await expect(svc.assertMayInitiateContact('niamey', 'paris')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    // A member blocked merely for not filling in a form must be told so — the
    // fix is one field away and the generic message would send them nowhere.
    it('tells a member with no country what to do, not that the rule bars them', async () => {
      const { svc } = build();
      await expect(svc.assertMayInitiateContact('unknown', 'paris')).rejects.toThrow(
        /Renseignez votre pays/,
      );
      await expect(svc.assertMayInitiateContact('niamey', 'paris')).rejects.toThrow(/diaspora/);
      await expect(svc.assertMayInitiateContact('niamey', 'paris')).rejects.not.toThrow(
        /Renseignez votre pays/,
      );
    });

    it('lets the admin switch lift the rule entirely', async () => {
      const { svc } = build(makePrisma(), makeSettings(false));
      await expect(svc.mayInitiateContact('niamey', 'paris')).resolves.toBe(true);
    });
  });

  describe('replying in an existing conversation', () => {
    it('is allowed once the diaspora member has written there', async () => {
      const prisma = makePrisma({
        friendship: { findFirst: jest.fn(async () => null) },
        message: { findFirst: jest.fn(async () => ({ id: 'm1' })) },
      });
      const { svc } = build(prisma);
      await expect(svc.mayReply('niamey', 'paris', 'c1')).resolves.toBe(true);
    });

    it('is allowed when the two were already friends — existing ties are kept', async () => {
      const prisma = makePrisma({
        friendship: { findFirst: jest.fn(async () => ({ id: 'f1' })) },
        message: { findFirst: jest.fn(async () => null) },
      });
      const { svc } = build(prisma);
      await expect(svc.mayReply('niamey', 'paris', 'c1')).resolves.toBe(true);
    });

    it('is refused when the diaspora member has said nothing and they are not friends', async () => {
      const { svc } = build();
      await expect(svc.mayReply('niamey', 'paris', 'c1')).resolves.toBe(false);
      await expect(svc.assertMayReply('niamey', 'paris', 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    // The gate is on the pair, not the room: two members in Niger must keep
    // talking without a friendship or a first move from anyone.
    it('never gets in the way between two members in Niger', async () => {
      const { svc, prisma } = build();
      await expect(svc.mayReply('niamey', 'zinder', 'c1')).resolves.toBe(true);
      expect(prisma.message.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('reads a member country once, then serves it from Redis', async () => {
      const { svc, prisma } = build();
      await svc.isHomeBased('paris');
      await svc.isHomeBased('paris');
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('re-reads after invalidate, so a corrected country applies at once', async () => {
      const { svc, prisma } = build();
      await svc.isHomeBased('paris');
      await svc.invalidate('paris');
      await svc.isHomeBased('paris');
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
