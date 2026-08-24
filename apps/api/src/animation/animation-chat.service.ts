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
 *
 * Ce délai a longtemps servi à AUTRE CHOSE que ce qu'il annonce : il filtrait
 * les messages visibles par le balayage. Un message vieux de plus de 12 h
 * n'était donc jamais mis en file — il n'était pas répondu en retard, il
 * n'était jamais répondu. Et le compteur, lui, ne repartait jamais de zéro :
 * il comptait toutes les réponses envoyées depuis toujours, si bien qu'une
 * conversation vivante finissait plafonnée à 6 h d'attente. Les deux défauts
 * se combinaient en « les comptes ne répondent pas ».
 */
const CONVERSATION_RESET_MS = 12 * 60 * 60 * 1000;

/**
 * Garde-fou de fin de course : on ne ressuscite pas un fil abandonné depuis un
 * mois. Répondre à un message vieux de six semaines est plus déroutant pour le
 * membre que ne pas répondre du tout.
 */
const ABANDONED_MS = 30 * 24 * 60 * 60 * 1000;

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
 * Avances sexuelles et insultes adressées à un compte d'animation.
 *
 * Le compte se tait, définitivement, et la ligne est classée `skipped` avec sa
 * raison. Trois façons de mal faire, écartées :
 *   - répondre, même poliment : ça entretient un lien avec quelqu'un qui n'existe
 *     pas, exactement là où c'est le plus abîmant ;
 *   - `escalated` : ce statut veut dire « le membre demande à qui il parle, le
 *     propriétaire reprend la main ». Ici personne ne reprend rien ;
 *   - ne rien poser en base : la ligne reviendrait au balayage suivant.
 *
 * Volontairement étroit. Un faux positif coûte un silence — un faux négatif
 * fait draguer un compte fabriqué.
 */
const HARASSMENT_PATTERNS: readonly RegExp[] = [
  /\bt(u es|'?es|es)\s+(trop\s+)?(sexy|bonne|bonnasse|chaude)\b/i,
  /\bje te (veux|kiffe|baise)\b/i,
  /\b(envoie|montre)[- ]?(moi)?\s+(une?\s+)?(photo|image)s?\s+(nue?|sans|intime)/i,
  /\bnudes?\b/i,
  /\b(tes|ton|ta)\s+(seins?|fesses?|corps|cul)\b/i,
  /\bon (baise|couche)\b|\bcouche[rz]? avec (moi|toi)\b/i,
  /\b(pute|putain de toi|salope|connasse|connard|batard|bâtard)\b/i,
  /\bferme ta gueule\b|\bva te faire\b/i,
];

export function looksLikeHarassment(text: string | null): boolean {
  if (!text) return false;
  return HARASSMENT_PATTERNS.some((re) => re.test(text));
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

    // On raisonne par CONVERSATION, pas par message. Ce qui décide qu'un
    // compte doit une réponse n'est pas qu'un message soit récent : c'est que
    // le membre ait le dernier mot et attende. Filtrer sur l'âge du message
    // laissait tomber pour de bon tout ce qui dépassait la fenêtre.
    const botUserIds = [...byUserId.keys()];
    const conversations = await this.prisma.conversation.findMany({
      where: {
        members: { some: { userId: { in: botUserIds } } },
        lastMessageAt: { gte: new Date(now.getTime() - ABANDONED_MS) },
      },
      select: {
        id: true,
        members: { select: { userId: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, senderId: true, content: true, createdAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 500,
    });

    let queued = 0;
    let skipped = 0;
    for (const conversation of conversations) {
      const msg = conversation.messages[0];
      // Le compte a le dernier mot : il n'attend rien, il a déjà répondu.
      if (!msg || byUserId.has(msg.senderId)) continue;

      const botUserId = conversation.members
        .map((m) => m.userId)
        .find((id) => byUserId.has(id));
      if (!botUserId) continue;
      const botId = byUserId.get(botUserId)!;

      // Cette conversation a-t-elle déjà été remontée ? Alors le compte s'y
      // tait pour de bon — on ne réarme jamais après une escalade.
      const escalated = await this.prisma.animationReply.count({
        where: { conversationId: conversation.id, status: 'escalated' },
      });
      if (escalated > 0) continue;

      // Une conversation, une réponse en attente à la fois. Quelqu'un qui
      // écrit trois messages d'affilée n'appelle pas trois réponses : il en
      // appelle une, qui tiendra compte de tout ce qu'il vient d'écrire.
      // L'unicité porte sur `incomingMessageId`, donc elle ne protégeait de
      // rien ici — trois messages, trois identifiants, trois lignes, et le
      // compte répondait trois fois de suite. Rien ne trahit plus vite un
      // compte fabriqué.
      const alreadyWaiting = await this.prisma.animationReply.count({
        where: { conversationId: conversation.id, status: 'pending' },
      });
      if (alreadyWaiting > 0) continue;

      // Le délai croissant ne compte QUE l'échange en cours. Compté depuis
      // toujours, il ne redescendait jamais : un membre fidèle finissait par
      // attendre le plafond de 6 h à chaque message, pour avoir trop parlé la
      // semaine d'avant. C'est ce que le commentaire de CONVERSATION_RESET_MS
      // décrivait déjà — le code, lui, ne le faisait pas.
      const attempt = await this.prisma.animationReply.count({
        where: {
          conversationId: conversation.id,
          status: 'sent',
          updatedAt: { gte: new Date(now.getTime() - CONVERSATION_RESET_MS) },
        },
      });

      const suspicious = looksLikeSuspicion(msg.content);
      const harassing = !suspicious && looksLikeHarassment(msg.content);
      try {
        await this.prisma.animationReply.create({
          data: {
            botId,
            conversationId: conversation.id,
            incomingMessageId: msg.id,
            // Le doublement, borné. attempt=0 → 5 min, 1 → 10, 2 → 20…
            dueAt: new Date(
              now.getTime() + Math.min(FIRST_DELAY_MS * 2 ** attempt, MAX_DELAY_MS),
            ),
            attempt,
            status: suspicious ? 'escalated' : harassing ? 'skipped' : 'pending',
            escalationReason: suspicious
              ? "Le membre demande s'il parle à une personne réelle — réponse laissée au propriétaire."
              : harassing
                ? 'Avance ou insulte adressée au compte — silence assumé, aucune réponse rédigée.'
                : null,
          },
        });
        if (harassing) skipped += 1;
        else queued += 1;
      } catch {
        // Unicité sur incoming_message_id : déjà en file, rien à faire.
      }
    }
    if (queued > 0) this.logger.log(`Animation : ${queued} message(s) mis en file`);
    if (skipped > 0) {
      this.logger.log(`Animation : ${skipped} message(s) laisse(s) sans reponse (avance ou insulte)`);
    }
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
    // Deuxième filet, indispensable pour deux raisons : les lignes déjà en base
    // avant le garde-fou ci-dessus, et le cas où deux d'entre elles arrivent à
    // échéance dans la même passe.
    const answered = new Set<string>();
    for (const reply of due) {
      if (answered.has(reply.conversationId)) {
        await this.absorb(reply.id);
        continue;
      }
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
        answered.add(reply.conversationId);
        // Les sœurs de cette conversation sont désormais sans objet : la
        // réponse qui vient de partir répond à tout le fil. Les laisser en
        // attente, c'est promettre un deuxième message.
        const absorbed = await this.prisma.animationReply.updateMany({
          where: {
            conversationId: reply.conversationId,
            status: 'pending',
            id: { not: reply.id },
          },
          data: { status: 'skipped' },
        });
        if (absorbed.count > 0) {
          this.logger.log(
            `Animation : ${absorbed.count} réponse(s) en double absorbée(s) dans la conversation ${reply.conversationId}`,
          );
        }
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

  /** Écarte une réponse devenue sans objet. */
  private async absorb(id: string): Promise<void> {
    await this.prisma.animationReply.update({ where: { id }, data: { status: 'skipped' } });
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
