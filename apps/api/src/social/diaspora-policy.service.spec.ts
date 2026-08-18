import { ForbiddenException } from '@nestjs/common';
import { DiasporaPolicyService } from './diaspora-policy.service';

/**
 * Two rules with two different shapes, which is exactly what makes them easy to
 * get wrong — hence a test for each direction of each.
 *
 * CONTACT is one-directional: Niger may not reach out to the diaspora, but the
 * diaspora may reach home, and the reply to that message is allowed.
 * CONTENT is symmetric: each side sees only its own posts.
 * MEMBERS are never filtered — that is what keeps the contact right usable.
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

const makeSettings = (restricted = true, split = restricted, unknownIsHome = true) => ({
  isDiasporaContactRestricted: jest.fn(async () => restricted),
  isDiasporaContentSplit: jest.fn(async () => split),
  isDiasporaUnknownCountryRestricted: jest.fn(async () => unknownIsHome),
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

  describe('content scope (authorScope)', () => {
    // Every scope is now `{ OR: [ {isOfficial: true}, <side clause> ] }` — the
    // official account speaks to both sides. `sideOf` pulls the side clause back
    // out so each rule below still reads as the rule it is testing.
    const sideOf = (scope: unknown): Record<string, unknown> =>
      (scope as { OR: Record<string, unknown>[] }).OR[1]!;

    // The exemption itself: without it, half the community would never see a
    // post from the platform.
    it('lets the official account through on both sides', async () => {
      const { svc } = build();
      for (const viewer of ['paris', 'niamey', 'unknown']) {
        const scope = (await svc.authorScope(viewer)) as { OR: unknown[] };
        expect(scope.OR[0]).toEqual({ isOfficial: true });
      }
    });

    // Content is split symmetrically, unlike contact. A viewer only ever sees
    // authors from their own side.
    it('shows a diaspora viewer only diaspora authors', async () => {
      const { svc } = build();
      expect(sideOf(await svc.authorScope('paris'))).toEqual({
        countryCode: { not: null, notIn: ['NE'] },
      });
    });

    it('shows a viewer in Niger only home-based authors, including those with no country', async () => {
      const { svc } = build();
      expect(sideOf(await svc.authorScope('niamey'))).toEqual({
        OR: [{ countryCode: null }, { countryCode: 'NE' }],
      });
    });

    it('treats a viewer with no country as home-based', async () => {
      const { svc } = build();
      expect(sideOf(await svc.authorScope('unknown'))).toEqual({
        OR: [{ countryCode: null }, { countryCode: 'NE' }],
      });
    });

    // Null, not an empty object: callers must be able to skip the clause
    // entirely rather than add a no-op that silently matches everything.
    it('returns null when the admin switch lifts the rule', async () => {
      const { svc } = build(makePrisma(), makeSettings(false));
      await expect(svc.authorScope('paris')).resolves.toBeNull();
    });

    // The two scopes must PARTITION the members: no author visible to both
    // sides, and none visible to neither.
    it('partitions authors — the two scopes never overlap and never leave a gap', async () => {
      const { svc } = build();
      const diaspora = sideOf(await svc.authorScope('paris'));
      const home = sideOf(await svc.authorScope('niamey'));
      const matches = (scope: Record<string, unknown>, country: string | null): boolean =>
        'OR' in scope
          ? country === null || country === 'NE'
          : country !== null && country !== 'NE';
      for (const country of ['FR', 'CA', 'NE', null]) {
        const seen = [matches(diaspora, country), matches(home, country)].filter(Boolean).length;
        expect(seen).toBe(1);
      }
    });
  });
  /**
   * The country filter narrows the viewer's own side. The trap it must never
   * fall into: letting a filter ACT AS a way around the split — asking for 'NE'
   * from the diaspora side has to stay empty, not become a door.
   */
  describe('country filter (authorScope + resolveFeedCountry)', () => {
    const sideOf = (scope: unknown): Record<string, unknown> =>
      (scope as { OR: Record<string, unknown>[] }).OR[1]!;

    // Compatibilité : une application ancienne n'envoie pas de pays et n'a pas
    // les pastilles. Filtrer d'office lui réduirait le fil sans recours.
    it('ne filtre RIEN quand le client ne demande pas de pays', async () => {
      const { svc } = build();
      await expect(svc.resolveFeedCountry('paris')).resolves.toBeNull();
      await expect(svc.resolveFeedCountry('unknown')).resolves.toBeNull();
    });

    it('applique le pays demandé, et « all » lève le filtre', async () => {
      const { svc } = build();
      await expect(svc.resolveFeedCountry('paris', 'MA')).resolves.toBe('MA');
      await expect(svc.resolveFeedCountry('paris', 'all')).resolves.toBeNull();
    });

    it('ANDs the country with the side clause, never replaces it', async () => {
      const { svc } = build();
      const side = sideOf(await svc.authorScope('paris', 'MA')) as { AND: unknown[] };
      expect(side.AND).toHaveLength(2);
      expect(side.AND[1]).toEqual({ countryCode: 'MA' });
    });

    // The whole point: the filter is a convenience, not a bypass.
    it('cannot be used to reach the other side of the split', async () => {
      const { svc } = build();
      const side = sideOf(await svc.authorScope('paris', 'NE')) as { AND: Record<string, unknown>[] };
      // Diaspora clause excludes NE, country clause demands NE → provably empty.
      expect(side.AND[0]).toEqual({ countryCode: { not: null, notIn: ['NE'] } });
      expect(side.AND[1]).toEqual({ countryCode: 'NE' });
    });

    it('keeps the official account visible whatever the country asked for', async () => {
      const { svc } = build();
      const scope = (await svc.authorScope('paris', 'TR')) as { OR: unknown[] };
      expect(scope.OR[0]).toEqual({ isOfficial: true });
    });

    // With the split lifted, the country filter is all that remains — it must
    // still produce a clause, where the old code returned null (= no filter).
    it('still filters by country when the split switch is off', async () => {
      const { svc } = build(makePrisma(), makeSettings(true, false));
      const scope = (await svc.authorScope('paris', 'FR')) as { OR: unknown[] };
      expect(scope.OR[1]).toEqual({ countryCode: 'FR' });
      // …and nothing at all is asked for → unchanged behaviour, no clause.
      await expect(svc.authorScope('paris')).resolves.toBeNull();
    });
  });

  describe('single-item scope (sharesContentScope)', () => {
    it.each([
      ['diaspora viewer, diaspora author', 'paris', 'montreal', true],
      ['diaspora viewer, author in Niger', 'paris', 'niamey', false],
      ['viewer in Niger, author in Niger', 'niamey', 'zinder', true],
      ['viewer in Niger, diaspora author', 'niamey', 'paris', false],
      ['author with no country counts as home', 'niamey', 'unknown', true],
    ])('%s → %s', async (_l, viewer, author, expected) => {
      const { svc } = build();
      await expect(svc.sharesContentScope(viewer, author)).resolves.toBe(expected);
    });

    // Own content is never hidden from its author, whatever the rule says.
    it('always lets a member see their own content', async () => {
      const { svc } = build();
      await expect(svc.sharesContentScope('niamey', 'niamey')).resolves.toBe(true);
    });

    it('is lifted by the admin switch, like everything else', async () => {
      const { svc } = build(makePrisma(), makeSettings(false));
      await expect(svc.sharesContentScope('paris', 'niamey')).resolves.toBe(true);
    });

    // sharesContentScope and authorScope decide the same question by two routes
    // (one item vs a SQL clause). If they ever disagree, a post would be listed
    // in the feed and 404 when opened, or the reverse.
    it('agrees with authorScope on every combination', async () => {
      const { svc } = build();
      const sideOf = (scope: unknown): Record<string, unknown> =>
        (scope as { OR: Record<string, unknown>[] }).OR[1]!;
      const inScope = (scope: Record<string, unknown>, country: string | null): boolean =>
        'OR' in scope ? country === null || country === 'NE' : country !== null && country !== 'NE';
      for (const viewer of ['paris', 'niamey', 'unknown']) {
        const scope = sideOf(await svc.authorScope(viewer));
        for (const author of ['paris', 'montreal', 'niamey', 'zinder', 'unknown']) {
          if (viewer === author) continue;
          expect(inScope(scope, COUNTRIES[author]!)).toBe(
            await svc.sharesContentScope(viewer, author),
          );
        }
      }
    });
  });
  // Les trois règles sont des interrupteurs admin INDÉPENDANTS. Le piège serait
  // qu'en couper un en coupe un autre par effet de bord.
  describe('admin switches are independent', () => {
    it('lifting CONTACT leaves the content split in place', async () => {
      const { svc } = build(makePrisma(), makeSettings(false, true));
      await expect(svc.mayInitiateContact('niamey', 'paris')).resolves.toBe(true);
      await expect(svc.sharesContentScope('paris', 'niamey')).resolves.toBe(false);
      await expect(svc.authorScope('paris')).resolves.not.toBeNull();
    });

    it('lifting the CONTENT split leaves the contact rule in place', async () => {
      const { svc } = build(makePrisma(), makeSettings(true, false));
      await expect(svc.authorScope('paris')).resolves.toBeNull();
      await expect(svc.sharesContentScope('paris', 'niamey')).resolves.toBe(true);
      await expect(svc.mayInitiateContact('niamey', 'paris')).resolves.toBe(false);
    });

    it('a member with no country becomes diaspora when the switch is off', async () => {
      const { svc } = build(makePrisma(), makeSettings(true, true, false));
      await expect(svc.isHomeBased('unknown')).resolves.toBe(false);
      // …and may then contact the diaspora, which was the whole point.
      await expect(svc.mayInitiateContact('unknown', 'paris')).resolves.toBe(true);
      // A real Niger member is untouched by that switch.
      await expect(svc.isHomeBased('niamey')).resolves.toBe(true);
    });

    it('the SQL clause follows the unknown-country switch too', async () => {
      const { svc } = build(makePrisma(), makeSettings(true, true, false));
      const sideOf = (scope: unknown): Record<string, unknown> =>
        (scope as { OR: Record<string, unknown>[] }).OR[1]!;
      // Unknown-country members now belong to the diaspora side…
      expect(sideOf(await svc.authorScope('niamey'))).toEqual({ countryCode: 'NE' });
      // …so the diaspora clause must let them in, or they would vanish for both.
      const diaspora = sideOf(await svc.authorScope('paris')) as { OR: unknown[] };
      expect(diaspora.OR).toContainEqual({ countryCode: null });
    });

    // The verdict depends on a switch, so caching it would delay the switch.
    it('caches the country, not the home/diaspora verdict', async () => {
      const settings = makeSettings(true, true, true);
      const { svc, prisma } = build(makePrisma(), settings);
      await expect(svc.isHomeBased('unknown')).resolves.toBe(true);
      settings.isDiasporaUnknownCountryRestricted.mockResolvedValue(false);
      // Same member, same cache entry, new verdict — no 5-minute lag.
      await expect(svc.isHomeBased('unknown')).resolves.toBe(false);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
