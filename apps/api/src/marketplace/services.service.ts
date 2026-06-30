import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import type { CreateServiceDto, ListServicesDto, RespondDto, RateDto } from './dto/service.dto';

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

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  create(authorId: string, dto: CreateServiceDto) {
    return this.prisma.serviceRequest.create({
      data: {
        authorId,
        title: dto.title,
        description: dto.description ?? null,
        category: dto.category,
        urgency: dto.urgency,
        budget: dto.budget ?? null,
        city: dto.city ?? null,
        countryCode: dto.countryCode ?? null,
      },
      include: { author: { select: AUTHOR_SELECT } },
    });
  }

  async list(dto: ListServicesDto) {
    const where: Prisma.ServiceRequestWhereInput = {};
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
      include: { author: { select: AUTHOR_SELECT } },
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async getById(id: string) {
    const req = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: { author: { select: AUTHOR_SELECT } },
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
