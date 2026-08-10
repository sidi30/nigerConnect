import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ContactStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { MailerService } from '../common/mail/mailer.service';
import type { CreateContactDto, ListContactDto, PatchContactDto } from './contact.schemas';

/** Champs renvoyés à la console admin. Le message complet est inclus : la liste
 *  sert à traiter les demandes, pas seulement à les compter. */
const ADMIN_SELECT = {
  id: true,
  topic: true,
  email: true,
  phone: true,
  subject: true,
  message: true,
  status: true,
  createdAt: true,
  handledAt: true,
  user: { select: { id: true, displayName: true, firstName: true, avatarUrl: true } },
} as const;

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Enregistre un message de contact et notifie le staff par email.
   *
   * L'envoi du mail est volontairement non bloquant : si le SMTP est en panne,
   * le message est déjà en base et consultable dans la console — perdre la
   * demande d'un partenaire parce qu'un serveur mail tousse serait pire que de
   * rater la notification.
   */
  async create(userId: string | null, dto: CreateContactDto) {
    const created = await this.prisma.contactMessage.create({
      data: {
        userId,
        topic: dto.topic,
        email: dto.email,
        phone: dto.phone ?? null,
        subject: dto.subject,
        message: dto.message,
      },
      select: { id: true, createdAt: true },
    });

    let senderName: string | null = null;
    if (userId) {
      const sender = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, firstName: true },
      });
      senderName = sender?.displayName ?? sender?.firstName ?? null;
    }

    try {
      await this.mailer.sendContactNotification({
        topic: dto.topic,
        subject: dto.subject,
        message: dto.message,
        fromEmail: dto.email,
        fromPhone: dto.phone ?? null,
        fromName: senderName,
      });
    } catch (err) {
      this.logger.error(
        `Contact ${created.id} enregistré mais notification email échouée: ${String(err)}`,
      );
    }

    return { id: created.id, createdAt: created.createdAt };
  }

  /** Liste paginée par curseur pour la console admin. */
  async list(dto: ListContactDto) {
    const where = dto.status === 'all' ? {} : { status: dto.status as ContactStatus };
    const items = await this.prisma.contactMessage.findMany({
      where,
      select: ADMIN_SELECT,
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      // Pastille de la sidebar admin.
      newCount: await this.prisma.contactMessage.count({ where: { status: 'new' } }),
    };
  }

  /** Change le statut d'un message (lu / traité) et trace qui l'a fait. */
  async setStatus(id: string, adminId: string, dto: PatchContactDto) {
    const existing = await this.prisma.contactMessage.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Message introuvable');

    return this.prisma.contactMessage.update({
      where: { id },
      data: {
        status: dto.status,
        // Repasser en 'new' remet le compteur à zéro : le message redevient à traiter.
        handledById: dto.status === 'new' ? null : adminId,
        handledAt: dto.status === 'new' ? null : new Date(),
      },
      select: ADMIN_SELECT,
    });
  }
}
