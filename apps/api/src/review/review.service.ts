import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, ReviewTargetType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { USER_PUBLIC_SELECT } from '../common/prisma/user-select';
import type { ListReviewsDto, UpsertReviewDto } from './dto/review.dto';

const REVIEW_INCLUDE = {
  author: { select: USER_PUBLIC_SELECT },
} as const satisfies Prisma.ReviewInclude;

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async upsert(authorId: string, dto: UpsertReviewDto) {
    const { targetUserId, targetPageId } = await this.resolveTarget(
      dto.targetType,
      dto.targetId,
      authorId,
    );

    const where: Prisma.ReviewWhereUniqueInput =
      dto.targetType === 'user'
        ? { authorId_targetUserId: { authorId, targetUserId: targetUserId! } }
        : { authorId_targetPageId: { authorId, targetPageId: targetPageId! } };

    // Notify only on the first review, not on subsequent edits (re-ratings).
    const existed = await this.prisma.review.findUnique({ where, select: { id: true } });

    const review = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.review.upsert({
        where,
        create: {
          authorId,
          targetType: dto.targetType,
          targetUserId,
          targetPageId,
          rating: dto.rating,
          comment: dto.comment ?? null,
        },
        update: { rating: dto.rating, comment: dto.comment ?? null },
        include: REVIEW_INCLUDE,
      });
      await this.recomputeAggregate(tx, dto.targetType, dto.targetId);
      return saved;
    });

    // Notify the reviewed user (page → its creator) — only for new reviews.
    if (!existed) {
      await this.notifyTarget(authorId, dto, targetUserId, targetPageId);
    }
    return review;
  }

  async list(targetType: ReviewTargetType, targetId: string, dto: ListReviewsDto) {
    const where: Prisma.ReviewWhereInput =
      targetType === 'user' ? { targetUserId: targetId } : { targetPageId: targetId };

    const items = await this.prisma.review.findMany({
      where,
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: REVIEW_INCLUDE,
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async summary(targetType: ReviewTargetType, targetId: string, viewerId: string) {
    const where: Prisma.ReviewWhereInput =
      targetType === 'user' ? { targetUserId: targetId } : { targetPageId: targetId };

    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where,
      _count: { rating: true },
    });
    const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let total = 0;
    let sum = 0;
    for (const g of grouped) {
      const c = g._count.rating;
      distribution[g.rating - 1] = c;
      total += c;
      sum += g.rating * c;
    }

    const myReview = await this.prisma.review.findFirst({
      where: { ...where, authorId: viewerId },
      include: REVIEW_INCLUDE,
    });

    return {
      ratingAvg: total ? Math.round((sum / total) * 100) / 100 : 0,
      ratingCount: total,
      distribution,
      myReview,
    };
  }

  async remove(authorId: string, id: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    if (review.authorId !== authorId) throw new ForbiddenException('Not your review');

    const targetId = review.targetType === 'user' ? review.targetUserId! : review.targetPageId!;
    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id } });
      await this.recomputeAggregate(tx, review.targetType, targetId);
    });
  }

  // ── helpers ──────────────────────────────────────────────────
  private async resolveTarget(
    targetType: ReviewTargetType,
    targetId: string,
    authorId: string,
  ): Promise<{ targetUserId: string | null; targetPageId: string | null }> {
    if (targetType === 'user') {
      if (targetId === authorId) throw new BadRequestException('Cannot review yourself');
      const user = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('User not found');
      return { targetUserId: targetId, targetPageId: null };
    }
    const page = await this.prisma.page.findUnique({
      where: { id: targetId },
      select: { id: true, createdById: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    // A page owner/admin must not review their own page (rating self-inflation).
    if (page.createdById === authorId) {
      throw new BadRequestException('Cannot review your own page');
    }
    const admin = await this.prisma.pageAdmin.findUnique({
      where: { pageId_userId: { pageId: targetId, userId: authorId } },
      select: { userId: true },
    });
    if (admin) throw new BadRequestException('Cannot review a page you administer');
    return { targetUserId: null, targetPageId: targetId };
  }

  private async recomputeAggregate(
    tx: Prisma.TransactionClient,
    targetType: ReviewTargetType,
    targetId: string,
  ): Promise<void> {
    const where: Prisma.ReviewWhereInput =
      targetType === 'user' ? { targetUserId: targetId } : { targetPageId: targetId };
    const agg = await tx.review.aggregate({
      where,
      _avg: { rating: true },
      _count: { rating: true },
    });
    const ratingCount = agg._count.rating;
    const ratingAvg = ratingCount ? Math.round((agg._avg.rating ?? 0) * 100) / 100 : 0;
    if (targetType === 'user') {
      await tx.user.update({ where: { id: targetId }, data: { ratingAvg, ratingCount } });
    } else {
      await tx.page.update({ where: { id: targetId }, data: { ratingAvg, ratingCount } });
    }
  }

  private async notifyTarget(
    authorId: string,
    dto: UpsertReviewDto,
    targetUserId: string | null,
    targetPageId: string | null,
  ): Promise<void> {
    const author = await this.prisma.user.findUnique({
      where: { id: authorId },
      select: { displayName: true, firstName: true },
    });
    const name = author?.displayName || author?.firstName || 'Quelqu’un';
    const stars = '★'.repeat(dto.rating);

    if (targetUserId) {
      await this.notifications.create({
        userId: targetUserId,
        actorId: authorId,
        type: 'review_received',
        title: `${name} t’a laissé un avis ${stars}`,
        body: dto.comment ?? undefined,
        data: { reviewTargetType: 'user', targetId: targetUserId },
      });
    } else if (targetPageId) {
      const page = await this.prisma.page.findUnique({
        where: { id: targetPageId },
        select: { name: true, createdById: true },
      });
      if (page?.createdById) {
        await this.notifications.create({
          userId: page.createdById,
          actorId: authorId,
          type: 'review_received',
          title: `${name} a laissé un avis ${stars} sur ${page.name}`,
          body: dto.comment ?? undefined,
          data: { reviewTargetType: 'page', targetId: targetPageId },
        });
      }
    }
  }
}
