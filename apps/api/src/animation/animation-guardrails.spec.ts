import { BadRequestException } from '@nestjs/common';
import { AnimationService } from './animation.service';
import {
  containsBannedGreeting,
  illustrationsEnabled,
  stripLeadingBannedGreeting,
  vetGreetings,
} from './animation-guardrails';

/**
 * Trois consignes du propriétaire, prises ensemble parce qu'elles disent une
 * seule chose : les comptes d'animation doivent se voir moins.
 *
 *   1. plus de « Fofo » ni « Sannu » — la formule revenait sur tous les comptes,
 *   2. moins de publications — la cadence réglée en console était décorative,
 *   3. plus d'images — une illustration générée se repère.
 *
 * Chacune est testée là où elle est RÉELLEMENT tenue (le service), pas là où
 * elle est seulement demandée (le fichier de consignes de l'atelier).
 */

describe('salutations bannies', () => {
  it.each(['Fofo', 'sannu', 'Sannu da aiki', 'FOFO les amis'])(
    'reconnaît « %s »',
    (text) => {
      expect(containsBannedGreeting(text)).toBe(true);
    },
  );

  it.each(['Bonjour', 'Salut tout le monde', 'La rentrée arrive'])(
    'laisse passer « %s »',
    (text) => {
      expect(containsBannedGreeting(text)).toBe(false);
    },
  );

  it('retire la salutation en tête et remet la majuscule', () => {
    expect(stripLeadingBannedGreeting('Fofo. la rentrée arrive et les loyers montent.')).toBe(
      'La rentrée arrive et les loyers montent.',
    );
    expect(stripLeadingBannedGreeting('Sannu da aiki, comment ça se passe à Niamey ?')).toBe(
      'Comment ça se passe à Niamey ?',
    );
  });

  it('ne touche pas à un texte sain', () => {
    const text = 'Les démarches de titre de séjour ont changé cette année.';
    expect(stripLeadingBannedGreeting(text)).toBe(text);
  });

  it('refuse quand le mot est au milieu de la phrase — le retirer réécrirait le propos', () => {
    const verdict = vetGreetings('On se dit toujours sannu avant de commencer.');
    expect(verdict.ok).toBe(false);
  });
});

describe('AnimationService.enqueue', () => {
  function makeService(created: Record<string, unknown>[]) {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'bot-1', countryCode: 'NE' }) },
      animationPost: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'post-1', ...data };
        }),
      },
    };
    return new AnimationService(
      prisma as never,
      {} as never,
      { create: jest.fn() } as never,
      {} as never,
      {} as never,
      { getAnimationWeeklyPostCap: jest.fn().mockResolvedValue(10) } as never,
    );
  }

  const base = {
    handle: 'nc01',
    kind: 'tip' as const,
    scheduledAt: new Date('2026-09-03T10:00:00Z').toISOString(),
  };

  it('nettoie la salutation avant de ranger la publication en file', async () => {
    const created: Record<string, unknown>[] = [];
    const service = makeService(created);
    await service.enqueue({ ...base, content: 'Fofo ! le marché de Niamey rouvre lundi.' } as never);
    expect(created[0]!.content).toBe('Le marché de Niamey rouvre lundi.');
  });

  it('refuse la publication dont la salutation est enchâssée', async () => {
    const service = makeService([]);
    await expect(
      service.enqueue({ ...base, content: 'Un petit sannu à la famille de Zinder.' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignore l’image tant que les illustrations sont éteintes', async () => {
    const created: Record<string, unknown>[] = [];
    const service = makeService(created);
    await service.enqueue({
      ...base,
      content: 'Le marché rouvre lundi.',
      mediaUrl: 'https://cdn.nigerconnect.app/users/bot-1/animation/x.jpg',
    } as never);
    expect(created[0]!.mediaUrl).toBeNull();
  });
});

describe('illustrationsEnabled', () => {
  const previous = process.env.ANIMATION_ILLUSTRATIONS;
  afterEach(() => {
    if (previous === undefined) delete process.env.ANIMATION_ILLUSTRATIONS;
    else process.env.ANIMATION_ILLUSTRATIONS = previous;
  });

  it('est éteint par défaut', () => {
    delete process.env.ANIMATION_ILLUSTRATIONS;
    expect(illustrationsEnabled()).toBe(false);
  });

  it('se rallume par variable d’environnement, sans redéploiement de code', () => {
    process.env.ANIMATION_ILLUSTRATIONS = '1';
    expect(illustrationsEnabled()).toBe(true);
  });
});

describe('AnimationService.publishDue — cadence tenue', () => {
  /**
   * `postsPerWeek` ne servait qu'à l'atelier : le cron publiait tout ce qui
   * était approuvé et dû. Une file re-remplie (le défaut des doublons) ou un
   * rattrapage après panne sortait donc d'un bloc, cadence réglée ou pas.
   */
  function makeService(opts: {
    postsPerWeek: number;
    alreadyThisWeek: number;
    due: number;
    platformCap?: number;
    platformSent?: number;
  }) {
    const due = Array.from({ length: opts.due }, (_, i) => ({
      id: `queued-${i}`,
      botId: 'bot-1',
      content: `Publication ${i}`,
      mediaUrl: null,
    }));
    const updated: { id: string; status: string }[] = [];
    const prisma = {
      animationPost: {
        findMany: jest.fn().mockResolvedValue(due),
        groupBy: jest
          .fn()
          .mockResolvedValue(
            opts.alreadyThisWeek > 0
              ? [{ botId: 'bot-1', _count: { _all: opts.alreadyThisWeek } }]
              : [],
          ),
        count: jest.fn().mockResolvedValue(opts.platformSent ?? 0),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
          updated.push({ id: where.id, status: data.status });
          return {};
        }),
      },
      animationBot: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: 'bot-1', postsPerWeek: opts.postsPerWeek }]),
      },
    };
    const posts = { create: jest.fn().mockResolvedValue({ id: 'published-post' }) };
    const service = new AnimationService(
      prisma as never,
      {} as never,
      posts as never,
      {} as never,
      {} as never,
      {
        getAnimationWeeklyPostCap: jest.fn().mockResolvedValue(opts.platformCap ?? 100),
      } as never,
    );
    return { service, posts, updated };
  }

  it('s’arrête au quota hebdomadaire et garde le reste en file', async () => {
    const { service, posts, updated } = makeService({
      postsPerWeek: 2,
      alreadyThisWeek: 0,
      due: 5,
    });
    const result = await service.publishDue(new Date('2026-09-03T12:00:00Z'));
    expect(result.published).toBe(2);
    expect(posts.create).toHaveBeenCalledTimes(2);
    // Les trois autres restent `approved` : reportées, pas perdues.
    expect(updated.filter((u) => u.status === 'published')).toHaveLength(2);
    expect(updated).toHaveLength(2);
  });

  it('ne publie rien quand le quota est déjà consommé sur sept jours glissants', async () => {
    const { service, posts } = makeService({ postsPerWeek: 2, alreadyThisWeek: 2, due: 3 });
    const result = await service.publishDue(new Date('2026-09-03T12:00:00Z'));
    expect(result.published).toBe(0);
    expect(posts.create).not.toHaveBeenCalled();
  });
});

describe('AnimationService.publishDue — plafond plateforme', () => {
  /**
   * Le quota par compte a un plancher : un entier ne descend pas sous 1, donc
   * vingt-cinq comptes actifs publient au minimum vingt-cinq fois par semaine.
   * Le plafond global est le seul réglage qui passe sous ce plancher sans
   * éteindre de compte — et il se règle depuis la console, sans redéploiement.
   */
  function makeService(opts: { cap: number; platformSent: number; due: number }) {
    const due = Array.from({ length: opts.due }, (_, i) => ({
      id: `queued-${i}`,
      // Un compte différent par publication : le quota par compte ne peut donc
      // pas être ce qui arrête la passe, seul le plafond global le peut.
      botId: `bot-${i}`,
      content: `Publication ${i}`,
      mediaUrl: null,
    }));
    const prisma = {
      animationPost: {
        findMany: jest.fn().mockResolvedValue(due),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(opts.platformSent),
        update: jest.fn().mockResolvedValue({}),
      },
      animationBot: {
        findMany: jest
          .fn()
          .mockResolvedValue(due.map((d) => ({ userId: d.botId, postsPerWeek: 1 }))),
      },
    };
    const posts = { create: jest.fn().mockResolvedValue({ id: 'published-post' }) };
    const service = new AnimationService(
      prisma as never,
      {} as never,
      posts as never,
      {} as never,
      {} as never,
      { getAnimationWeeklyPostCap: jest.fn().mockResolvedValue(opts.cap) } as never,
    );
    return { service, posts };
  }

  it('arrête la passe au plafond, même si chaque compte a encore son quota', async () => {
    const { service, posts } = makeService({ cap: 3, platformSent: 0, due: 8 });
    const result = await service.publishDue(new Date('2026-09-03T12:00:00Z'));
    expect(result.published).toBe(3);
    expect(posts.create).toHaveBeenCalledTimes(3);
  });

  it('tient compte de ce qui est déjà parti dans la semaine', async () => {
    const { service, posts } = makeService({ cap: 10, platformSent: 9, due: 5 });
    const result = await service.publishDue(new Date('2026-09-03T12:00:00Z'));
    expect(result.published).toBe(1);
    expect(posts.create).toHaveBeenCalledTimes(1);
  });

  it('à 0, plus aucune publication d’animation ne sort', async () => {
    const { service, posts } = makeService({ cap: 0, platformSent: 0, due: 4 });
    const result = await service.publishDue(new Date('2026-09-03T12:00:00Z'));
    expect(result.published).toBe(0);
    expect(posts.create).not.toHaveBeenCalled();
  });
});
