import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AssociationRole, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { GeoService } from '../geo/geo.service';
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
  firstName: true,
  lastName: true,
  avatarUrl: true,
  city: true,
  countryCode: true,
} as const satisfies Prisma.UserSelect;

@Injectable()
export class AssociationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly geo: GeoService,
  ) {}

  async create(creatorId: string, dto: CreateAssociationDto) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { identityStatus: true },
    });
    if (!creator || creator.identityStatus !== 'approved') {
      throw new ForbiddenException('Identity verification required to create an association');
    }

    const created = await this.prisma.$transaction(async (tx) => {
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
          requiresApproval: dto.requiresApproval ?? false,
          createdById: creatorId,
          memberCount: 1,
        },
      });
      await tx.associationMember.create({
        data: { associationId: assoc.id, userId: creatorId, role: 'admin', status: 'approved' },
      });
      return assoc;
    });

    // Surface the new association on the map immediately (bypass the TTL).
    await this.geo.invalidateMarkerCache();
    return created;
  }

  /**
   * Delete an association. Only an admin (the founding creator is one) may do
   * this; the cascade in the schema removes members/events. Mirrors PageService.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.assertRole(userId, id, ['admin']);
    await this.prisma.association.delete({ where: { id } });
    await this.geo.invalidateMarkerCache();
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

  async listMine(userId: string) {
    const memberships = await this.prisma.associationMember.findMany({
      where: { userId, status: 'approved' },
      orderBy: { joinedAt: 'desc' },
      include: {
        association: {
          select: {
            id: true,
            name: true,
            description: true,
            logoUrl: true,
            coverUrl: true,
            category: true,
            city: true,
            countryCode: true,
            memberCount: true,
            isVerified: true,
            createdAt: true,
          },
        },
      },
    });
    return memberships.map((m) => ({
      ...m.association,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
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
    if (existing) {
      if (existing.status === 'approved') throw new ConflictException('Already a member');
      if (existing.status === 'pending') {
        throw new ConflictException('Join request already pending');
      }
      // 'rejected' → allow re-requesting (flip back to pending or approved)
    }

    const assoc = await this.prisma.association.findUnique({
      where: { id },
      select: { id: true, name: true, requiresApproval: true },
    });
    if (!assoc) throw new NotFoundException('Association not found');

    if (assoc.requiresApproval) {
      // Pending membership — admins must approve.
      const membership = existing
        ? await this.prisma.associationMember.update({
            where: { associationId_userId: { associationId: id, userId } },
            data: { status: 'pending', role: 'member', joinedAt: new Date() },
          })
        : await this.prisma.associationMember.create({
            data: { associationId: id, userId, role: 'member', status: 'pending' },
          });

      // Notify every admin of the association.
      const requester = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, firstName: true },
      });
      const requesterName = requester?.displayName || requester?.firstName || 'Un membre';
      const admins = await this.prisma.associationMember.findMany({
        where: { associationId: id, role: 'admin', status: 'approved' },
        select: { userId: true },
      });
      await Promise.all(
        admins
          .filter((a) => a.userId !== userId)
          .map((a) =>
            this.notifications.create({
              userId: a.userId,
              actorId: userId,
              type: 'association_join_request',
              title: `${requesterName} demande à rejoindre ${assoc.name}`,
              data: { associationId: id, requesterId: userId },
            }),
          ),
      );
      return { ...membership, pending: true };
    }

    // Open association — auto-approve.
    const [membership] = await this.prisma.$transaction([
      existing
        ? this.prisma.associationMember.update({
            where: { associationId_userId: { associationId: id, userId } },
            data: { status: 'approved', role: 'member', joinedAt: new Date() },
          })
        : this.prisma.associationMember.create({
            data: { associationId: id, userId, role: 'member', status: 'approved' },
          }),
      this.prisma.association.update({
        where: { id },
        data: { memberCount: { increment: existing?.status === 'approved' ? 0 : 1 } },
      }),
    ]);
    return { ...membership, pending: false };
  }

  /**
   * Invite a user to the association. Admins/moderators only. We don't create a
   * membership row here — the invite is a prompt: the target taps the
   * `association_invite` notification, lands on the association page and joins
   * through the normal flow (which respects `requiresApproval`).
   */
  async inviteMember(actorId: string, id: string, targetUserId: string) {
    await this.assertRole(actorId, id, ['admin', 'moderator']);
    if (targetUserId === actorId) {
      throw new BadRequestException('Cannot invite yourself');
    }

    const existing = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
    });
    if (existing?.status === 'approved') throw new ConflictException('User is already a member');
    if (existing?.status === 'pending') {
      throw new ConflictException('User already has a pending request');
    }

    const assoc = await this.prisma.association.findUnique({
      where: { id },
      select: { name: true },
    });
    if (!assoc) throw new NotFoundException('Association not found');

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const inviter = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { displayName: true, firstName: true },
    });
    const inviterName = inviter?.displayName || inviter?.firstName || 'Un membre';
    await this.notifications.create({
      userId: targetUserId,
      actorId,
      type: 'association_invite',
      title: `${inviterName} t'invite à rejoindre ${assoc.name}`,
      data: { associationId: id },
    });
    return { invited: true };
  }

  async listPendingRequests(userId: string, id: string, cursor?: string, limit = 30) {
    await this.assertRole(userId, id, ['admin', 'moderator']);
    const items = await this.prisma.associationMember.findMany({
      where: { associationId: id, status: 'pending' },
      take: limit + 1,
      ...(cursor
        ? { cursor: { associationId_userId: { associationId: id, userId: cursor } }, skip: 1 }
        : {}),
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

  async approveJoinRequest(actorId: string, id: string, targetUserId: string) {
    await this.assertRole(actorId, id, ['admin', 'moderator']);
    const member = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('Pending request not found');
    if (member.status !== 'pending') {
      throw new BadRequestException('Request is not pending');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.associationMember.update({
        where: { associationId_userId: { associationId: id, userId: targetUserId } },
        data: { status: 'approved', joinedAt: new Date() },
      }),
      this.prisma.association.update({
        where: { id },
        data: { memberCount: { increment: 1 } },
      }),
    ]);

    const assoc = await this.prisma.association.findUnique({
      where: { id },
      select: { name: true },
    });
    await this.notifications.create({
      userId: targetUserId,
      actorId,
      type: 'association_join_approved',
      title: `Ta demande pour ${assoc?.name ?? "l'association"} a été acceptée ✓`,
      data: { associationId: id },
    });
    return updated;
  }

  async rejectJoinRequest(actorId: string, id: string, targetUserId: string, reason?: string) {
    await this.assertRole(actorId, id, ['admin', 'moderator']);
    const member = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('Pending request not found');
    if (member.status !== 'pending') {
      throw new BadRequestException('Request is not pending');
    }

    const updated = await this.prisma.associationMember.update({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
      data: { status: 'rejected' },
    });
    const assoc = await this.prisma.association.findUnique({
      where: { id },
      select: { name: true },
    });
    await this.notifications.create({
      userId: targetUserId,
      actorId,
      type: 'association_join_rejected',
      title: `Ta demande pour ${assoc?.name ?? "l'association"} n'a pas été acceptée`,
      body: reason,
      data: { associationId: id, reason: reason ?? null },
    });
    return updated;
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
