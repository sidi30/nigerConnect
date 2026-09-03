import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AnimationKind, AnimationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { PostsService } from '../feed/posts.service';
import { S3Service } from '../common/storage/s3.service';
import { DiasporaPolicyService } from '../social/diaspora-policy.service';
import { geocode, jitterCoord } from '../common/geo/city-coords';
import { ROSTER, emailFor, type RosterEntry } from './roster';
import type { EnqueueDto, ReviewDto, UpdateBotDto } from './dto/animation.dto';
import { illustrationsEnabled, vetGreetings } from './animation-guardrails';
import { SettingsService } from '../common/settings/settings.service';

/** Colonnes renvoyées à la console pour un compte d'animation. */
const BOT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  city: true,
  countryCode: true,
  avatarUrl: true,
  email: true,
} as const satisfies Prisma.UserSelect;

/**
 * Animation éditoriale de la plateforme.
 *
 * Deux moitiés délibérément séparées :
 *   - l'ATELIER (Claude Code sur le poste du propriétaire) appelle `enqueue`
 *     par lots quand la machine est allumée ;
 *   - le CRON du serveur appelle `publishDue` toutes les cinq minutes et vide
 *     la file à l'heure prévue, que le poste soit allumé ou non.
 *
 * Un contenu `law` ne sort jamais sans source officielle. Ces publications
 * s'adressent à des gens dont le séjour dépend de l'information : une erreur
 * sur « peut-on encore échanger son permis » coûte une voiture, un emploi,
 * parfois le titre de séjour. La règle est portée à trois niveaux — schéma
 * Zod, refus ici, et contrainte CHECK en base.
 *
 * En revanche la relecture humaine n'est PLUS un passage obligé (choix du
 * propriétaire, 22/08/2026). Elle l'était, et le résultat s'est vu : trois
 * `law` correctement sourcées ont dormi en `draft` pendant que le fil restait
 * vide, parce que personne n'était devant la console. Une file qui attend un
 * humain absent ne protège personne — elle éteint la plateforme. Ce qui
 * protège vraiment est mécanique et tient sans surveillance : la source
 * obligatoire ci-dessus, et `vet()` côté rédaction. L'atelier garde la main
 * pour garer lui-même un texte douteux (`hold`), et `review()` reste ouvert
 * pour corriger ou retirer après coup.
 */
@Injectable()
export class AnimationService {
  private readonly logger = new Logger(AnimationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly posts: PostsService,
    private readonly s3: S3Service,
    private readonly diaspora: DiasporaPolicyService,
    private readonly settings: SettingsService,
  ) {}

  // ── Comptes ────────────────────────────────────────────────

  /**
   * Crée (ou complète) les 25 comptes du roster. Idempotent : relancer
   * n'ajoute rien, met seulement à jour ce qui a bougé dans le roster.
   *
   * Les comptes n'ont pas de mot de passe utilisable : personne ne s'y connecte
   * jamais, ni l'atelier ni le propriétaire. Tout ce qu'ils publient passe par
   * ce service, côté serveur, avec leur id. Un mot de passe aléatoire de 48
   * octets est posé parce que la colonne l'exige, puis oublié — c'est
   * strictement moins de surface qu'un jeu de 25 identifiants qui circulerait.
   */
  async ensureAccounts(): Promise<{ created: number; updated: number; total: number }> {
    let created = 0;
    let updated = 0;

    for (const entry of ROSTER) {
      const email = emailFor(entry.handle);
      const existing = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: this.profileOf(entry),
        });
        // Le pays a pu changer dans le roster : la portée diaspora est cachée
        // cinq minutes, on la purge tout de suite.
        await this.diaspora.invalidate(existing.id);
        await this.ensureBotConfig(existing.id, entry);
        updated += 1;
        continue;
      }

      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await this.password.hash(randomBytes(48).toString('base64url')),
          // Vérifié d'office : ces comptes ne peuvent pas relever de mail, et
          // EmailVerifiedGuard bloquerait sinon toute publication.
          emailVerified: true,
          isAnimated: true,
          ...this.profileOf(entry),
        },
      });
      await this.ensureBotConfig(user.id, entry);
      created += 1;
    }

    this.logger.log(`Roster d'animation : ${created} créés, ${updated} mis à jour`);
    return { created, updated, total: ROSTER.length };
  }

  /**
   * Champs de profil pilotés par le roster (le reste est laissé intact).
   * Typé en objet nu, pas en `UserUpdateInput` : ce dernier autorise les
   * opérateurs Prisma (`{ set: … }`), qui ne passent pas dans un `create`.
   */
  private profileOf(entry: RosterEntry): {
    firstName: string;
    lastName: string;
    displayName: string;
    bio: string;
    city: string;
    countryCode: string;
    showOnMap: boolean;
    proximityAlerts: boolean;
    latitude: number | null;
    longitude: number | null;
  } {
    // Mêmes fonctions que l'inscription : centroïde de la ville puis jitter.
    // Un centroïde exact placerait les six comptes turcs au même pixel.
    const coords = geocode(entry.city, entry.countryCode);
    const jittered = coords ? jitterCoord(coords) : null;
    return {
      firstName: entry.firstName,
      lastName: entry.lastName,
      displayName: `${entry.firstName} ${entry.lastName}`,
      bio: entry.bio,
      city: entry.city,
      countryCode: entry.countryCode,
      showOnMap: true,
      // La proximité reste coupée : elle déclenche des rencontres physiques,
      // ce qu'un compte éditorial ne peut évidemment pas honorer.
      proximityAlerts: false,
      latitude: jittered?.lat ?? null,
      longitude: jittered?.lon ?? null,
    };
  }

  async listAccounts() {
    const items = await this.prisma.user.findMany({
      where: { isAnimated: true },
      select: BOT_SELECT,
      orderBy: [{ countryCode: 'asc' }, { email: 'asc' }],
    });
    return { items, expected: ROSTER.length };
  }

  /**
   * Signe un téléversement d'avatar POUR un compte d'animation.
   *
   * Ces comptes ne se connectent jamais : personne ne détient leurs
   * identifiants. La signature part donc d'une route admin — mais le dossier
   * reste `users/{id du compte}`, exactement comme pour un membre. C'est ce qui
   * permet à `assertOwnedPublicImage` de valider l'appartenance ensuite, sans
   * exception taillée pour l'occasion.
   */
  async presignAvatar(handle: string, contentType: string) {
    const bot = await this.botUser(handle);
    return this.s3.createPresignedUpload({
      folder: `users/${bot.id}`,
      contentType,
      visibility: 'public',
    });
  }

  /** Fixe l'avatar après téléversement, en liant l'URL au compte. */
  async setAvatar(handle: string, avatarUrl: string) {
    const bot = await this.botUser(handle);
    const bound = await this.s3.assertOwnedPublicImage(avatarUrl, bot.id);
    return this.prisma.user.update({
      where: { id: bot.id },
      data: { avatarUrl: bound },
      select: BOT_SELECT,
    });
  }

  private async botUser(handle: string) {
    const bot = await this.prisma.user.findFirst({
      where: { email: emailFor(handle), isAnimated: true },
      select: { id: true },
    });
    if (!bot) throw new NotFoundException(`Compte d'animation inconnu : ${handle}`);
    return bot;
  }

  // ── File de publication ────────────────────────────────────

  /**
   * L'atelier dépose une publication, et elle part à l'heure dite sans
   * attendre personne — y compris un contenu juridique, dès lors qu'il porte
   * sa source officielle. Le seul chemin vers `draft` est désormais `hold` :
   * l'atelier gare ce dont il doute, au lieu que tout un genre soit garé par
   * principe.
   */
  async enqueue(dto: EnqueueDto) {
    const bot = await this.prisma.user.findFirst({
      where: { email: emailFor(dto.handle), isAnimated: true },
      select: { id: true, countryCode: true },
    });
    if (!bot) throw new NotFoundException(`Compte d'animation inconnu : ${dto.handle}`);

    if (dto.kind === 'law' && !dto.sourceUrl) {
      throw new BadRequestException(
        'Une publication juridique exige une source officielle (sourceUrl).',
      );
    }

    // Les salutations bannies sont retirées ici, et pas seulement demandées à
    // l'atelier : c'est le seul point par lequel TOUTE publication passe.
    const vetted = vetGreetings(dto.content);
    if (!vetted.ok) throw new BadRequestException(vetted.why);

    const status: AnimationStatus = dto.hold ? 'draft' : 'approved';

    return this.prisma.animationPost.create({
      data: {
        botId: bot.id,
        countryCode: bot.countryCode,
        kind: dto.kind,
        status,
        content: vetted.text,
        // Images éteintes par défaut : une URL déposée par l'atelier est
        // ignorée plutôt que refusée, pour ne pas perdre le texte avec.
        mediaUrl: illustrationsEnabled() ? (dto.mediaUrl ?? null) : null,
        sourceUrl: dto.sourceUrl ?? null,
        scheduledAt: new Date(dto.scheduledAt),
      },
    });
  }

  async list(status?: AnimationStatus, limit = 50) {
    return this.prisma.animationPost.findMany({
      where: status ? { status } : {},
      take: limit,
      orderBy: { scheduledAt: 'asc' },
      include: { bot: { select: BOT_SELECT } },
    });
  }

  /** Reprise en main d'un brouillon garé par l'atelier, ou corrigé après coup. */
  async review(id: string, reviewerId: string, dto: ReviewDto) {
    const item = await this.prisma.animationPost.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Publication introuvable');
    if (item.status !== 'draft') {
      throw new BadRequestException(`Déjà traitée (${item.status})`);
    }

    // Une correction manuelle repasse par le même filtre que l'atelier.
    const vetted = vetGreetings(dto.content ?? item.content);
    if (!vetted.ok) throw new BadRequestException(vetted.why);

    return this.prisma.animationPost.update({
      where: { id },
      data: {
        status: dto.action === 'approve' ? 'approved' : 'rejected',
        // Le texte peut être corrigé au moment de la validation : c'est le
        // dernier point où une erreur juridique s'arrête.
        content: vetted.text,
        sourceUrl: dto.sourceUrl ?? item.sourceUrl,
        reviewNote: dto.note ?? null,
        reviewedById: reviewerId,
      },
    });
  }

  // ── Publication (cron) ─────────────────────────────────────

  /**
   * Publie tout ce qui est approuvé et dont l'heure est passée.
   *
   * Chaque élément est isolé : une publication qui échoue (média disparu,
   * compte supprimé) ne doit pas retenir les suivantes, sinon un seul contenu
   * cassé gèle l'animation de toute la plateforme.
   */
  async publishDue(now = new Date()): Promise<{ published: number; failed: number }> {
    // Un compte en pause ne publie pas non plus. Sans cette condition,
    // `active: false` n'éteignait que l'engagement et les réponses : un compte
    // « éteint » depuis la console aurait continué à publier son stock déjà
    // approuvé, ce qui est exactement ce qu'on croit avoir arrêté.
    const due = await this.prisma.animationPost.findMany({
      where: {
        status: 'approved',
        scheduledAt: { lte: now },
        bot: { animationBot: { active: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });
    if (due.length === 0) return { published: 0, failed: 0 };

    // Cadence RÉELLEMENT tenue ici. `postsPerWeek` ne servait qu'à l'atelier,
    // qui décide de ce qu'il dépose : une file remplie deux fois, ou un lot
    // rattrapé après une panne, sortait donc d'un coup, quelle que soit la
    // cadence réglée depuis la console. On compte ce qui est déjà parti sur
    // sept jours glissants, et on garde le reste en file — rien n'est perdu,
    // tout est décalé.
    const botIds = [...new Set(due.map((item) => item.botId))];
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [configs, alreadySent, platformSent, platformCap] = await Promise.all([
      this.prisma.animationBot.findMany({
        where: { userId: { in: botIds } },
        select: { userId: true, postsPerWeek: true },
      }),
      this.prisma.animationPost.groupBy({
        by: ['botId'],
        where: { botId: { in: botIds }, status: 'published', publishedAt: { gte: since } },
        _count: { _all: true },
      }),
      // Plafond plateforme : compté sur TOUS les comptes, pas seulement ceux
      // qui ont quelque chose à sortir dans cette passe.
      this.prisma.animationPost.count({
        where: { status: 'published', publishedAt: { gte: since } },
      }),
      this.settings.getAnimationWeeklyPostCap(),
    ]);
    const quota = new Map(configs.map((c) => [c.userId, c.postsPerWeek]));
    const weekCount = new Map(alreadySent.map((row) => [row.botId, row._count._all]));
    let platformCount = platformSent;

    let published = 0;
    let failed = 0;
    let postponed = 0;
    for (const item of due) {
      // Le quota par compte ne descend pas sous une publication par semaine.
      // Le plafond plateforme, lui, décide combien de comptes s'expriment
      // réellement dans les sept jours — c'est le seul levier pour passer sous
      // vingt-cinq publications hebdomadaires sans éteindre de compte.
      if (platformCount >= platformCap) {
        postponed += 1;
        continue;
      }
      const allowed = quota.get(item.botId) ?? 0;
      if ((weekCount.get(item.botId) ?? 0) >= allowed) {
        postponed += 1;
        continue;
      }
      try {
        const post = await this.posts.create(item.botId, {
          content: item.content,
          visibility: 'public',
          // Images éteintes par défaut (voir animation-guardrails) : une
          // publication déjà en file avec son image part quand même, en texte.
          media:
            illustrationsEnabled() && item.mediaUrl
              ? [{ mediaUrl: item.mediaUrl, mediaType: 'image' as const }]
              : undefined,
        });
        await this.prisma.animationPost.update({
          where: { id: item.id },
          data: { status: 'published', publishedAt: new Date(), publishedPostId: post.id },
        });
        published += 1;
        weekCount.set(item.botId, (weekCount.get(item.botId) ?? 0) + 1);
        platformCount += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Publication d'animation ${item.id} échouée : ${String(error)}`,
        );
      }
    }
    if (published > 0 || postponed > 0) {
      this.logger.log(
        `Animation : ${published} publiées, ${failed} en échec, ${postponed} reportées (cadence)`,
      );
    }
    return { published, failed };
  }

  /**
   * Réglages d'exploitation du compte. Créés une fois puis JAMAIS écrasés :
   * relancer le roster ne doit pas remettre à zéro une cadence que le
   * propriétaire a réglée à la main depuis la console.
   */
  private async ensureBotConfig(userId: string, entry: RosterEntry): Promise<void> {
    await this.prisma.animationBot.upsert({
      where: { handle: entry.handle },
      create: {
        userId,
        handle: entry.handle,
        kind: entry.kind,
        // Le juridique publie moins souvent que l'ambiance : il attend une
        // actualité réelle, pas un créneau dans un calendrier.
        // Une publication par semaine et par compte, quel que soit le genre.
        // Les valeurs d'origine (law 1, tip 2, chat 3) ont été rabaissées à la
        // main en production ; les laisser ici, c'était les voir remonter au
        // prochain passage du roster sur un compte recréé.
        postsPerWeek: 1,
      },
      update: {},
    });
  }

  // ── Pilotage depuis la console ─────────────────────────────

  async listBots() {
    return this.prisma.animationBot.findMany({
      orderBy: { handle: 'asc' },
      include: { user: { select: BOT_SELECT } },
    });
  }

  async updateBot(handle: string, dto: UpdateBotDto) {
    const bot = await this.prisma.animationBot.findUnique({ where: { handle } });
    if (!bot) throw new NotFoundException(`Compte d'animation inconnu : ${handle}`);
    return this.prisma.animationBot.update({ where: { handle }, data: dto });
  }

  /**
   * Conversations privées des comptes d'animation, pour contrôle. C'est
   * volontairement une vue admin complète : la seule façon de vérifier que ces
   * comptes se tiennent correctement est de pouvoir lire ce qu'ils écrivent.
   */
  async listConversations(handle?: string) {
    const bots = await this.prisma.animationBot.findMany({
      where: handle ? { handle } : {},
      select: { handle: true, userId: true },
    });
    if (bots.length === 0) return { items: [] };
    const byUserId = new Map(bots.map((b) => [b.userId, b.handle]));

    const rows = await this.prisma.conversation.findMany({
      where: { members: { some: { userId: { in: [...byUserId.keys()] } } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      select: {
        id: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        members: { select: { userId: true, user: { select: BOT_SELECT } } },
        _count: { select: { messages: true } },
      },
    });

    const items = rows.map((c) => {
      const botMember = c.members.find((m) => byUserId.has(m.userId));
      return {
        conversationId: c.id,
        handle: botMember ? byUserId.get(botMember.userId) : null,
        withMembers: c.members.filter((m) => !byUserId.has(m.userId)).map((m) => m.user),
        messageCount: c._count.messages,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
      };
    });
    return { items };
  }

  /** Le fil complet d'une conversation + l'état des réponses en attente. */
  async readConversation(conversationId: string) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        senderId: true,
        content: true,
        createdAt: true,
        sender: { select: { id: true, displayName: true, isAnimated: true } },
      },
    });
    const replies = await this.prisma.animationReply.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    return { messages, replies };
  }

  /**
   * L'atelier écrit le texte d'une réponse en attente. Il ne peut PAS toucher
   * à une conversation remontée : une fois qu'un membre a demandé à qui il
   * parle, seul le propriétaire répond.
   */
  async draftReply(id: string, draft: string) {
    const reply = await this.prisma.animationReply.findUnique({ where: { id } });
    if (!reply) throw new NotFoundException('Réponse introuvable');
    if (reply.status !== 'pending') {
      throw new BadRequestException(
        reply.status === 'escalated'
          ? 'Conversation remontée à la console : la réponse revient au propriétaire.'
          : `Déjà traitée (${reply.status})`,
      );
    }
    return this.prisma.animationReply.update({ where: { id }, data: { draft } });
  }

  /** Ce que la console montre en un coup d'œil : la file par état. */
  async stats(): Promise<Record<AnimationStatus, number> & { byKind: Record<AnimationKind, number> }> {
    const rows = await this.prisma.animationPost.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const kinds = await this.prisma.animationPost.groupBy({
      by: ['kind'],
      where: { status: 'draft' },
      _count: { _all: true },
    });
    const zero = { draft: 0, approved: 0, published: 0, rejected: 0 };
    const byStatus = rows.reduce(
      (acc, r) => ({ ...acc, [r.status]: r._count._all }),
      zero as Record<AnimationStatus, number>,
    );
    const byKind = kinds.reduce(
      (acc, r) => ({ ...acc, [r.kind]: r._count._all }),
      { law: 0, tip: 0, chat: 0 } as Record<AnimationKind, number>,
    );
    return { ...byStatus, byKind };
  }
}
