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
import { S3Service } from '../common/storage/s3.service';
import { MailerService } from '../common/mail/mailer.service';
import { slugify } from '../common/text/slugify';
import { ASSOCIATION_MEDIA_QUOTA_BYTES } from './association-storage';
import type {
  AssociationMediaPresignDto,
  ChangeRoleDto,
  CreateAssociationDto,
  CreateEventDto,
  DesignateOfficerDto,
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

// Fields any authenticated member can read via list()/getById()/listMine().
// Deliberately excludes verifiedById/verificationNote (internal — who at the
// platform certified it and why, see A5), pendingOwnerId/pendingOwnerInvitedAt
// (an in-progress ownership transfer isn't public) and deletedAt/normalizedName
// (internal bookkeeping). `verifiedAt` alone is public — the mobile "Vérifiée
// le …" label.
//
// A1 — `createdById`/`createdBy` are excluded too. `listMembers` is now open
// to any authenticated user by default (course-corrected — see its own
// comment below), so the founder IS reachable there as the `owner` role in
// the roster — an association can only pull that back with
// `membersVisibility = 'members_only'`. What this select still refuses is
// naming the founder on the LIGHTER surfaces too (list()/getById()/
// listMine()), which have no visibility knob at all: for a `religieux`
// association (RGPD art.9), "who founded it" is the single most sensitive
// membership fact, and every one of those surfaces is unconditionally public.
// Founding is not the consented, public act that sitting on the board is (A4
// `listOfficers`) — the founder is simply the `owner` in the roster, and the
// roster is the one surface with a visibility setting.
const ASSOCIATION_PUBLIC_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  coverUrl: true,
  category: true,
  countryCode: true,
  city: true,
  website: true,
  contactEmail: true,
  isVerified: true,
  verifiedAt: true,
  requiresApproval: true,
  // A1 — public setting (like `requiresApproval`): a prospective member needs
  // to know, before joining, whether the roster will be nominatively visible
  // to them or not.
  membersVisibility: true,
  memberCount: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.AssociationSelect;

// The two roles that keep an association "run" (A2/A3). Both the
// last-admin-style guards (leave/changeRole) and the account-deletion orphan
// guard (reassignOwnershipBeforeDeletion) reason about this set, not just
// 'admin' alone, now that 'owner' exists.
const ELEVATED_ROLES: AssociationRole[] = ['owner', 'admin'];

export type AssociationOwnershipEvent =
  | {
      kind: 'transferred';
      associationId: string;
      associationName: string;
      successorId: string;
      newRole: 'owner' | 'admin';
    }
  | { kind: 'dissolved'; associationId: string };

@Injectable()
export class AssociationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly geo: GeoService,
    private readonly s3: S3Service,
    private readonly mailer: MailerService,
  ) {}

  async create(creatorId: string, dto: CreateAssociationDto) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { identityStatus: true },
    });
    if (!creator || creator.identityStatus !== 'approved') {
      throw new ForbiddenException('Identity verification required to create an association');
    }

    // Bind client-supplied media to objects this user uploaded under their own
    // prefix (ownership + HEAD + MIME/size checks). Stops SSRF / foreign-URL /
    // cross-user-object injection through logo/cover.
    const logoUrl = dto.logoUrl
      ? await this.s3.assertOwnedPublicImage(dto.logoUrl, creatorId)
      : null;
    const coverUrl = dto.coverUrl
      ? await this.s3.assertOwnedPublicImage(dto.coverUrl, creatorId)
      : null;

    // A6 — anti-squat. slug/normalizedName are the SAME computed value today
    // (see the model comment); a unique-constraint collision means someone
    // already holds this name.
    const slug = slugify(dto.name);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const assoc = await tx.association.create({
          data: {
            name: dto.name,
            slug,
            normalizedName: slug,
            description: dto.description ?? null,
            logoUrl,
            coverUrl,
            category: dto.category,
            countryCode: dto.countryCode ?? null,
            city: dto.city ?? null,
            website: dto.website ?? null,
            contactEmail: dto.contactEmail ?? null,
            requiresApproval: dto.requiresApproval ?? false,
            // A1 — default 'public' (matches the DB default), but the
            // founder can close it right from creation instead of always
            // needing a follow-up PATCH.
            membersVisibility: dto.membersVisibility ?? 'public',
            createdById: creatorId,
            memberCount: 1,
          },
        });
        // A3 — the founder is the owner, not a plain admin: nobody (short of
        // the ownership-transfer accept flow) can ever demote them.
        await tx.associationMember.create({
          data: { associationId: assoc.id, userId: creatorId, role: 'owner', status: 'approved' },
        });
        return assoc;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('An association with this name already exists');
      }
      throw e;
    }

    // Surface the new association on the map immediately (bypass the TTL).
    await this.geo.invalidateMarkerCache();
    return created;
  }

  /**
   * Delete an association. Only its owner or an admin may do this; the
   * cascade in the schema removes members/events. Mirrors PageService. This
   * is a HARD delete (distinct from the A2 soft-delete `deletedAt` path,
   * which only fires automatically when the last responsible member's
   * account is removed) — an admin/owner explicitly asking to delete their
   * own association still means it.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.assertRole(userId, id, ['admin', 'owner']);
    await this.prisma.association.delete({ where: { id } });
    await this.geo.invalidateMarkerCache();
  }

  async list(dto: ListAssociationsDto) {
    const where: Prisma.AssociationWhereInput = { deletedAt: null };
    if (dto.category) where.category = dto.category;
    if (dto.country) where.countryCode = dto.country;

    const items = await this.prisma.association.findMany({
      where,
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: [{ memberCount: 'desc' }, { createdAt: 'desc' }],
      select: ASSOCIATION_PUBLIC_SELECT,
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async listMine(userId: string) {
    const memberships = await this.prisma.associationMember.findMany({
      where: { userId, status: 'approved', association: { deletedAt: null } },
      orderBy: { joinedAt: 'desc' },
      include: {
        association: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            logoUrl: true,
            coverUrl: true,
            category: true,
            city: true,
            countryCode: true,
            memberCount: true,
            isVerified: true,
            verifiedAt: true,
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
    const assoc = await this.prisma.association.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...ASSOCIATION_PUBLIC_SELECT,
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
    await this.assertRole(userId, id, ['admin', 'owner']);
    // Re-bind media on partial updates too — same guard as create.
    const data: Prisma.AssociationUpdateInput = { ...dto };
    if (dto.logoUrl !== undefined) {
      data.logoUrl = await this.s3.assertOwnedPublicImage(dto.logoUrl, userId);
    }
    if (dto.coverUrl !== undefined) {
      data.coverUrl = await this.s3.assertOwnedPublicImage(dto.coverUrl, userId);
    }
    // `slug` never changes (A6 — it's the stable URL/anti-squat key). A rename
    // still re-checks name-uniqueness, just on `normalizedName`, so a rename
    // can't silently collide with another association's name either.
    if (dto.name !== undefined) {
      data.normalizedName = slugify(dto.name);
    }
    try {
      // Same projection as list()/getById(): the raw row carries the A5
      // moderation note (written by a platform admin ABOUT this association's
      // admins, i.e. the very caller here) plus verifiedById/pendingOwnerId/
      // deletedAt/normalizedName, none of which a PATCH response should leak.
      return await this.prisma.association.update({
        where: { id },
        data,
        select: ASSOCIATION_PUBLIC_SELECT,
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('An association with this name already exists');
      }
      throw e;
    }
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

    const assoc = await this.prisma.association.findFirst({
      where: { id, deletedAt: null },
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

      // Notify every admin/owner of the association.
      const requester = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, firstName: true },
      });
      const requesterName = requester?.displayName || requester?.firstName || 'Un membre';
      const admins = await this.prisma.associationMember.findMany({
        where: { associationId: id, role: { in: ELEVATED_ROLES }, status: 'approved' },
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
   * Invite a user to the association. Admins/moderators/owner only. We don't
   * create a membership row here — the invite is a prompt: the target taps
   * the `association_invite` notification, lands on the association page and
   * joins through the normal flow (which respects `requiresApproval`).
   */
  async inviteMember(actorId: string, id: string, targetUserId: string) {
    await this.assertRole(actorId, id, ['admin', 'moderator', 'owner']);
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
    await this.assertRole(userId, id, ['admin', 'moderator', 'owner']);
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
    await this.assertRole(actorId, id, ['admin', 'moderator', 'owner']);
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
    await this.assertRole(actorId, id, ['admin', 'moderator', 'owner']);
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

  /**
   * Leave the association — or withdraw a still-pending join request, which
   * lands here too (same row, same DELETE).
   */
  async leave(userId: string, id: string): Promise<void> {
    const member = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId } },
    });
    if (!member) throw new NotFoundException('Not a member');
    if (member.status === 'approved' && ELEVATED_ROLES.includes(member.role)) {
      // Count only APPROVED holders: a leftover non-approved row carrying an
      // elevated role would otherwise pass for a second responsible member and
      // let the real last one walk out, leaving the association headless — the
      // exact state A2 exists to prevent.
      const elevatedCount = await this.prisma.associationMember.count({
        where: { associationId: id, status: 'approved', role: { in: ELEVATED_ROLES } },
      });
      if (elevatedCount <= 1) {
        throw new BadRequestException('Cannot leave: you are the last admin/owner');
      }
    }
    await this.prisma.$transaction([
      this.prisma.associationMember.delete({
        where: { associationId_userId: { associationId: id, userId } },
      }),
      // A4 — a board seat cannot outlive the membership it rests on. Without
      // this, whoever accepted a seat and then left stays publicly listed as
      // "Président" of an association they are no longer part of, on the one
      // surface (listOfficers) that is readable without being a member.
      // removeOfficer can undo it by hand, but nothing forced anyone to.
      this.prisma.associationOfficer.deleteMany({
        where: { associationId: id, userId },
      }),
      // `memberCount` is the one public number this sprint deliberately keeps
      // open, so it must only ever mirror APPROVED members. A pending or
      // rejected request was never counted in (join() increments only on
      // auto-approve, approveJoinRequest() on approval), so withdrawing it
      // must not decrement: otherwise join → leave → join → leave on any
      // approval-gated association drives its public member count arbitrarily
      // negative, for any authenticated user, as many times as they like.
      ...(member.status === 'approved'
        ? [
            this.prisma.association.update({
              where: { id },
              data: { memberCount: { decrement: 1 } },
            }),
          ]
        : []),
    ]);
  }

  /**
   * A3 — governance. `owner` is excluded from `dto.role` at the DTO level
   * (only settable via the ownership-transfer accept flow), and the target's
   * CURRENT role is checked here too: an `admin` may never touch another
   * `admin` (only the `owner` arbitrates between admins), and NOBODY may
   * demote the `owner` through this generic endpoint.
   */
  async changeRole(actorId: string, id: string, targetUserId: string, dto: ChangeRoleDto) {
    const actor = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId: actorId } },
      select: { role: true, status: true },
    });
    if (!actor || actor.status !== 'approved' || !ELEVATED_ROLES.includes(actor.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    const target = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
      select: { role: true, status: true },
    });
    if (!target || target.status !== 'approved') {
      throw new NotFoundException('Member not found');
    }

    // The owner can only be changed through the ownership-transfer accept
    // flow, never this generic PATCH — not even by themselves.
    if (target.role === 'owner') {
      throw new BadRequestException('Use the ownership transfer flow to change the owner');
    }
    // An admin promoted yesterday must not be able to strip another admin's
    // rights (or the founder's, but that's already covered above) — only the
    // owner arbitrates between admins. Self-demotion (handled below) is exempt.
    if (actor.role === 'admin' && target.role === 'admin' && actorId !== targetUserId) {
      throw new ForbiddenException("An admin cannot change another admin's role");
    }

    // `leave` already refuses to let the last elevated member (owner/admin)
    // walk out. Demoting yourself is the same exit through another door — so
    // the count has to be the same one, APPROVED holders only: a leftover
    // non-approved row carrying an elevated role would otherwise pass for a
    // second responsible member and let the real last one step down, leaving
    // the association headless.
    if (actorId === targetUserId && !ELEVATED_ROLES.includes(dto.role)) {
      const elevatedCount = await this.prisma.associationMember.count({
        where: { associationId: id, status: 'approved', role: { in: ELEVATED_ROLES } },
      });
      if (elevatedCount <= 1) {
        throw new BadRequestException('Cannot step down: you are the last admin/owner');
      }
    }

    const updated = await this.prisma.associationMember.update({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
      data: { role: dto.role },
    });

    await this.prisma.associationRoleAudit
      .create({
        data: {
          associationId: id,
          actorId,
          targetUserId,
          fromRole: target.role,
          toRole: dto.role,
        },
      })
      .catch(() => undefined);

    await this.notifications
      .create({
        userId: targetUserId,
        actorId,
        type: 'association_role_changed',
        title: 'Ton rôle a changé dans une association',
        body: `Tu es maintenant ${dto.role}.`,
        data: { associationId: id, fromRole: target.role, toRole: dto.role },
      })
      .catch(() => undefined);

    return updated;
  }

  // ── A3 — ownership transfer (opt-in on the receiving end) ────────────────

  async requestOwnershipTransfer(actorId: string, id: string, targetUserId: string) {
    await this.assertRole(actorId, id, ['owner']);
    if (targetUserId === actorId) {
      throw new BadRequestException('You already own this association');
    }
    const target = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId: targetUserId } },
      select: { status: true },
    });
    if (!target || target.status !== 'approved') {
      throw new BadRequestException('Only an approved member can receive ownership');
    }

    const assoc = await this.prisma.association.update({
      where: { id },
      data: { pendingOwnerId: targetUserId, pendingOwnerInvitedAt: new Date() },
      select: { id: true, name: true },
    });

    await this.notifications
      .create({
        userId: targetUserId,
        actorId,
        type: 'association_ownership_transfer',
        title: `On te propose de devenir propriétaire de ${assoc.name}`,
        body: "Tu peux accepter ou refuser depuis la page de l'association.",
        data: { associationId: id },
      })
      .catch(() => undefined);

    return { pending: true };
  }

  async acceptOwnershipTransfer(userId: string, id: string) {
    const assoc = await this.prisma.association.findUnique({
      where: { id },
      select: { id: true, name: true, pendingOwnerId: true },
    });
    if (!assoc || assoc.pendingOwnerId !== userId) {
      throw new ForbiddenException('No ownership transfer pending for you');
    }

    const newOwnerMember = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId } },
      select: { role: true, status: true },
    });
    if (!newOwnerMember || newOwnerMember.status !== 'approved') {
      throw new BadRequestException('You are no longer an approved member');
    }

    const previousOwner = await this.prisma.$transaction(async (tx) => {
      // Claim the offer ATOMICALLY. The read above is only a fast 403 for the
      // common case; re-checking `pendingOwnerId` here as part of the write is
      // what makes the accept safe. Without it, an offer that was cancelled
      // (or re-pointed at somebody else) between the read and the write would
      // still be honoured: a member whose offer the owner had withdrawn could
      // land a stale accept and take the association from under them, and two
      // concurrent accepts could both demote the same owner.
      const claimed = await tx.association.updateMany({
        where: { id, pendingOwnerId: userId },
        data: { pendingOwnerId: null, pendingOwnerInvitedAt: null },
      });
      if (claimed.count === 0) {
        throw new ForbiddenException('No ownership transfer pending for you');
      }

      // Read inside the transaction too — the outgoing owner must be the one
      // in place at claim time, not at read time.
      const outgoing = await tx.associationMember.findFirst({
        where: { associationId: id, role: 'owner', status: 'approved' },
        select: { userId: true },
      });

      await tx.associationMember.update({
        where: { associationId_userId: { associationId: id, userId } },
        data: { role: 'owner' },
      });
      await tx.associationRoleAudit.create({
        data: {
          associationId: id,
          actorId: userId,
          targetUserId: userId,
          fromRole: newOwnerMember.role,
          toRole: 'owner',
        },
      });
      if (outgoing && outgoing.userId !== userId) {
        await tx.associationMember.update({
          where: { associationId_userId: { associationId: id, userId: outgoing.userId } },
          data: { role: 'admin' },
        });
        await tx.associationRoleAudit.create({
          data: {
            associationId: id,
            actorId: userId,
            targetUserId: outgoing.userId,
            fromRole: 'owner',
            toRole: 'admin',
          },
        });
      }
      return outgoing;
    });

    if (previousOwner && previousOwner.userId !== userId) {
      await this.notifications
        .create({
          userId: previousOwner.userId,
          actorId: userId,
          type: 'association_role_changed',
          title: `La propriété de ${assoc.name} a été transférée`,
          body: "Tu restes administrateur de l'association.",
          data: { associationId: id },
        })
        .catch(() => undefined);
    }

    return { transferred: true };
  }

  /**
   * Either side of a pending transfer can end it: the invitee declines, or
   * the current owner cancels their own offer. Same effect (clear the pending
   * fields), different person notified.
   */
  async declineOrCancelOwnershipTransfer(userId: string, id: string) {
    const assoc = await this.prisma.association.findUnique({
      where: { id },
      select: { pendingOwnerId: true },
    });
    if (!assoc || !assoc.pendingOwnerId) {
      throw new NotFoundException('No ownership transfer pending');
    }
    const owner = await this.prisma.associationMember.findFirst({
      where: { associationId: id, role: 'owner', status: 'approved' },
      select: { userId: true },
    });
    const isInvitee = assoc.pendingOwnerId === userId;
    const isCurrentOwner = owner?.userId === userId;
    if (!isInvitee && !isCurrentOwner) {
      throw new ForbiddenException('Not part of this transfer');
    }

    await this.prisma.association.update({
      where: { id },
      data: { pendingOwnerId: null, pendingOwnerInvitedAt: null },
    });

    const notifyTarget = isInvitee ? owner?.userId : assoc.pendingOwnerId;
    if (notifyTarget) {
      await this.notifications
        .create({
          userId: notifyTarget,
          actorId: userId,
          type: 'association_ownership_transfer',
          title: isInvitee
            ? 'Le transfert de propriété a été refusé'
            : 'Le transfert de propriété a été annulé',
          data: { associationId: id },
        })
        .catch(() => undefined);
    }
    return { cancelled: true };
  }

  /**
   * A1 (course-corrected) — the roster IS the point: you join an association
   * to meet compatriots, which means you have to be able to see who's there
   * BEFORE you join, not after. So by default any authenticated
   * NigerConnect user (`viewerId` — the caller is already past the auth
   * guard, no anonymous access) can list it. An association's own
   * admin/owner can close that back down to "approved members only" via
   * `membersVisibility` (updateAssociationSchema) — e.g. a `religieux` or
   * political association where naming members can expose family still
   * in-country. That's the association's call, not ours, which is why the
   * default is the open one.
   *
   * What stays gated no matter the setting:
   * - `privacyLevel = 'private'` members — they opted out of being listed
   *   anywhere (map/feed/search/proximity, see CLAUDE.md), and joining an
   *   open-roster association doesn't override that per-user choice.
   * - Both directions of `Block` — a block has to actually mean something.
   * Animated (bot) accounts, by contrast, are DELIBERATELY not excluded here
   * — see the isAnimated note below.
   *
   * `memberCount` stays public and unaffected either way — only the
   * nominative list is gated.
   */
  async listMembers(viewerId: string, id: string, cursor?: string, limit = 30) {
    const assoc = await this.prisma.association.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, membersVisibility: true },
    });
    if (!assoc) throw new NotFoundException('Association not found');
    if (assoc.membersVisibility === 'members_only') {
      await this.assertApprovedMember(viewerId, id);
    }

    const blockedIds = await this.blockedIds(viewerId);

    const items = await this.prisma.associationMember.findMany({
      where: {
        associationId: id,
        status: 'approved',
        user: {
          privacyLevel: { not: 'private' },
          // Animation accounts are visible everywhere else (map, feed,
          // search — see the recent "les comptes apparaissent sur la carte,
          // comme les autres" direction) and MUST be visible here too: an
          // animated account already counts in `memberCount` (join()/
          // approveJoinRequest() never excluded them), so hiding it from
          // THIS list while it still inflates that count would make the gap
          // between memberCount and the list length reveal its existence by
          // subtraction — exactly the leak the map/feed/search consistency
          // rule exists to prevent.
          ...(blockedIds.length ? { id: { notIn: blockedIds } } : {}),
        },
      },
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

  // ── A4 — bureau exécutif (axe distinct du rôle technique) ─────────────────

  async designateOfficer(actorId: string, id: string, dto: DesignateOfficerDto) {
    await this.assertRole(actorId, id, ['admin', 'owner']);
    const target = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId: id, userId: dto.userId } },
      select: { status: true },
    });
    if (!target || target.status !== 'approved') {
      throw new BadRequestException('Only an approved member can be designated');
    }
    const existing = await this.prisma.associationOfficer.findUnique({
      where: { associationId_userId: { associationId: id, userId: dto.userId } },
    });
    if (existing) {
      throw new ConflictException('This member already holds (or was offered) a board seat');
    }

    const officer = await this.prisma.associationOfficer.create({
      data: {
        associationId: id,
        userId: dto.userId,
        title: dto.title,
        customTitle: dto.title === 'other' ? (dto.customTitle ?? null) : null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    const assoc = await this.prisma.association.findUnique({ where: { id }, select: { name: true } });
    await this.notifications
      .create({
        userId: dto.userId,
        actorId,
        type: 'association_officer_invite',
        title: `On te propose une place au bureau de ${assoc?.name ?? "l'association"}`,
        body: 'Ta fonction ne sera visible qu\'après ton acceptation.',
        data: { associationId: id, title: dto.title, customTitle: dto.customTitle ?? null },
      })
      .catch(() => undefined);

    return officer;
  }

  /**
   * The invitee's explicit consent to a nominative, public exposure ("siéger
   * au bureau est un acte public consenti"). Idempotent — accepting twice is
   * a no-op, not an error.
   */
  async acceptOfficerSeat(userId: string, id: string) {
    const officer = await this.prisma.associationOfficer.findUnique({
      where: { associationId_userId: { associationId: id, userId } },
    });
    if (!officer) throw new NotFoundException('No board seat proposed to you');
    if (officer.acceptedAt) return officer;
    return this.prisma.associationOfficer.update({
      where: { associationId_userId: { associationId: id, userId } },
      data: { acceptedAt: new Date() },
    });
  }

  /**
   * Either the officer themselves (withdraw, any time — accepted or still
   * pending) or an admin/owner (revoke a seat) can remove it.
   */
  async removeOfficer(actorId: string, id: string, targetUserId: string): Promise<void> {
    if (actorId !== targetUserId) {
      await this.assertRole(actorId, id, ['admin', 'owner']);
    }
    try {
      await this.prisma.associationOfficer.delete({
        where: { associationId_userId: { associationId: id, userId: targetUserId } },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        throw new NotFoundException('Board seat not found');
      }
      throw e;
    }
  }

  /**
   * Public within the association: visible to anyone who can see the
   * association at all, including a `privacyLevel = 'private'` viewer/subject
   * — sitting on the board is explicit, accepted public exposure and doesn't
   * change that member's visibility anywhere else (map/feed/search). Only
   * ACCEPTED seats are returned — a pending invite is never shown.
   */
  async listOfficers(id: string) {
    return this.prisma.associationOfficer.findMany({
      where: {
        associationId: id,
        // Only ACCEPTED seats — a pending invite is never shown (A4).
        acceptedAt: { not: null },
        // …and never for a dissolved association (A2).
        association: { deletedAt: null },
      },
      orderBy: [{ sortOrder: 'asc' }, { acceptedAt: 'asc' }],
      include: { user: { select: MEMBER_SELECT } },
    });
  }

  // ── ADR-002 — médias portés par une association ──────────────────────────

  /**
   * Sign an upload into the association's own media space.
   *
   * The key prefix `associations/{id}/` is shared by every officer, so unlike
   * `users/{id}/` it proves nothing on its own: the role is checked HERE,
   * before any URL is handed out. Skipping this check would let any signed-in
   * user drop objects into an association's space — never attached, never
   * displayed, but stored on our disk and served by the CDN.
   *
   * Same three roles that may publish or announce an event: whoever may speak
   * for the association may upload the image that goes with it.
   */
  async presignMedia(userId: string, id: string, dto: AssociationMediaPresignDto) {
    await this.assertRole(userId, id, ['admin', 'moderator', 'owner']);
    return this.s3.createPresignedUpload({
      folder: `associations/${id}`,
      contentType: dto.contentType,
      visibility: 'public',
    });
  }

  /**
   * What this association currently occupies, and its ceiling (B5).
   *
   * Reserved to its officers: how full an association's storage is says
   * something about its activity that nothing else exposes, and only the
   * people who can free space need to see it.
   */
  async getStorage(userId: string, id: string) {
    await this.assertRole(userId, id, ['admin', 'moderator', 'owner']);
    const assoc = await this.prisma.association.findFirst({
      where: { id, deletedAt: null },
      select: { mediaBytes: true },
    });
    if (!assoc) throw new NotFoundException('Association not found');
    return {
      usedBytes: assoc.mediaBytes,
      quotaBytes: ASSOCIATION_MEDIA_QUOTA_BYTES,
    };
  }

  // ── Events ──────────────────────────────────────────────────
  async createEvent(userId: string, id: string, dto: CreateEventDto) {
    await this.assertRole(userId, id, ['admin', 'moderator', 'owner']);
    const coverUrl = dto.coverUrl
      ? await this.s3.assertOwnedPublicImage(dto.coverUrl, userId)
      : null;
    return this.prisma.associationEvent.create({
      data: {
        associationId: id,
        title: dto.title,
        description: dto.description ?? null,
        eventDate: new Date(dto.eventDate),
        location: dto.location ?? null,
        coverUrl,
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
      where: { eventDate: { gte: new Date() }, association: { deletedAt: null } },
      orderBy: { eventDate: 'asc' },
      take: limit,
      include: {
        association: { select: { id: true, name: true, logoUrl: true, countryCode: true } },
      },
    });
  }

  // ── A2 — no orphaned association on account deletion ─────────────────────

  /**
   * Called from ProfileService.deleteAccount BEFORE the cascading
   * `user.delete()`, inside the SAME transaction (the cascade removes this
   * user's association_members row, so anything reading membership must run
   * first). For every association where this user is the LAST elevated
   * member (owner/admin), either promotes a successor (oldest approved
   * moderator, else oldest approved member — preserving the 'owner' role if
   * that's what the departing user held, so the association never becomes
   * permanently ownerless) or, if nobody else is left at all, soft-deletes
   * the association (`deletedAt`) so an abandoned, member-less org doesn't
   * linger in public listings.
   *
   * Returns the side-effects (notification/email) to run AFTER the
   * transaction commits — I/O must not happen inside an open DB transaction.
   */
  async reassignOwnershipBeforeDeletion(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<AssociationOwnershipEvent[]> {
    const elevatedMemberships = await tx.associationMember.findMany({
      where: { userId, status: 'approved', role: { in: ELEVATED_ROLES } },
      select: { associationId: true, role: true },
    });
    if (elevatedMemberships.length === 0) return [];

    const events: AssociationOwnershipEvent[] = [];
    for (const m of elevatedMemberships) {
      const remainingElevated = await tx.associationMember.count({
        where: {
          associationId: m.associationId,
          status: 'approved',
          role: { in: ELEVATED_ROLES },
          userId: { not: userId },
        },
      });
      if (remainingElevated > 0) continue; // someone else still runs it

      const successor =
        (await tx.associationMember.findFirst({
          where: {
            associationId: m.associationId,
            status: 'approved',
            role: 'moderator',
            userId: { not: userId },
          },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true, role: true },
        })) ??
        (await tx.associationMember.findFirst({
          where: {
            associationId: m.associationId,
            status: 'approved',
            role: 'member',
            userId: { not: userId },
          },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true, role: true },
        }));

      if (successor) {
        const newRole: 'owner' | 'admin' = m.role === 'owner' ? 'owner' : 'admin';
        await tx.associationMember.update({
          where: { associationId_userId: { associationId: m.associationId, userId: successor.userId } },
          data: { role: newRole },
        });
        await tx.associationRoleAudit.create({
          data: {
            associationId: m.associationId,
            actorId: userId,
            targetUserId: successor.userId,
            fromRole: successor.role,
            toRole: newRole,
          },
        });
        const assoc = await tx.association.findUnique({
          where: { id: m.associationId },
          select: { name: true },
        });
        events.push({
          kind: 'transferred',
          associationId: m.associationId,
          associationName: assoc?.name ?? 'ton association',
          successorId: successor.userId,
          newRole,
        });
      } else {
        await tx.association.update({
          where: { id: m.associationId },
          data: { deletedAt: new Date() },
        });
        events.push({ kind: 'dissolved', associationId: m.associationId });
      }
    }
    return events;
  }

  /** Best-effort in-app + email notice for each `reassignOwnershipBeforeDeletion` event. */
  async notifyOwnershipEvents(events: AssociationOwnershipEvent[]): Promise<void> {
    await Promise.all(
      events.map(async (e) => {
        if (e.kind !== 'transferred') return;

        await this.notifications
          .create({
            userId: e.successorId,
            type: 'association_role_changed',
            title:
              e.newRole === 'owner'
                ? `Tu es maintenant propriétaire de ${e.associationName}`
                : `Tu es maintenant administrateur de ${e.associationName}`,
            body:
              "Le précédent responsable a supprimé son compte ; la gestion t'a été transférée automatiquement.",
            data: { associationId: e.associationId, role: e.newRole },
          })
          .catch(() => undefined);

        const successor = await this.prisma.user.findUnique({
          where: { id: e.successorId },
          select: { email: true, emailVerified: true, firstName: true },
        });
        if (successor?.email && successor.emailVerified) {
          await this.mailer
            .sendAssociationRoleGranted(successor.email, e.newRole, e.associationName, successor.firstName)
            .catch(() => undefined);
        }
      }),
    );
  }

  /**
   * Extension point — a capability, not a full framework. `assertRole` above
   * only ever answers "does this user run THIS association?"; some future
   * consumers need the coarser "does this user run ANY association [in this
   * country]?" instead.
   *
   * Concretely: docs/REALISATIONS.md (the "Réalisations" vitrine, spec'd but
   * deliberately NOT started yet — see its header) plans to let a
   * "dirigeant d'association du pays concerné" validate a pending
   * `Realisation` row, without that moderator needing to be an
   * owner/admin/moderator of one SPECIFIC association tied to the fiche.
   * That module — once it exists — calls this from its own service via
   * `AssociationModule`'s export (see association.module.ts) instead of
   * reaching into `assertRole`/ELEVATED_ROLES directly. Deliberately NOT
   * built further than this: a moderation queue, review UI, or
   * `Realisation` model would be speculative work against a chantier that
   * hasn't started, and risks colliding with the moderation work in
   * progress elsewhere in the codebase right now.
   */
  async isLeaderOfAnyAssociation(
    userId: string,
    opts?: { countryCode?: string },
  ): Promise<boolean> {
    const count = await this.prisma.associationMember.count({
      where: {
        userId,
        status: 'approved',
        role: { in: ELEVATED_ROLES },
        association: {
          deletedAt: null,
          ...(opts?.countryCode ? { countryCode: opts.countryCode } : {}),
        },
      },
    });
    return count > 0;
  }

  private async assertApprovedMember(userId: string, associationId: string): Promise<void> {
    const member = await this.prisma.associationMember.findUnique({
      where: { associationId_userId: { associationId, userId } },
      select: { status: true },
    });
    if (!member || member.status !== 'approved') {
      throw new ForbiddenException('Members only');
    }
  }

  private async blockedIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    return Array.from(
      new Set(rows.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId))),
    );
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
