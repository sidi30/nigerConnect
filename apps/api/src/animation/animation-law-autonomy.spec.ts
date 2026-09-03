import { BadRequestException } from '@nestjs/common';
import { AnimationService } from './animation.service';

/**
 * Une publication juridique part désormais sans relecture humaine — décision
 * du propriétaire le 22/08/2026, après trois `law` correctement sourcées
 * restées en `draft` pendant que le fil se taisait.
 *
 * Ce qui disparaît est le GUICHET. Ce qui reste est la SOURCE : c'est elle qui
 * empêche un compte d'affirmer un montant ou une date inventés, et elle tient
 * sans personne devant la console. Ce fichier existe pour que la barrière
 * humaine ne revienne pas par accident, et que la source ne parte pas avec.
 */

type Post = {
  botId: string;
  kind: string;
  status: string;
  content: string;
  sourceUrl: string | null;
  scheduledAt: Date;
};

/** Prisma en mémoire, limité à ce que `enqueue` touche vraiment. */
function makePrisma() {
  const created: Post[] = [];
  return {
    created,
    user: {
      findFirst: async () => ({ id: 'bot-1', countryCode: 'TR' }),
    },
    animationPost: {
      create: async ({ data }: { data: Post }) => {
        created.push(data);
        return { id: 'post-1', ...data };
      },
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new AnimationService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
      { getAnimationWeeklyPostCap: jest.fn().mockResolvedValue(100) } as never,
  );
}

const base = {
  handle: 'nc09',
  content: 'Le belge bedeli passe à 964 TL depuis le 01/01/2026.',
  scheduledAt: '2026-08-25T17:30:00.000Z',
} as const;

describe("Autonomie de l'atelier sur les publications juridiques", () => {
  it('programme un `law` sourcé sans attendre de relecture', async () => {
    const prisma = makePrisma();
    await makeService(prisma).enqueue({
      ...base,
      kind: 'law',
      sourceUrl: 'https://www.goc.gov.tr/belge-bedeli-ve-harc-miktari',
    });

    expect(prisma.created).toHaveLength(1);
    expect(prisma.created[0]!.status).toBe('approved');
  });

  it("gare en `draft` ce que l'atelier lui-même met de côté", async () => {
    const prisma = makePrisma();
    await makeService(prisma).enqueue({
      ...base,
      kind: 'law',
      sourceUrl: 'https://www.goc.gov.tr/belge-bedeli-ve-harc-miktari',
      hold: true,
    });

    expect(prisma.created[0]!.status).toBe('draft');
  });

  it('refuse toujours un `law` sans source officielle', async () => {
    const prisma = makePrisma();
    await expect(makeService(prisma).enqueue({ ...base, kind: 'law' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.created).toHaveLength(0);
  });

  it('laisse les autres genres partir comme avant', async () => {
    const prisma = makePrisma();
    await makeService(prisma).enqueue({ ...base, kind: 'tip' });

    expect(prisma.created[0]!.status).toBe('approved');
  });
});
