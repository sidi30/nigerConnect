import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AnimationBot } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LikesService } from '../feed/likes.service';
import { CommentsService } from '../feed/comments.service';
import { FriendsService } from '../social/friends.service';
import { DiasporaPolicyService } from '../social/diaspora-policy.service';

/** Fenêtre de publications candidates : au-delà, réagir fait déterrer un vieux post. */
const CANDIDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Gestes exécutés par balayage, tous comptes confondus — plafond de sécurité. */
const MAX_ACTIONS_PER_RUN = 30;

/**
 * L'heure `hour` tombe-t-elle dans la fenêtre [from, to[ ?
 *
 * Extrait en fonction pure parce que le cas qui casse est celui de la fenêtre à
 * cheval sur minuit (22 h → 6 h) : la comparaison naïve `h >= from && h < to`
 * y est vide, et le compte ne ferait plus jamais rien.
 */
export function isInActiveWindow(from: number, to: number, hour: number): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * Engagement des comptes d'animation : likes, commentaires, demandes d'ami.
 *
 * Deux temps séparés, et c'est le point important :
 *   - `plan()` CHOISIT les cibles et leur donne une heure, étalée dans la
 *     fenêtre d'activité locale du compte ;
 *   - `execute()` exécute ce qui est dû.
 *
 * Sans cette séparation, tout partirait en rafale à la seconde du balayage —
 * quinze likes à 3 h 12 du matin, tous à la même minute, c'est exactement ce
 * qui se remarque.
 *
 * Rien n'est écrit en direct dans Prisma : on passe par LikesService,
 * CommentsService et FriendsService, donc on hérite des contrôles de visibilité,
 * des blocages, des notifications et des compteurs. Réécrire ces INSERT ferait
 * des gestes invisibles pour le destinataire.
 */
@Injectable()
export class AnimationEngagementService {
  private readonly logger = new Logger(AnimationEngagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly likes: LikesService,
    private readonly comments: CommentsService,
    private readonly friends: FriendsService,
    private readonly diaspora: DiasporaPolicyService,
  ) {}

  /** Minuit local du compte — base des quotas journaliers. */
  private startOfDay(now: Date): Date {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Le compte est-il dans sa fenêtre d'activité ? Personne ne like à 4 h. */
  private inActiveWindow(bot: AnimationBot, now: Date): boolean {
    return isInActiveWindow(bot.activeFromHour, bot.activeToHour, now.getHours());
  }

  /**
   * Combien de gestes de ce type ce compte a-t-il DÉJÀ programmés aujourd'hui ?
   *
   * On compte les lignes programmées, pas les gestes exécutés : sinon deux
   * balayages successifs replanifieraient la même journée avant que le premier
   * lot ne soit parti, et le quota sauterait.
   */
  private async plannedToday(botId: string, type: 'like' | 'comment' | 'friend_request', now: Date) {
    return this.prisma.animationAction.count({
      where: { botId, type, createdAt: { gte: this.startOfDay(now) } },
    });
  }

  /**
   * Programme les gestes du jour pour chaque compte actif.
   *
   * Les cibles sont prises dans la portée diaspora du compte — un compte à Paris
   * réagit à ce qu'un membre à Paris peut voir, pas à autre chose. Les contenus
   * des autres comptes d'animation sont exclus : des comptes qui se likent entre
   * eux, ça ne trompe personne et ça n'apporte rien à un vrai membre.
   */
  async plan(now = new Date()): Promise<number> {
    const bots = await this.prisma.animationBot.findMany({ where: { active: true } });
    let planned = 0;

    for (const bot of bots) {
      if (!this.inActiveWindow(bot, now)) continue;

      const scope = await this.diaspora.authorScope(bot.userId);
      const posts = await this.prisma.post.findMany({
        where: {
          deletedAt: null,
          isStory: false,
          visibility: 'public',
          createdAt: { gte: new Date(now.getTime() - CANDIDATE_WINDOW_MS) },
          authorId: { not: bot.userId },
          // Jamais entre comptes d'animation.
          author: { isAnimated: false, ...(scope ?? {}) },
        },
        select: { id: true, authorId: true },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });
      if (posts.length === 0) continue;

      planned += await this.planType(bot, 'like', bot.likesPerDay, now, posts.map((p) => p.id));
      planned += await this.planType(bot, 'comment', bot.commentsPerDay, now, posts.map((p) => p.id));

      // Demandes d'ami : vers les AUTEURS croisés, pas au hasard — on sollicite
      // quelqu'un dont on vient de lire quelque chose, ce qui est le seul motif
      // plausible. La règle diaspora est réinterrogée pour chaque cible : un
      // compte au Niger n'a pas le droit d'initier vers la diaspora.
      const authors = [...new Set(posts.map((p) => p.authorId))];
      const already = await this.plannedToday(bot.id, 'friend_request', now);
      let quota = bot.friendReqPerDay - already;
      for (const targetUserId of authors) {
        if (quota <= 0) break;
        if (!(await this.diaspora.mayInitiateContact(bot.userId, targetUserId))) continue;
        const exists = await this.prisma.friendship.count({
          where: {
            OR: [
              { requesterId: bot.userId, addresseeId: targetUserId },
              { requesterId: targetUserId, addresseeId: bot.userId },
            ],
          },
        });
        if (exists > 0) continue;
        if (await this.enqueue(bot, 'friend_request', { targetUserId }, now)) {
          planned += 1;
          quota -= 1;
        }
      }
    }

    if (planned > 0) this.logger.log(`Animation : ${planned} geste(s) programmé(s)`);
    return planned;
  }

  private async planType(
    bot: AnimationBot,
    type: 'like' | 'comment',
    perDay: number,
    now: Date,
    postIds: string[],
  ): Promise<number> {
    let quota = perDay - (await this.plannedToday(bot.id, type, now));
    if (quota <= 0) return 0;

    let planned = 0;
    for (const targetPostId of postIds) {
      if (quota <= 0) break;
      if (await this.enqueue(bot, type, { targetPostId }, now)) {
        planned += 1;
        quota -= 1;
      }
    }
    return planned;
  }

  /**
   * Pose une action à une heure étalée. L'unicité en base fait le dédoublonnage
   * (même compte, même type, même cible) : on tente l'insertion et on laisse la
   * contrainte refuser, plutôt que de lire avant d'écrire — ce qui laisserait
   * une fenêtre entre la lecture et l'écriture.
   */
  private async enqueue(
    bot: AnimationBot,
    type: 'like' | 'comment' | 'friend_request',
    target: { targetPostId?: string; targetUserId?: string },
    now: Date,
  ): Promise<boolean> {
    // Étalement : entre 5 min et ~3 h après le balayage, dérivé de l'identifiant
    // de la cible pour rester stable si le balayage rejoue.
    const key = target.targetPostId ?? target.targetUserId ?? '';
    const spread = [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 175;
    try {
      await this.prisma.animationAction.create({
        data: {
          botId: bot.id,
          type,
          targetPostId: target.targetPostId ?? null,
          targetUserId: target.targetUserId ?? null,
          dueAt: new Date(now.getTime() + (5 + spread) * 60 * 1000),
        },
      });
      return true;
    } catch {
      // Déjà programmé pour cette cible — c'est le comportement voulu.
      return false;
    }
  }

  /**
   * Exécute les gestes dus. Un commentaire sans texte reste en attente : le
   * serveur ne fabrique pas de contenu, l'atelier écrit, le serveur poste.
   */
  async execute(now = new Date()): Promise<{ done: number; skipped: number }> {
    const due = await this.prisma.animationAction.findMany({
      where: {
        status: 'pending',
        dueAt: { lte: now },
        OR: [{ type: { in: ['like', 'friend_request'] } }, { draft: { not: null } }],
      },
      include: { bot: true },
      orderBy: { dueAt: 'asc' },
      take: MAX_ACTIONS_PER_RUN,
    });

    let done = 0;
    let skipped = 0;
    for (const action of due) {
      if (!action.bot.active) {
        await this.skip(action.id, 'compte désactivé');
        skipped += 1;
        continue;
      }
      try {
        if (action.type === 'like' && action.targetPostId) {
          await this.likes.toggleLike(action.bot.userId, action.targetPostId);
        } else if (action.type === 'comment' && action.targetPostId && action.draft) {
          await this.comments.create(action.bot.userId, action.targetPostId, action.draft);
        } else if (action.type === 'friend_request' && action.targetUserId) {
          await this.friends.sendRequest(action.bot.userId, action.targetUserId);
        } else {
          await this.skip(action.id, 'cible incomplète');
          skipped += 1;
          continue;
        }
        await this.prisma.animationAction.update({
          where: { id: action.id },
          data: { status: 'done', doneAt: new Date() },
        });
        done += 1;
      } catch (error) {
        // Post supprimé, blocage, règle diaspora, demande déjà existante : ce
        // sont des refus légitimes des services métier, pas des pannes. On
        // écarte le geste et on garde la raison pour la console.
        await this.skip(action.id, String(error).slice(0, 200));
        skipped += 1;
      }
    }
    if (done > 0) this.logger.log(`Animation : ${done} geste(s) exécuté(s), ${skipped} écarté(s)`);
    return { done, skipped };
  }

  private async skip(id: string, reason: string): Promise<void> {
    await this.prisma.animationAction.update({
      where: { id },
      data: { status: 'skipped', skipReason: reason },
    });
  }

  /**
   * L'atelier écrit le texte d'un commentaire programmé. Refusé si le geste est
   * déjà parti ou écarté : on ne réécrit pas un commentaire publié.
   */
  async draftComment(id: string, draft: string) {
    const action = await this.prisma.animationAction.findUnique({ where: { id } });
    if (!action) throw new NotFoundException('Geste introuvable');
    if (action.type !== 'comment') {
      throw new BadRequestException('Seul un commentaire prend un texte');
    }
    if (action.status !== 'pending') {
      throw new BadRequestException(`Déjà traité (${action.status})`);
    }
    return this.prisma.animationAction.update({ where: { id }, data: { draft } });
  }

  /** Gestes en attente de texte — ce que l'atelier doit rédiger. */
  async pendingComments(limit = 50) {
    return this.prisma.animationAction.findMany({
      where: { type: 'comment', status: 'pending', draft: null },
      take: limit,
      orderBy: { dueAt: 'asc' },
      include: { bot: { select: { handle: true } } },
    });
  }
}
