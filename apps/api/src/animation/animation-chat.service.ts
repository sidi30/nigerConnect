import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ChatService } from '../chat/chat.service';

/** Premier délai de réponse. Ensuite ça double : 5, 10, 20, 40, 80 min… */
const FIRST_DELAY_MS = 5 * 60 * 1000;
/**
 * …mais plafonné à 6 h. Non borné, la sixième réponse arriverait le lendemain
 * et la conversation mourrait : le mécanisme censé faire humain rendrait le
 * compte muet, ce qui est l'inverse du but.
 */
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
/**
 * Au-delà de 12 h sans échange, la conversation est considérée reprise à zéro
 * et le compteur repart à 5 min. Un humain qui revient le lendemain ne répond
 * pas plus lentement parce qu'il avait beaucoup écrit la veille.
 */
const CONVERSATION_RESET_MS = 12 * 60 * 60 * 1000;

/**
 * Marqueurs d'un membre qui cherche à savoir à qui il parle.
 *
 * Ils ne servent PAS à esquiver : dès qu'un seul correspond, le compte se tait
 * définitivement dans cette conversation et l'échange remonte à la console pour
 * que le propriétaire réponde lui-même. Construire l'esquive reviendrait à
 * tromper quelqu'un au moment précis où il pose la question — on ne le fait pas.
 */
const SUSPICION_PATTERNS: readonly RegExp[] = [
  /\bbots?\b/i,
  /\brobots?\b/i,
  /\bia\b|intelligence artificielle/i,
  /chat\s?gpt|claude|openai/i,
  /\bfaux?\s+(compte|profil)/i,
  /\bvraie?\s+(personne|humain|gens)\b/i,
  /\btu es (une |un )?(vrai|réel|humain|machine|programme)/i,
  /\bc'?est (un |une )?(automatique|automatisé|généré)/i,
  /\bautomatis[ée]/i,
];

export function looksLikeSuspicion(text: string | null): boolean {
  if (!text) return false;
  return SUSPICION_PATTERNS.some((re) => re.test(text));
}

/**
 * Conversations privées des comptes d'animation.
 *
 * Deux règles, et la seconde prime toujours :
 *   1. répondre avec un délai croissant, pour ne pas répondre à la seconde ;
 *   2. se taire et remonter à la console dès que le membre demande à qui il
 *      parle.
 */
@Injectable()
export class AnimationChatService {
  private readonly logger = new Logger(AnimationChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  /**
   * Repère les messages reçus par un compte d'animation et les met en file.
   *
   * Balayage plutôt que branchement dans ChatService : l'envoi de message est
   * le chemin le plus chaud de l'application, et une animation ne vaut pas le
   * risque d'y ajouter une écriture. Un retard de cinq minutes est ici sans
   * conséquence — on attend de toute façon.
   */
  async scanIncoming(now = new Date()): Promise<number> {
    const bots = await this.prisma.animationBot.findMany({
      where: { active: true },
      select: { id: true, userId: true },
    });
    if (bots.length === 0) return 0;
    const byUserId = new Map(bots.map((b) => [b.userId, b.id]));

    // Derniers messages reçus dans les conversations où siège un compte animé.
    const incoming = await this.prisma.message.findMany({
      where: {
        deletedAt: null,
        senderId: { notIn: [...byUserId.keys()] },
        createdAt: { gte: new Date(now.getTime() - CONVERSATION_RESET_MS) },
        conversation: { members: { some: { userId: { in: [...byUserId.keys()] } } } },
      },
      select: {
        id: true,
        conversationId: true,
        content: true,
        createdAt: true,
        conversation: { select: { members: { select: { userId: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    let queued = 0;
    for (const msg of incoming) {
      const botUserId = msg.conversation.members
        .map((m) => m.userId)
        .find((id) => byUserId.has(id));
      if (!botUserId) continue;
      const botId = byUserId.get(botUserId)!;

      // Cette conversation a-t-elle déjà été remontée ? Alors le compte s'y
      // tait pour de bon — on ne réarme jamais après une escalade.
      const escalated = await this.prisma.animationReply.count({
        where: { conversationId: msg.conversationId, status: 'escalated' },
      });
      if (escalated > 0) continue;

      const attempt = await this.prisma.animationReply.count({
        where: { conversationId: msg.conversationId, status: 'sent' },
      });

      const suspicious = looksLikeSuspicion(msg.content);
      try {
        await this.prisma.animationReply.create({
          data: {
            botId,
            conversationId: msg.conversationId,
            incomingMessageId: msg.id,
            // Le doublement, borné. attempt=0 → 5 min, 1 → 10, 2 → 20…
            dueAt: new Date(
              now.getTime() + Math.min(FIRST_DELAY_MS * 2 ** attempt, MAX_DELAY_MS),
            ),
            attempt,
            status: suspicious ? 'escalated' : 'pending',
            escalationReason: suspicious
              ? "Le membre demande s'il parle à une personne réelle — réponse laissée au propriétaire."
              : null,
          },
        });
        queued += 1;
      } catch {
        // Unicité sur incoming_message_id : déjà en file, rien à faire.
      }
    }
    if (queued > 0) this.logger.log(`Animation : ${queued} message(s) mis en file`);
    return queued;
  }

  /**
   * Envoie les réponses dont l'heure est venue ET dont l'atelier a écrit le
   * texte. Une réponse sans brouillon reste en attente : le serveur ne fabrique
   * pas de contenu, il ne fait que le poster à l'heure dite.
   */
  async sendDue(now = new Date()): Promise<number> {
    const due = await this.prisma.animationReply.findMany({
      where: { status: 'pending', dueAt: { lte: now }, draft: { not: null } },
      include: { bot: { select: { userId: true, active: true } } },
      orderBy: { dueAt: 'asc' },
      take: 20,
    });

    let sent = 0;
    for (const reply of due) {
      if (!reply.bot.active) {
        await this.prisma.animationReply.update({
          where: { id: reply.id },
          data: { status: 'skipped' },
        });
        continue;
      }
      try {
        const { message } = await this.chat.sendMessage(reply.bot.userId, reply.conversationId, {
          content: reply.draft!,
          messageType: 'text',
        });
        await this.prisma.animationReply.update({
          where: { id: reply.id },
          data: { status: 'sent', sentMessageId: message.id },
        });
        sent += 1;
      } catch (error) {
        this.logger.error(`Réponse d'animation ${reply.id} échouée : ${String(error)}`);
        await this.prisma.animationReply.update({
          where: { id: reply.id },
          data: { status: 'skipped' },
        });
      }
    }
    return sent;
  }

  /** Conversations remontées à la console, en attente d'une réponse humaine. */
  async listEscalated(limit = 50) {
    return this.prisma.animationReply.findMany({
      where: { status: 'escalated' },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { bot: { select: { handle: true, userId: true } } },
    });
  }
}
