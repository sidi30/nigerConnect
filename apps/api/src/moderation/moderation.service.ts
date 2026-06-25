import { Injectable, NotFoundException } from '@nestjs/common';
import type { ReportTargetType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { CreateReportDto, ListReportsDto, ResolveReportDto } from './dto/report.dto';

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reporterId: string, dto: CreateReportDto) {
    return this.prisma.report.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        description: dto.description ?? null,
      },
    });
  }

  async list(dto: ListReportsDto) {
    const items = await this.prisma.report.findMany({
      where: { status: dto.status },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  // Resolve a report's target into a content preview for the moderation console.
  // Moderators MUST be able to read the reported content to decide — so this
  // bypasses the privacy/ownership rules enforced on the public API (private
  // posts, friends-only posts, DM content). Access is role-gated to
  // admin/moderator at the controller. Soft-deleted content is still returned
  // (the row is kept on content_removed) so a resolved report stays auditable;
  // `deletedAt` lets the UI flag it. Hard-deleted/missing targets return found:false.
  async getTarget(id: string) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');

    const { targetType, targetId } = report;
    const authorSelect = { id: true, displayName: true, avatarUrl: true } as const;

    switch (targetType) {
      case 'post': {
        const post = await this.prisma.post.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            content: true,
            visibility: true,
            isStory: true,
            createdAt: true,
            deletedAt: true,
            author: { select: authorSelect },
            media: {
              select: { mediaUrl: true, thumbnailUrl: true, mediaType: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        });
        if (!post) return { type: 'post' as const, found: false as const };
        return { type: 'post' as const, found: true as const, ...post };
      }
      case 'comment': {
        const comment = await this.prisma.comment.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            content: true,
            createdAt: true,
            deletedAt: true,
            postId: true,
            author: { select: authorSelect },
          },
        });
        if (!comment) return { type: 'comment' as const, found: false as const };
        return { type: 'comment' as const, found: true as const, ...comment };
      }
      case 'message': {
        const message = await this.prisma.message.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            content: true,
            mediaUrl: true,
            messageType: true,
            createdAt: true,
            deletedAt: true,
            sender: { select: authorSelect },
          },
        });
        if (!message) return { type: 'message' as const, found: false as const };
        return { type: 'message' as const, found: true as const, ...message };
      }
      case 'user': {
        const user = await this.prisma.user.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
            city: true,
            countryCode: true,
            status: true,
            createdAt: true,
          },
        });
        if (!user) return { type: 'user' as const, found: false as const };
        return { type: 'user' as const, found: true as const, ...user };
      }
      case 'association': {
        const association = await this.prisma.association.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            name: true,
            description: true,
            logoUrl: true,
            category: true,
            city: true,
            countryCode: true,
            createdAt: true,
          },
        });
        if (!association) return { type: 'association' as const, found: false as const };
        return { type: 'association' as const, found: true as const, ...association };
      }
      default:
        return { type: targetType, found: false as const };
    }
  }

  async resolve(reviewerId: string, id: string, dto: ResolveReportDto) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');

    const updates: Promise<unknown>[] = [];

    switch (dto.action) {
      case 'content_removed':
        updates.push(this.removeContent(report.targetType, report.targetId));
        break;
      case 'suspended':
        updates.push(this.setUserStatus(report.targetType, report.targetId, 'suspended'));
        break;
      case 'banned':
        updates.push(this.setUserStatus(report.targetType, report.targetId, 'banned'));
        break;
      case 'warning':
      case 'none':
        break;
    }

    updates.push(
      this.prisma.report.update({
        where: { id },
        data: {
          status: dto.action === 'none' ? 'dismissed' : 'resolved',
          reviewedById: reviewerId,
          actionTaken: dto.action,
          note: dto.note ?? null,
          resolvedAt: new Date(),
        },
      }),
    );

    await Promise.all(updates);
  }

  private async removeContent(type: ReportTargetType, id: string): Promise<void> {
    const now = new Date();
    switch (type) {
      case 'post':
        await this.prisma.post.update({ where: { id }, data: { deletedAt: now } });
        return;
      case 'message':
        await this.prisma.message.update({
          where: { id },
          data: { deletedAt: now, content: null, mediaUrl: null },
        });
        return;
      case 'comment':
        await this.prisma.comment.update({ where: { id }, data: { deletedAt: now } });
        return;
      default:
        return;
    }
  }

  private async setUserStatus(
    type: ReportTargetType,
    targetId: string,
    status: 'suspended' | 'banned',
  ): Promise<void> {
    if (type !== 'user') return;
    // Read the prior state first so the abuse-flag increment fires only on the
    // transition INTO banned — re-banning an already-banned user must not
    // over-count the inviter's flags (idempotent).
    const prior = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { status: true, invitedById: true },
    });
    if (!prior) return;

    if (status === 'banned' && prior.status !== 'banned') {
      // Ban : couper aussi les liens reusable encore actifs du banni + retirer le
      // droit bulk-invite. Sinon un lien de masse déjà émis continue d'onboarder
      // des comptes après le ban (mirror du retrait admin). Idempotent (ne tourne
      // qu'à la transition vers banned).
      await this.prisma.user.update({
        where: { id: targetId },
        data: { status, canBulkInvite: false },
      });
      await this.prisma.invitation.updateMany({
        where: { inviterId: targetId, kind: 'reusable', status: 'pending' },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      // Anti-abuse (§11): banning a filleul flags their inviter. At >=3 flags the
      // inviter's invite quota freezes (enforced in InvitationsService.createInvitation).
      // No cascade — we only flag the direct inviter, never touch the filleul's own tree.
      if (prior.invitedById) {
        await this.prisma.user.update({
          where: { id: prior.invitedById },
          data: { inviteAbuseFlags: { increment: 1 } },
        });
      }
      return;
    }

    await this.prisma.user.update({ where: { id: targetId }, data: { status } });
  }
}
