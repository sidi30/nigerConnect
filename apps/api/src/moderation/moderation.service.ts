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
    await this.prisma.user.update({ where: { id: targetId }, data: { status } });
    // Anti-abuse (§11): banning a filleul flags their inviter. At >=3 flags the
    // inviter's invite quota freezes (enforced in InvitationsService.createInvitation).
    // No cascade — we only flag the direct inviter, never touch the filleul's own tree.
    if (status === 'banned' && prior.status !== 'banned' && prior.invitedById) {
      await this.prisma.user.update({
        where: { id: prior.invitedById },
        data: { inviteAbuseFlags: { increment: 1 } },
      });
    }
  }
}
