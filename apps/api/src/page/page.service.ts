import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PageRole, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { GeoService } from '../geo/geo.service';
import { USER_PUBLIC_SELECT } from '../common/prisma/user-select';
import type {
  ChangePageRoleDto,
  CreatePageDto,
  ListPagesDto,
  UpdatePageDto,
} from './dto/page.dto';

@Injectable()
export class PageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly geo: GeoService,
  ) {}

  async create(creatorId: string, dto: CreatePageDto) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { identityStatus: true },
    });
    if (!creator || creator.identityStatus !== 'approved') {
      throw new ForbiddenException('Identity verification required to create a page');
    }

    const page = await this.prisma.$transaction(async (tx) => {
      const created = await tx.page.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          kind: dto.kind,
          avatarUrl: dto.avatarUrl ?? null,
          coverUrl: dto.coverUrl ?? null,
          countryCode: dto.countryCode ?? null,
          city: dto.city ?? null,
          website: dto.website ?? null,
          contactEmail: dto.contactEmail ?? null,
          createdById: creatorId,
          followerCount: 1,
        },
      });
      // Creator is the founding admin and an implicit follower.
      await tx.pageAdmin.create({
        data: { pageId: created.id, userId: creatorId, role: 'admin' },
      });
      await tx.pageFollower.create({
        data: { pageId: created.id, userId: creatorId },
      });
      return created;
    });

    // Surface the new page on the map immediately (bypass the marker TTL).
    await this.geo.invalidateMarkerCache();
    return page;
  }

  async list(dto: ListPagesDto) {
    const where: Prisma.PageWhereInput = {};
    if (dto.kind) where.kind = dto.kind;
    if (dto.country) where.countryCode = dto.country;
    if (dto.q) where.name = { contains: dto.q, mode: 'insensitive' };

    const items = await this.prisma.page.findMany({
      where,
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: [{ followerCount: 'desc' }, { createdAt: 'desc' }],
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async listMine(userId: string) {
    const admin = await this.prisma.pageAdmin.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { page: { include: { createdBy: { select: USER_PUBLIC_SELECT } } } },
    });
    return admin.map((a) => ({ ...a.page, myRole: a.role }));
  }

  async getById(id: string, viewerId?: string) {
    const page = await this.prisma.page.findUnique({
      where: { id },
      include: { createdBy: { select: USER_PUBLIC_SELECT } },
    });
    if (!page) throw new NotFoundException('Page not found');

    let isFollowing = false;
    let myRole: PageRole | null = null;
    if (viewerId) {
      const [follow, admin] = await Promise.all([
        this.prisma.pageFollower.findUnique({
          where: { pageId_userId: { pageId: id, userId: viewerId } },
          select: { userId: true },
        }),
        this.prisma.pageAdmin.findUnique({
          where: { pageId_userId: { pageId: id, userId: viewerId } },
          select: { role: true },
        }),
      ]);
      isFollowing = !!follow;
      myRole = admin?.role ?? null;
    }
    return { ...page, isFollowing, myRole };
  }

  async update(userId: string, id: string, dto: UpdatePageDto) {
    await this.assertRole(userId, id, ['admin', 'editor']);
    return this.prisma.page.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertRole(userId, id, ['admin']);
    await this.prisma.page.delete({ where: { id } });
    await this.geo.invalidateMarkerCache();
  }

  async follow(userId: string, id: string) {
    const page = await this.prisma.page.findUnique({
      where: { id },
      select: { id: true, name: true, createdById: true },
    });
    if (!page) throw new NotFoundException('Page not found');

    // Let the unique PK be the arbiter so concurrent double-taps can't both
    // increment. The increment lives in the same transaction as the insert, so
    // a duplicate rolls the whole thing back instead of inflating the counter.
    try {
      await this.prisma.$transaction([
        this.prisma.pageFollower.create({ data: { pageId: id, userId } }),
        this.prisma.page.update({ where: { id }, data: { followerCount: { increment: 1 } } }),
      ]);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('Already following');
      }
      throw e;
    }

    if (page.createdById && page.createdById !== userId) {
      const follower = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, firstName: true },
      });
      const name = follower?.displayName || follower?.firstName || 'Quelqu’un';
      await this.notifications.create({
        userId: page.createdById,
        actorId: userId,
        type: 'page_follow',
        title: `${name} suit ${page.name}`,
        data: { pageId: id },
      });
    }
    return { following: true };
  }

  async unfollow(userId: string, id: string): Promise<void> {
    // Atomic: only decrement when a follower row was actually removed, so a
    // double-unfollow can't push followerCount below the real count.
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.pageFollower.deleteMany({ where: { pageId: id, userId } });
      if (deleted.count === 0) throw new NotFoundException('Not following');
      await tx.page.update({ where: { id }, data: { followerCount: { decrement: 1 } } });
    });
  }

  async listAdmins(id: string) {
    const admins = await this.prisma.pageAdmin.findMany({
      where: { pageId: id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: USER_PUBLIC_SELECT } },
    });
    return admins.map((a) => ({ user: a.user, role: a.role, createdAt: a.createdAt }));
  }

  async setAdmin(actorId: string, id: string, targetUserId: string, dto: ChangePageRoleDto) {
    await this.assertRole(actorId, id, ['admin']);
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');
    return this.prisma.pageAdmin.upsert({
      where: { pageId_userId: { pageId: id, userId: targetUserId } },
      create: { pageId: id, userId: targetUserId, role: dto.role },
      update: { role: dto.role },
    });
  }

  async removeAdmin(actorId: string, id: string, targetUserId: string): Promise<void> {
    await this.assertRole(actorId, id, ['admin']);
    if (actorId === targetUserId) {
      const adminCount = await this.prisma.pageAdmin.count({
        where: { pageId: id, role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot remove yourself: you are the last admin');
      }
    }
    await this.prisma.pageAdmin.delete({
      where: { pageId_userId: { pageId: id, userId: targetUserId } },
    });
  }

  private async assertRole(userId: string, pageId: string, roles: PageRole[]): Promise<void> {
    const admin = await this.prisma.pageAdmin.findUnique({
      where: { pageId_userId: { pageId, userId } },
      select: { role: true },
    });
    if (!admin || !roles.includes(admin.role)) {
      throw new ForbiddenException('Insufficient role');
    }
  }
}
