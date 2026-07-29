import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';
import { NotificationService } from '../notification/notification.service';
import { BlockService } from '../social/block.service';
import type {
  CreateServiceDto,
  ListServicesDto,
  RespondDto,
  RateDto,
  ServiceMediaDto,
  UpdateServiceDto,
} from './dto/service.dto';

const AUTHOR_SELECT = {
  id: true,
  displayName: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  city: true,
  countryCode: true,
  identityStatus: true,
  isAmbassador: true,
} as const satisfies Prisma.UserSelect;

// Gallery is always returned oldest-slot-first so the client renders the same
// order the author arranged (matches PostMedia handling in the feed).
const REQUEST_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  media: { orderBy: { sortOrder: 'asc' } },
} as const satisfies Prisma.ServiceRequestInclude;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly s3: S3Service,
    private readonly blocks: BlockService,
  ) {}

  /**
   * Client-supplied media URLs are only shape-checked by Zod. Bind each one to
   * the author's own public-bucket prefix (rejects a key that isn't
   * `users/<authorId>/…`) and persist the canonical CDN URL the helper returns.
   * Same guard as posts/stories/chat — no raw client URL is ever stored.
   */
  private async bindMedia(
    authorId: string,
    media: ServiceMediaDto[],
  ): Promise<Prisma.ServiceMediaCreateManyRequestInput[]> {
    return Promise.all(
      media.map(async (m, i) => ({
        mediaUrl: await this.s3.assertOwnedPublicImage(m.mediaUrl, authorId),
        thumbnailUrl: m.thumbnailUrl
          ? await this.s3.assertOwnedPublicImage(m.thumbnailUrl, authorId)
          : null,
        mediaType: m.mediaType,
        width: m.width ?? null,
        height: m.height ?? null,
        blurhash: m.blurhash ?? null,
        sortOrder: m.sortOrder ?? i,
      })),
    );
  }

  async create(authorId: string, dto: CreateServiceDto) {
    const media = dto.media?.length ? await this.bindMedia(authorId, dto.media) : undefined;

    return this.prisma.serviceRequest.create({
      data: {
        authorId,
        title: dto.title,
        description: dto.description ?? null,
        category: dto.category,
        intent: dto.intent,
        urgency: dto.urgency,
        budget: dto.budget ?? null,
        city: dto.city ?? null,
        countryCode: dto.countryCode ?? null,
        media: media ? { createMany: { data: media } } : undefined,
      },
      include: REQUEST_INCLUDE,
    });
  }

  /**
   * Owner-only edit. `media`, when provided, REPLACES the whole gallery
   * (delete + recreate) in a single transaction — no partial diff (ADR-003).
   */
  async update(userId: string, id: string, dto: UpdateServiceDto) {
    const existing = await this.prisma.serviceRequest.findUnique({
      where: { id },
      select: { authorId: true, intent: true, budget: true },
    });
    if (!existing) throw new NotFoundException('Service request not found');
    if (existing.authorId !== userId) throw new ForbiddenException('Not your request');

    // A budget only makes sense on a paid listing. Guard against the merged
    // (effective) state too: patching a budget onto a request that stays
    // help_free must fail even when the body doesn't restate `intent`.
    const effectiveIntent = dto.intent ?? existing.intent;
    const effectiveBudget = dto.budget !== undefined ? dto.budget : existing.budget;
    if (effectiveIntent === 'help_free' && effectiveBudget != null) {
      throw new BadRequestException('budget is only allowed when intent = paid_service');
    }

    const media =
      dto.media !== undefined
        ? dto.media.length
          ? await this.bindMedia(userId, dto.media)
          : []
        : undefined;

    const data: Prisma.ServiceRequestUpdateInput = {};
    if (dto.intent !== undefined) data.intent = dto.intent;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.urgency !== undefined) data.urgency = dto.urgency;
    if (dto.budget !== undefined) data.budget = dto.budget;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;
    // Clearing budget when a request flips back to help_free keeps DB coherent.
    if (effectiveIntent === 'help_free') data.budget = null;

    return this.prisma.$transaction(async (tx) => {
      if (media !== undefined) {
        await tx.serviceMedia.deleteMany({ where: { requestId: id } });
        if (media.length) {
          await tx.serviceMedia.createMany({
            data: media.map((m) => ({ ...m, requestId: id })),
          });
        }
      }
      return tx.serviceRequest.update({
        where: { id },
        data,
        include: REQUEST_INCLUDE,
      });
    });
  }

  /** Owner-only delete. FK cascade drops media / responses / ratings. */
  async remove(userId: string, id: string) {
    const existing = await this.prisma.serviceRequest.findUnique({
      where: { id },
      select: { authorId: true },
    });
    if (!existing) throw new NotFoundException('Service request not found');
    if (existing.authorId !== userId) throw new ForbiddenException('Not your request');
    await this.prisma.serviceRequest.delete({ where: { id } });
  }

  async list(dto: ListServicesDto) {
    const where: Prisma.ServiceRequestWhereInput = {};
    if (dto.intent) where.intent = dto.intent;
    if (dto.category) where.category = dto.category;
    if (dto.country) where.countryCode = dto.country;
    if (dto.urgency) where.urgency = dto.urgency;
    if (dto.q) {
      where.OR = [
        { title: { contains: dto.q, mode: 'insensitive' } },
        { description: { contains: dto.q, mode: 'insensitive' } },
        { city: { contains: dto.q, mode: 'insensitive' } },
      ];
    }
    where.status = dto.status ?? 'open';

    const orderBy: Prisma.ServiceRequestOrderByWithRelationInput[] =
      dto.sort === 'urgent_first'
        ? [{ urgency: 'asc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

    const items = await this.prisma.serviceRequest.findMany({
      where,
      orderBy,
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      include: REQUEST_INCLUDE,
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async getById(id: string) {
    const req = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!req) throw new NotFoundException('Service request not found');
    return req;
  }

  mine(userId: string) {
    return this.prisma.serviceRequest.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respond(userId: string, requestId: string, dto: RespondDto) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, authorId: true, status: true },
    });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.authorId === userId) {
      throw new ForbiddenException('Cannot respond to your own request');
    }
    if (request.status !== 'open') throw new ForbiddenException('Request is no longer open');
    // A response carries free text straight to the author, plus a notification —
    // i.e. a messaging channel. A block has to close it, exactly like chat.
    if (await this.blocks.isBlocked(userId, request.authorId)) {
      throw new ForbiddenException('Interaction impossible avec ce membre');
    }

    const [response] = await this.prisma.$transaction([
      this.prisma.serviceResponse.create({
        data: { requestId, responderId: userId, message: dto.message },
        include: { responder: { select: AUTHOR_SELECT } },
      }),
      this.prisma.serviceRequest.update({
        where: { id: requestId },
        data: { responseCount: { increment: 1 } },
      }),
    ]);

    const responderName =
      response.responder.displayName || response.responder.firstName || 'Un membre';
    await this.notifications.create({
      userId: request.authorId,
      actorId: userId,
      type: 'service_response',
      title: `${responderName} a répondu à votre demande`,
      body: dto.message.slice(0, 140),
      data: { requestId, responseId: response.id },
    });

    return response;
  }

  async listResponses(userId: string, requestId: string) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { authorId: true },
    });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.authorId !== userId) throw new ForbiddenException('Only the request author can view responses');
    return this.prisma.serviceResponse.findMany({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
      include: { responder: { select: AUTHOR_SELECT } },
    });
  }

  async resolve(userId: string, requestId: string) {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.authorId !== userId) throw new ForbiddenException('Not your request');
    return this.prisma.serviceRequest.update({
      where: { id: requestId },
      data: { status: 'resolved' },
    });
  }

  async rate(userId: string, requestId: string, dto: RateDto) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { authorId: true, status: true },
    });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.authorId !== userId) throw new ForbiddenException('Only the request author can rate');
    if (request.status !== 'resolved') {
      throw new ForbiddenException('Request must be resolved before rating');
    }

    const response = await this.prisma.serviceResponse.findFirst({
      where: { requestId, responderId: dto.ratedUserId },
      select: { id: true },
    });
    if (!response) {
      throw new ForbiddenException('User did not respond to this request');
    }

    return this.prisma.serviceRating.upsert({
      where: { requestId_ratedUserId: { requestId, ratedUserId: dto.ratedUserId } },
      create: {
        requestId,
        ratedUserId: dto.ratedUserId,
        rating: dto.rating,
        comment: dto.comment ?? null,
      },
      update: {
        rating: dto.rating,
        comment: dto.comment ?? null,
      },
    });
  }
}
