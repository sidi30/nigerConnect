import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AnimationBot } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { looksLikeSuspicion } from './animation-chat.service';
import { ROSTER } from './roster';

/**
 * Longueur maximale d'un brouillon. Un message de quarante lignes dans une
 * conversation privée ne ressemble à personne : les vraies réponses sur la
 * plateforme font une à trois phrases.
 */
const MAX_DRAFT_CHARS = 320;

/** Le modèle tourne sur le CPU du VPS ; au-delà, on abandonne ce tour. */
const TIMEOUT_MS = 45_000;

/**
 * Brouillons produits par balayage. Le VPS est partagé avec une douzaine de
 * projets sans rapport : borner le nombre d'appels borne le temps CPU qu'on
 * leur prend.
 */
const MAX_PER_RUN = 6;

/**
 * Retard à partir duquel ce service prend la main.
 *
 * Ce rédacteur est un FILET, pas le rédacteur principal. L'atelier tourne sur
 * le poste du propriétaire toutes les trente minutes : il écrit mieux, et il
 * vérifie l'actualité avant de parler d'un changement de règle — un modèle de
 * trois milliards de paramètres ne sait faire ni l'un ni l'autre.
 *
 * Quarante-cinq minutes laissent donc passer un cycle d'atelier complet plus
 * une marge. Au-delà, c'est que le poste est éteint ou que la tâche a échoué :
 * mieux vaut une réponse correcte qu'un membre laissé sans réponse une journée,
 * ce qui est exactement ce qui s'est produit le 19/08/2026.
 */
const FALLBACK_AFTER_MS = 45 * 60 * 1000;

/**
 * Motifs qu'un brouillon ne doit jamais contenir.
 *
 * Ce ne sont pas des préférences de style : chacun correspond à une promesse
 * qu'un compte d'animation ne pourra pas tenir. Donner un numéro, proposer un
 * rendez-vous ou entrer dans un registre amoureux avec quelqu'un qui croit
 * parler à une personne, c'est lui nuire. Le brouillon est jeté et la
 * conversation remonte au propriétaire.
 */
const APO = String.raw`['’]`;

const FORBIDDEN: readonly { re: RegExp; why: string }[] = [
  {
    re: /\b(?:0[1-9]|\+\d{2})[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}\b/,
    why: 'numéro de téléphone',
  },
  { re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, why: 'adresse e-mail' },
  {
    re: /\b(?:whatsapp|telegram|snap(?:chat)?|instagram|messenger|tiktok)\b/i,
    why: 'renvoi vers une autre messagerie',
  },
  {
    re: /\bon (?:se )?(?:voit|retrouve|rencontre)\b|\brendez[- ]vous\b|\bje (?:viens|passe) te voir\b/i,
    why: 'rendez-vous physique',
  },
  {
    re: new RegExp(
      `\\bje t(?:${APO}|e )(?:aime|adore)\\b|\\bmon (?:amour|c(?:œ|oe)ur|ch(?:é|e)ri)\\b|\\bb(?:é|e)b(?:é|e)\\b`,
      'i',
    ),
    why: 'registre amoureux',
  },
  {
    re: new RegExp(
      `\\b(?:envoie|envoies|donne)[- ]moi (?:de l${APO}argent|des sous|ton (?:rib|iban))\\b`,
      'i',
    ),
    why: 'sollicitation argent',
  },
  {
    re: /\bje (?:suis|serai) (?:une |un )?(?:ia|intelligence artificielle|bot|robot|assistant)\b/i,
    why: 'auto-désignation',
  },
];

/** Ville de chaque compte, par handle — même source que la création des comptes. */
const CITY_BY_HANDLE = new Map(ROSTER.map((e) => [e.handle, `${e.city} (${e.countryCode})`]));

/** Réponse d'un serveur compatible OpenAI — c'est le contrat de llama.cpp. */
interface CompletionChoice {
  message?: { content?: string };
}

/**
 * Rédacteur de SECOURS des comptes d'animation.
 *
 * L'atelier sur le poste du propriétaire reste le rédacteur principal : il
 * écrit mieux et vérifie l'actualité. Ce service ne prend la main que sur ce
 * qu'il a laissé passer depuis plus de 45 minutes — poste éteint, tâche
 * planifiée en échec, réseau coupé. C'est la panne du 19/08/2026, où des
 * membres sont restés vingt-quatre heures sans réponse sans que rien n'alerte.
 *
 * Le modèle tourne EN LOCAL, dans un conteneur du même hôte : aucun message
 * privé de membre ne sort du serveur, et il n'y a pas d'abonnement à payer.
 *
 * Ce service n'envoie rien. Il écrit `draft`, et rien d'autre ; ce sont
 * toujours `AnimationChatService.sendDue` et `AnimationEngagementService`
 * `.execute` qui postent, à l'heure prévue, sous les mêmes règles qu'avant.
 * Un brouillon refusé laisse la ligne sans texte — état strictement identique
 * à « l'atelier n'est pas passé ». Le pire cas du rédacteur est donc l'état
 * d'avant le rédacteur, jamais pire.
 */
@Injectable()
export class AnimationWriterService {
  private readonly logger = new Logger(AnimationWriterService.name);
  private readonly baseUrl: string | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // Variable absente = rédacteur éteint. C'est ce qui garde les tests et le
    // poste de développement inertes sans conditionner sur NODE_ENV.
    this.baseUrl = config.get<string>('ANIMATION_LLM_URL')?.replace(/\/+$/, '') || null;
  }

  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  /** Remplit les brouillons manquants : réponses privées, puis commentaires. */
  async fillDrafts(now = new Date()): Promise<number> {
    if (!this.baseUrl) return 0;
    let written = 0;
    try {
      written += await this.fillReplies(now);
      written += await this.fillComments(now);
    } catch (error) {
      // Modèle éteint, en cours de chargement, saturé : ce n'est pas une panne
      // de la plateforme. La file attend simplement le balayage suivant.
      this.logger.warn(`Rédacteur indisponible : ${String(error).slice(0, 200)}`);
    }
    if (written > 0) this.logger.log(`Animation : ${written} brouillon(s) rédigé(s)`);
    return written;
  }

  // ── Réponses privées ───────────────────────────────────────

  private async fillReplies(now: Date): Promise<number> {
    // Seulement ce qui est EN RETARD. Une ligne due il y a moins de 45 min est
    // encore du ressort de l'atelier, qui écrira mieux ; on ne lui coupe pas
    // l'herbe sous le pied.
    const pending = await this.prisma.animationReply.findMany({
      where: {
        status: 'pending',
        draft: null,
        dueAt: { lte: new Date(now.getTime() - FALLBACK_AFTER_MS) },
      },
      include: { bot: true },
      orderBy: { dueAt: 'asc' },
      take: MAX_PER_RUN,
    });

    let written = 0;
    for (const reply of pending) {
      // Deux réponses en attente sur le MÊME fil : une seule est rédigée. Deux
      // messages d'affilée du même compte à la même minute ne ressemblent à
      // personne, et le second répondrait à un message déjà couvert.
      const sibling = await this.prisma.animationReply.count({
        where: {
          conversationId: reply.conversationId,
          status: 'pending',
          draft: { not: null },
          id: { not: reply.id },
        },
      });
      if (sibling > 0) {
        await this.prisma.animationReply.update({
          where: { id: reply.id },
          data: { status: 'skipped' },
        });
        continue;
      }

      const messages = await this.prisma.message.findMany({
        where: { conversationId: reply.conversationId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { content: true, sender: { select: { displayName: true, isAnimated: true } } },
      });

      // La suspicion peut être arrivée APRÈS la mise en file : on relit tout le
      // fil, pas seulement le message déclencheur.
      const suspect = messages.some((m) => !m.sender.isAnimated && looksLikeSuspicion(m.content));
      if (suspect) {
        await this.escalateReply(reply.id, "Le membre demande s'il parle à une personne réelle.");
        continue;
      }

      const verdict = this.vet(await this.generate(this.replyPrompt(reply.bot, messages)));
      if (!verdict.ok) {
        // Une réponse privée refusée n'est pas écartée en silence : quelqu'un
        // attend un message. Elle revient au propriétaire.
        await this.escalateReply(reply.id, `Brouillon refusé (${verdict.why})`);
        continue;
      }
      await this.prisma.animationReply.update({
        where: { id: reply.id },
        data: { draft: verdict.text },
      });
      written += 1;
    }
    return written;
  }

  private async escalateReply(id: string, reason: string): Promise<void> {
    await this.prisma.animationReply.update({
      where: { id },
      data: { status: 'escalated', escalationReason: reason },
    });
  }

  // ── Commentaires ───────────────────────────────────────────

  private async fillComments(now: Date): Promise<number> {
    const pending = await this.prisma.animationAction.findMany({
      where: {
        type: 'comment',
        status: 'pending',
        draft: null,
        dueAt: { lte: new Date(now.getTime() - FALLBACK_AFTER_MS) },
      },
      include: { bot: true },
      orderBy: { dueAt: 'asc' },
      take: MAX_PER_RUN,
    });

    let written = 0;
    for (const action of pending) {
      const post = action.targetPostId
        ? await this.prisma.post.findUnique({
            where: { id: action.targetPostId },
            select: { content: true, deletedAt: true },
          })
        : null;
      // Publication supprimée, ou sans texte (photo seule) : il n'y a rien à
      // commenter. Écrire « superbe ! » sous une image qu'on n'a pas vue est le
      // commentaire de robot par excellence.
      if (!post || post.deletedAt || !post.content?.trim()) {
        await this.skipAction(action.id, 'publication sans texte à commenter');
        continue;
      }

      const verdict = this.vet(await this.generate(this.commentPrompt(action.bot, post.content)));
      if (!verdict.ok) {
        // Un commentaire, personne ne l'attend : l'écarter suffit.
        await this.skipAction(action.id, `brouillon refusé (${verdict.why})`);
        continue;
      }
      await this.prisma.animationAction.update({
        where: { id: action.id },
        data: { draft: verdict.text },
      });
      written += 1;
    }
    return written;
  }

  private async skipAction(id: string, reason: string): Promise<void> {
    await this.prisma.animationAction.update({
      where: { id },
      data: { status: 'skipped', skipReason: reason.slice(0, 200) },
    });
  }

  // ── Consignes ──────────────────────────────────────────────

  /**
   * Le personnage, puis les interdits.
   *
   * Les interdits sont répétés côté code dans `vet()`, et c'est volontaire : un
   * modèle de trois milliards de paramètres oublie une consigne de temps en
   * temps, et on ne veut pas que cette fois-là parte à un membre.
   */
  private persona(bot: AnimationBot): string {
    const city = CITY_BY_HANDLE.get(bot.handle) ?? 'une ville de la diaspora';
    const role =
      bot.kind === 'law'
        ? "Tu parles démarches et papiers, mais tu ne donnes JAMAIS de règle juridique précise ni de délai chiffré : tu racontes ton expérience et tu renvoies vers la préfecture, le consulat ou le service compétent."
        : bot.kind === 'tip'
          ? 'Tu partages des astuces concrètes du quotidien : logement, transport, budget, envois au pays.'
          : 'Tu discutes simplement, comme avec quelqu’un de la communauté.';
    return [
      `Tu es un membre de la diaspora nigérienne installé à ${city}.`,
      role,
      'Tu écris en français simple et chaleureux, comme sur WhatsApp. Une à trois phrases, jamais plus.',
      'Interdits absolus : donner un numéro ou un e-mail, renvoyer vers un autre réseau, proposer ou accepter de se voir en vrai, entrer dans un registre amoureux, parler d’argent à envoyer, ou dire ce que tu es.',
      'Si le message reçu appelle une de ces choses, décline poliment et ramène la conversation sur la communauté.',
      'N’écris QUE le message lui-même : pas de guillemets, pas de préambule, pas de signature.',
    ].join(' ');
  }

  private replyPrompt(
    bot: AnimationBot,
    messages: {
      content: string | null;
      sender: { displayName: string | null; isAnimated: boolean };
    }[],
  ): { system: string; user: string } {
    const thread = messages
      .map(
        (m) =>
          `${m.sender.isAnimated ? 'TOI' : (m.sender.displayName ?? 'Un membre')} : ${m.content ?? '(média)'}`,
      )
      .join('\n');
    return {
      system: this.persona(bot),
      user: `Conversation privée :\n${thread}\n\nÉcris ta réponse au dernier message.`,
    };
  }

  private commentPrompt(bot: AnimationBot, postContent: string): { system: string; user: string } {
    return {
      system: this.persona(bot),
      user: `Publication d’un membre :\n"${postContent.slice(0, 800)}"\n\nÉcris un commentaire court et utile sous cette publication.`,
    };
  }

  // ── Appel du modèle ────────────────────────────────────────

  private async generate(prompt: { system: string; user: string }): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          // Assez chaud pour que vingt-cinq comptes n'ouvrent pas tous par la
          // même phrase, assez froid pour rester dans les consignes.
          temperature: 0.8,
          top_p: 0.9,
          max_tokens: 120,
        }),
      });
      if (!res.ok) throw new Error(`modèle HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: CompletionChoice[] };
      return body.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Contrôle du brouillon ──────────────────────────────────

  /**
   * Dernier filtre avant la base.
   *
   * Tout ce qui n'est pas franchement bon est refusé : une ligne sans brouillon
   * ne fait rien, alors qu'un mauvais message part chez un membre et ne se
   * rattrape pas. Le doute joue donc toujours contre l'envoi.
   */
  vet(raw: string): { ok: true; text: string } | { ok: false; why: string } {
    // Le modèle encadre parfois sa réponse de guillemets, ou la préfixe.
    let text = raw.trim().replace(/^["'«»\s]+|["'«»\s]+$/g, '');
    text = text.replace(/^(?:TOI|Réponse|Commentaire)\s*:\s*/i, '').trim();

    if (text.length < 2) return { ok: false, why: 'réponse vide' };
    if (text.length > MAX_DRAFT_CHARS) return { ok: false, why: 'réponse trop longue' };
    if (/\n\s*\n/.test(text)) return { ok: false, why: 'plusieurs paragraphes' };
    // Le modèle qui récite la consigne au lieu d'y obéir.
    if (/\b(?:en tant qu|je suis un mod(?:è|e)le|instructions?)\b/i.test(text)) {
      return { ok: false, why: 'le modèle récite ses consignes' };
    }
    // Les motifs précis d'abord : ils nomment ce qui s'est passé, alors que le
    // filet générique juste en dessous dirait seulement « parle de bots ».
    for (const { re, why } of FORBIDDEN) {
      if (re.test(text)) return { ok: false, why };
    }
    // Le brouillon qui parle lui-même de bots relance exactement le soupçon
    // qu'on escalade ailleurs.
    if (looksLikeSuspicion(text)) return { ok: false, why: 'le brouillon parle de bots ou d’IA' };
    return { ok: true, text };
  }
}
