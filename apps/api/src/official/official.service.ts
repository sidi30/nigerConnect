import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';
import { SettingsService } from '../common/settings/settings.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';
import { PostsService } from '../feed/posts.service';
import { NotificationService } from '../notification/notification.service';
import { DiasporaPolicyService } from '../social/diaspora-policy.service';
import type {
  BroadcastNotificationDto,
  OfficialDirectMessageDto,
  OfficialMessageDto,
  OfficialPostDto,
  OfficialStoryDto,
  OfficialUploadDto,
  UpdateOfficialDto,
} from './dto/official.dto';

/** Clé du réglage qui épingle l'identifiant du compte officiel. */
const OFFICIAL_ID_SETTING = 'official_account_id';
/** Nom par défaut à la création — modifiable ensuite depuis la console. */
const DEFAULT_DISPLAY_NAME = 'NigerConnect';
/** Destinataires traités par lot, comme le dispatcher newsletter. */
const BATCH_SIZE = 50;
/** Respiration entre deux lots : la fan-out push ne doit pas noyer l'API. */
const BATCH_DELAY_MS = 500;
/** Une annonce s'efface au bout de deux semaines ; une critique, jamais. */
const ANNOUNCEMENT_TTL_HOURS = 24 * 14;

/** Colonnes du compte officiel renvoyées à la console. */
const ACCOUNT_SELECT = {
  id: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  coverUrl: true,
  isOfficial: true,
  officialSince: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

/**
 * Compte officiel NigerConnect — la voix de l'application.
 *
 * Ce n'est pas un membre : il est absent de la recherche, des suggestions, de
 * la carte et de la proximité, personne ne peut lui envoyer de demande d'ami ni
 * ouvrir une conversation avec lui. En échange, c'est le seul compte qui parle
 * à toute la communauté d'un coup : notification, message direct, story et
 * publication publique — et son badge doit valoir garantie, donc rien ici n'est
 * accessible en dehors de la console admin (`@Roles('admin')` au contrôleur).
 *
 * Tout ce qu'il publie repose sur les services existants (PostsService,
 * ChatService) plutôt que sur des écritures directes : c'est ce qui garantit
 * que ses messages arrivent avec le badge non-lu, le push et le socket temps
 * réel exactement comme un message d'un membre.
 */
@Injectable()
export class OfficialService {
  private readonly logger = new Logger(OfficialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly posts: PostsService,
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
    private readonly diaspora: DiasporaPolicyService,
  ) {}

  // ── Le compte ────────────────────────────────────────────────────────────

  /**
   * Identifiant du compte officiel, créé au premier appel. L'id est épinglé
   * dans AppSetting : si un jour un second compte portait le drapeau, la console
   * continuerait de piloter celui-ci et non « le premier trouvé ».
   */
  async ensureAccountId(): Promise<string> {
    const pinned = await this.settings.getSetting(OFFICIAL_ID_SETTING, '');
    if (pinned) {
      const exists = await this.prisma.user.findFirst({
        where: { id: pinned, isOfficial: true },
        select: { id: true },
      });
      if (exists) return exists.id;
    }

    const existing = await this.prisma.user.findFirst({
      where: { isOfficial: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      await this.settings.setSetting(OFFICIAL_ID_SETTING, existing.id);
      return existing.id;
    }

    // Aucun mot de passe, aucun fournisseur OAuth, aucune adresse : le compte
    // n'est pas connectable, il n'est piloté que d'ici. `emailVerified` est
    // posé à true parce que plusieurs surfaces excluent les inscriptions
    // incomplètes — pas parce qu'une adresse aurait été confirmée.
    const created = await this.prisma.user.create({
      data: {
        displayName: DEFAULT_DISPLAY_NAME,
        bio: "Compte officiel de NigerConnect. Annonces, informations et nouveautés de l'équipe.",
        isOfficial: true,
        officialSince: new Date(),
        emailVerified: true,
        privacyLevel: 'public',
        showOnMap: false,
        proximityAlerts: false,
        newsletterOptIn: false,
        digestOptIn: false,
      },
      select: { id: true },
    });
    await this.settings.setSetting(OFFICIAL_ID_SETTING, created.id);
    await this.diaspora.invalidate(created.id);
    this.logger.log(`Compte officiel créé: ${created.id}`);
    return created.id;
  }

  /** Profil + compteurs affichés en tête de la section console. */
  async account() {
    const id = await this.ensureAccountId();
    const [user, postsCount, storiesCount, threads, unreadThreads, lastBroadcast] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id }, select: ACCOUNT_SELECT }),
        this.prisma.post.count({ where: { authorId: id, isStory: false, deletedAt: null } }),
        this.prisma.post.count({
          where: {
            authorId: id,
            isStory: true,
            deletedAt: null,
            storyExpiresAt: { gt: new Date() },
          },
        }),
        this.prisma.conversationMember.count({ where: { userId: id } }),
        this.prisma.conversationMember.count({ where: { userId: id, unreadCount: { gt: 0 } } }),
        this.prisma.officialBroadcast.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { id: true, kind: true, title: true, createdAt: true, status: true },
        }),
      ]);

    return {
      account: user,
      stats: { postsCount, storiesCount, threads, unreadThreads },
      lastBroadcast,
      // Ce que « tout le monde » veut dire au moment de l'affichage.
      reach: await this.countRecipients(id, false),
      reachCritical: await this.countRecipients(id, true),
    };
  }

  async updateAccount(dto: UpdateOfficialDto) {
    const id = await this.ensureAccountId();
    const data: Prisma.UserUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.bio !== undefined) data.bio = dto.bio;
    // Même règle que partout : jamais d'URL cliente brute en base, on la lie à
    // notre propre bucket sous le préfixe du compte.
    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = dto.avatarUrl
        ? await this.s3.assertOwnedPublicImage(dto.avatarUrl, id)
        : null;
    }
    if (dto.coverUrl !== undefined) {
      data.coverUrl = dto.coverUrl ? await this.s3.assertOwnedPublicImage(dto.coverUrl, id) : null;
    }
    return this.prisma.user.update({ where: { id }, data, select: ACCOUNT_SELECT });
  }

  /**
   * Presign d'un upload fait DEPUIS la console pour le compte officiel. Le
   * dossier est `users/<id>` volontairement : c'est le préfixe que
   * `assertOwnedPublicImage` exige côté publication, message et story — un
   * dossier à part obligerait à relâcher ce contrôle partout ailleurs.
   */
  async presignUpload(dto: OfficialUploadDto) {
    const id = await this.ensureAccountId();
    const presigned = await this.s3.createPresignedUpload({
      folder: `users/${id}`,
      contentType: dto.contentType,
      visibility: 'public',
    });
    return {
      uploadUrl: presigned.uploadUrl,
      publicUrl: presigned.publicUrl,
      key: presigned.key,
      contentType: dto.contentType,
      sseRequired: presigned.sseRequired,
      expiresIn: presigned.expiresIn,
    };
  }

  // ── Publier ──────────────────────────────────────────────────────────────

  /** Publication publique, visible dans le fil de tout le monde. */
  async publishPost(dto: OfficialPostDto, adminId: string) {
    const id = await this.ensureAccountId();
    const post = await this.posts.create(id, {
      content: dto.content,
      visibility: 'public',
      media: dto.media,
    });
    if (dto.announce) {
      await this.broadcastNotification(
        {
          title: dto.announceTitle?.trim() || 'Nouvelle publication officielle',
          body: dto.content.slice(0, 200),
          linkPath: `/post/${post.id}`,
        },
        adminId,
      );
    }
    return post;
  }

  /** Story officielle (24 h), en tête de la barre de stories de chaque membre. */
  async publishStory(dto: OfficialStoryDto, adminId: string) {
    const id = await this.ensureAccountId();
    const story = await this.posts.createStory(id, {
      content: dto.content,
      media: dto.media,
    });
    if (dto.announce) {
      await this.broadcastNotification(
        {
          title: 'Story officielle',
          body: dto.content?.slice(0, 200) || "L'équipe NigerConnect a publié une story.",
          linkPath: `/stories/${id}`,
        },
        adminId,
      );
    }
    return story;
  }

  /** Publications et stories encore en ligne, pour pouvoir les retirer. */
  async listContent(limit = 20) {
    const id = await this.ensureAccountId();
    const [posts, stories] = await Promise.all([
      this.prisma.post.findMany({
        where: { authorId: id, isStory: false, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          content: true,
          createdAt: true,
          likeCount: true,
          commentCount: true,
          media: { select: { mediaUrl: true, mediaType: true }, orderBy: { sortOrder: 'asc' } },
        },
      }),
      this.prisma.post.findMany({
        where: {
          authorId: id,
          isStory: true,
          deletedAt: null,
          storyExpiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          content: true,
          createdAt: true,
          storyExpiresAt: true,
          media: { select: { mediaUrl: true, mediaType: true } },
        },
      }),
    ]);
    return { posts, stories };
  }

  /** Retirer une publication ou une story du compte officiel. */
  async deleteContent(postId: string): Promise<void> {
    const id = await this.ensureAccountId();
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true, isStory: true, deletedAt: true },
    });
    if (!post || post.deletedAt) throw new NotFoundException('Publication introuvable');
    if (post.authorId !== id) {
      throw new ForbiddenException("Cette publication n'appartient pas au compte officiel");
    }
    if (post.isStory) await this.posts.deleteStory(id, postId);
    else await this.posts.softDelete(id, postId);
  }

  // ── Diffuser ─────────────────────────────────────────────────────────────

  /**
   * Notification à toute la communauté (cloche + push). Part en tâche de fond :
   * la console reçoit tout de suite la ligne de diffusion et suit les compteurs.
   */
  async broadcastNotification(dto: BroadcastNotificationDto, adminId: string) {
    const officialId = await this.ensureAccountId();
    const total = await this.countRecipients(officialId, false);
    const broadcast = await this.prisma.officialBroadcast.create({
      data: {
        kind: 'notification',
        title: dto.title,
        body: dto.body,
        audience: 'all',
        linkPath: dto.linkPath ?? null,
        totalRecipients: total,
        createdById: adminId,
      },
    });
    void this.dispatch(broadcast.id, officialId, async (userId) => {
      await this.notifications.create({
        userId,
        actorId: officialId,
        type: 'announcement',
        title: dto.title,
        body: dto.body,
        data: {
          official: true,
          broadcastId: broadcast.id,
          ...(dto.linkPath ? { path: dto.linkPath } : {}),
        },
        expiresInHours: ANNOUNCEMENT_TTL_HOURS,
      });
    });
    return broadcast;
  }

  /**
   * Message direct à toute la communauté. Chaque membre reçoit une vraie
   * conversation avec le compte officiel : badge non-lu, push « message reçu »,
   * et il peut répondre — la réponse atterrit dans la boîte de la console.
   */
  async broadcastMessage(dto: OfficialMessageDto, adminId: string) {
    const officialId = await this.ensureAccountId();
    const total = await this.countRecipients(officialId, false);
    const broadcast = await this.prisma.officialBroadcast.create({
      data: {
        kind: 'message',
        title: dto.content.slice(0, 140),
        body: dto.content,
        audience: 'all',
        totalRecipients: total,
        createdById: adminId,
      },
    });
    void this.dispatch(broadcast.id, officialId, async (userId) => {
      await this.deliverMessage(officialId, userId, dto);
    });
    return broadcast;
  }

  /** Écrire à UNE personne depuis la console (contact direct, réponse à chaud). */
  async sendDirectMessage(dto: OfficialDirectMessageDto, adminId: string) {
    const officialId = await this.ensureAccountId();
    if (dto.userId === officialId) {
      throw new BadRequestException('Le compte officiel ne peut pas s’écrire à lui-même');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, status: true },
    });
    if (!target) throw new NotFoundException('Membre introuvable');

    const { conversationId } = await this.deliverMessage(officialId, dto.userId, dto);
    await this.prisma.officialBroadcast.create({
      data: {
        kind: 'message',
        status: 'sent',
        title: dto.content.slice(0, 140),
        body: dto.content,
        audience: 'user',
        targetId: dto.userId,
        totalRecipients: 1,
        sentCount: 1,
        createdById: adminId,
        finishedAt: new Date(),
      },
    });
    return { conversationId };
  }

  /** Historique des diffusions (accusé de réception + compteurs). */
  listBroadcasts(limit = 30) {
    return this.prisma.officialBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdBy: { select: { id: true, displayName: true, firstName: true } },
      },
    });
  }

  // ── Boîte de réception ───────────────────────────────────────────────────

  /**
   * Les conversations du compte officiel, non lues d'abord. Sans cette vue, une
   * réponse d'un membre à un message officiel n'aurait aucun destinataire :
   * personne ne se connecte au compte, il n'a pas de mot de passe.
   */
  async listThreads(limit = 30, cursor?: string) {
    const officialId = await this.ensureAccountId();
    const rows = await this.prisma.conversationMember.findMany({
      where: { userId: officialId },
      take: limit + 1,
      ...(cursor ? { cursor: { conversationId_userId: { conversationId: cursor, userId: officialId } }, skip: 1 } : {}),
      orderBy: { conversation: { lastMessageAt: 'desc' } },
      select: {
        unreadCount: true,
        conversation: {
          select: {
            id: true,
            lastMessageAt: true,
            lastMessagePreview: true,
            members: {
              where: { userId: { not: officialId } },
              select: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    firstName: true,
                    lastName: true,
                    avatarUrl: true,
                    city: true,
                    countryCode: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((r) => ({
        conversationId: r.conversation.id,
        unreadCount: r.unreadCount,
        lastMessageAt: r.conversation.lastMessageAt,
        lastMessagePreview: r.conversation.lastMessagePreview,
        peer: r.conversation.members[0]?.user ?? null,
      })),
      nextCursor: hasMore ? page[page.length - 1]!.conversation.id : null,
    };
  }

  /** Fil d'une conversation officielle. La lecture remet le compteur à zéro. */
  async listThreadMessages(conversationId: string, limit = 50, cursor?: string) {
    const officialId = await this.ensureAccountId();
    const messages = await this.chat.listMessages(officialId, conversationId, cursor, limit);
    await this.chat.markAsRead(officialId, conversationId).catch(() => undefined);
    return messages;
  }

  /** Répondre dans une conversation existante, au nom du compte officiel. */
  async replyInThread(conversationId: string, dto: OfficialMessageDto) {
    const officialId = await this.ensureAccountId();
    const mediaUrl = dto.imageUrl
      ? await this.s3.assertOwnedPublicImage(dto.imageUrl, officialId)
      : undefined;
    const { message, memberIds } = await this.chat.sendMessage(officialId, conversationId, {
      content: dto.content,
      messageType: mediaUrl ? 'image' : 'text',
      mediaUrl,
    });
    this.gateway.broadcastNewMessage(conversationId, message, memberIds);
    return message;
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  /**
   * Envoyer un message du compte officiel à un membre : conversation directe
   * réutilisée si elle existe, puis le message par le chemin normal (badge
   * non-lu, notification « message reçu », socket temps réel).
   */
  private async deliverMessage(
    officialId: string,
    userId: string,
    dto: OfficialMessageDto,
  ): Promise<{ conversationId: string }> {
    const mediaUrl = dto.imageUrl
      ? await this.s3.assertOwnedPublicImage(dto.imageUrl, officialId)
      : undefined;
    const conversation = await this.chat.createConversation(officialId, [userId]);
    const { message, memberIds } = await this.chat.sendMessage(officialId, conversation.id, {
      content: dto.content,
      messageType: mediaUrl ? 'image' : 'text',
      mediaUrl,
    });
    this.gateway.broadcastNewMessage(conversation.id, message, memberIds);
    return { conversationId: conversation.id };
  }

  /**
   * Qui reçoit une diffusion : les comptes actifs, moins le compte officiel
   * lui-même, moins les membres en relation de blocage avec lui. L'opt-out
   * « annonces NigerConnect » est respecté — c'est exactement ce que ce
   * réglage promet au membre ; seule une diffusion marquée critique le ignore
   * (aucune ne l'est aujourd'hui, le drapeau existe pour le jour où).
   */
  private recipientWhere(officialId: string, critical: boolean, blockedIds: string[]) {
    const where: Prisma.UserWhereInput = {
      status: 'active',
      isOfficial: false,
      id: { not: officialId, ...(blockedIds.length ? { notIn: blockedIds } : {}) },
    };
    if (!critical) where.newsletterOptIn = true;
    return where;
  }

  private async blockedWith(officialId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: officialId }, { blockedId: officialId }] },
      select: { blockerId: true, blockedId: true },
    });
    return Array.from(
      new Set(rows.map((b) => (b.blockerId === officialId ? b.blockedId : b.blockerId))),
    );
  }

  private async countRecipients(officialId: string, critical: boolean): Promise<number> {
    const blocked = await this.blockedWith(officialId);
    return this.prisma.user.count({ where: this.recipientWhere(officialId, critical, blocked) });
  }

  /**
   * Boucle de diffusion commune aux deux types. En process, sans broker : le
   * goulot est la fan-out push, pas le CPU. Limite connue et assumée, la même
   * que le dispatcher newsletter : un redémarrage en plein envoi laisse la
   * ligne en `sending` — visible dans la console, rejouable à la main.
   */
  private async dispatch(
    broadcastId: string,
    officialId: string,
    deliver: (userId: string) => Promise<void>,
  ): Promise<void> {
    const blocked = await this.blockedWith(officialId);
    const where = this.recipientWhere(officialId, false, blocked);
    let cursor: string | undefined;
    let sent = 0;
    let failed = 0;

    try {
      for (;;) {
        const batch = await this.prisma.user.findMany({
          where,
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: { id: 'asc' },
          select: { id: true },
        });
        if (batch.length === 0) break;
        cursor = batch[batch.length - 1]!.id;

        for (const user of batch) {
          try {
            await deliver(user.id);
            sent += 1;
          } catch (err) {
            failed += 1;
            this.logger.warn(`Diffusion ${broadcastId} → ${user.id} échouée: ${String(err)}`);
          }
        }

        await this.prisma.officialBroadcast.update({
          where: { id: broadcastId },
          data: { sentCount: sent, failedCount: failed },
        });
        if (batch.length < BATCH_SIZE) break;
        await this.delay(BATCH_DELAY_MS);
      }

      await this.prisma.officialBroadcast.update({
        where: { id: broadcastId },
        data: { status: 'sent', sentCount: sent, failedCount: failed, finishedAt: new Date() },
      });
      this.logger.log(`Diffusion ${broadcastId} terminée: ${sent} ok, ${failed} échecs`);
    } catch (err) {
      this.logger.error(`Diffusion ${broadcastId} interrompue`, err as Error);
      await this.prisma.officialBroadcast
        .update({
          where: { id: broadcastId },
          data: { status: 'failed', sentCount: sent, failedCount: failed, finishedAt: new Date() },
        })
        .catch(() => undefined);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
