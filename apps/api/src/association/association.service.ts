import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AssociationRole, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type {
  ChangeRoleDto,
  CreateAssociationDto,
  CreateEventDto,
  ListAssociationsDto,
  UpdateAssociationDto,
} from './dto/association.dto';

const MEMBER_SELECT = {
  id: true,
  displayName: true,
  avatarUrl: true,
  city: true,
  countryCode: true,
} as const satisfies Prisma.UserSelect;

@Injectable()
export class AssociationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(creatorId: string, dto: CreateAssociationDto) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { identityStatus: true },
    });
    if (!creator || creator.identityStatus !== 'approved') {
      throw new ForbiddenException('Identity verification required to create an association');
    }

    return this.prisma.$transaction(async (tx) => {
      const assoc = await tx.association.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          logoUrl: dto.logoUrl ?? null,
          coverUrl: dto.coverUrl ?? null,
          category: dto.category,
          countryCode: dto.countryCode ?? null,
          city: dto.city ?? null,
          website: dto.website ?? null,
          contactEmail: dto.contactEmail ?? null,
          createdById: creatorId,
          memberCount: 1,
        },
      });
      await tx.associationMember.create({
        data: { associationId: assoc.id, userId: creatorId, role: 'admin', status: 'approved' },
      });
      return assoc;
    });
  }

  async list(dto: ListAssociationsDto) {
    const where: Prisma.AssociationWhereInput = {};
    if (dto.category) where.category = dto.category;
    if (dto.country) where.countryCode = dto.country;

    const items = await this.prisma.association.findMany({
      where,
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: [{ memberCount: 'desc' }, { createdAt: 'desc' }],
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async getById(id: string) {
    const assoc = await this.prisma.association.findUnique({
      where: { id },
      include: {
        createdBy: { select: MEMBER_SELECT },
        events: {
          where: { eventDate: { gte: new Date() } },
          orderBy: { eventDate: 'asc' },
          take: 10,
        },
      },
    });
    if (!assoc) throw new NotFoundException('Association not found');
    return assoc;
  }

  async update(userId: string, id: string, dto: UpdateAssociationDto) {
    await this.assertRole(userId, id, ['admin']);
    return this.prisma.association.update({ where: { id }, data: dto });
  }

  async join(userId: string, id: string) {
    const existing = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId } },
    });
    if (existing) throw new ConflictException('Already a member');

    const [membership] = await this.prisma.$transaction([
      this.prisma.associationMember.create({
        data: { associationId: id, userId, role: 'member', status: 'approved' },
      }),
      this.prisma.association.update({
        where: { id },
        data: { memberCount: { increment: 1 } },
      }),
    ]);
    return membership;
  }

  async leave(userId: string, id: string): Promise<void> {
    const member = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId } },
    });
    if (!member) throw new NotFoundException('Not a member');
    if (member.role === 'admin') {
      const adminCount = await this.prisma.associationMember.count({
        where: { associationId: id, role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot leave: you are the last admin');
      }
    }
    await this.prisma.$transaction([
      this.prisma.associationMember.delete({
        where: { associationId_userId: { associationId: id, userId } },
      }),
      this.prisma.association.update({
        where: { id },
        data: { memberCount: { decrement: 1 } },
      }),
    ]);
  }

  async changeRole(actorId: string, id: string, targetUserId: string, dto: ChangeRoleDto) {
    await this.assertRole(actorId, id, ['admin']);
    return this.prisma.associationMember.update({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
      data: { role: dto.role },
    });
  }

  async listMembers(id: string, cursor?: string, limit = 30) {
    const items = await this.prisma.associationMember.findMany({
      where: { associationId: id, status: 'approved' },
      take: limit + 1,
      ...(cursor ? { cursor: { associationId_userId: { associationId: id, userId: cursor } }, skip: 1 } : {}),
      orderBy: { joinedAt: 'asc' },
      include: { user: { select: MEMBER_SELECT } },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]!.userId : null,
    };
  }

  // ── Events ──────────────────────────────────────────────────
  async createEvent(userId: string, id: string, dto: CreateEventDto) {
    await this.assertRole(userId, id, ['admin', 'moderator']);
    return this.prisma.associationEvent.create({
      data: {
        associationId: id,
        title: dto.title,
        description: dto.description ?? null,
        eventDate: new Date(dto.eventDate),
        location: dto.location ?? null,
        coverUrl: dto.coverUrl ?? null,
      },
    });
  }

  listEvents(id: string) {
    return this.prisma.associationEvent.findMany({
      where: { associationId: id, eventDate: { gte: new Date() } },
      orderBy: { eventDate: 'asc' },
    });
  }

  upcomingEvents(limit = 20) {
    return this.prisma.associationEvent.findMany({
      where: { eventDate: { gte: new Date() } },
      orderBy: { eventDate: 'asc' },
      take: limit,
      include: {
        association: { select: { id: true, name: true, logoUrl: true, countryCode: true } },
      },
    });
  }

  private async assertRole(userId: string, associationId: string, roles: AssociationRole[]): Promise<void> {
    const member = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId, userId } },
      select: { role: true, status: true },
    });
    if (!member || member.status !== 'approved' || !roles.includes(member.role)) {
      throw new ForbiddenException('Insufficient role');
    }
  }
}
