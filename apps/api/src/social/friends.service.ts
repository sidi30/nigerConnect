import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BlockService } from './block.service';

const PUBLIC_USER_FIELDS = {
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
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlockService,
    private readonly notifications: NotificationService,
  ) {}

  private async userDisplayName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    return (
      u?.displayName ||
      `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() ||
      'Un membre'
    );
  }

  async sendRequest(requesterId: string, addresseeId: string) {
    if (requesterId === addresseeId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }
    if (await this.blocks.isBlocked(requesterId, addresseeId)) {
      throw new ForbiddenException('Cannot send friend request');
    }

    const addressee = await this.prisma.user.findUnique({
      where: { id: addresseeId },
      select: { id: true },
    });
    if (!addressee) throw new NotFoundException('User not found');

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'accepted') throw new ConflictException('Already friends');
      if (existing.status === 'pending') throw new ConflictException('Friend request already exists');
      // If declined, allow re-send by updating it
      if (existing.status === 'declined') {
        return this.prisma.friendship.update({
          where: { id: existing.id },
          data: { status: 'pending', requesterId, addresseeId },
        });
      }
    }

    const friendship = await this.prisma.friendship.create({
      data: { requesterId, addresseeId, status: 'pending' },
    });
    const requesterName = await this.userDisplayName(requesterId);
    await this.notifications.create({
      userId: addresseeId,
      actorId: requesterId,
      type: 'friend_request',
      title: `${requesterName} veut être votre ami`,
      data: { friendshipId: friendship.id },
    });
    return friendship;
  }

  async accept(userId: string, friendshipId: string) {
    const f = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!f) throw new NotFoundException('Friendship not found');
    if (f.addresseeId !== userId) throw new ForbiddenException('Not the addressee');
    if (f.status !== 'pending') throw new BadRequestException('Friendship is not pending');
    const updated = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'accepted' },
    });
    const accepterName = await this.userDisplayName(userId);
    await this.notifications.create({
      userId: f.requesterId,
      actorId: userId,
      type: 'friend_accepted',
      title: `${accepterName} a accepté votre demande`,
      data: { friendshipId: f.id },
    });
    return updated;
  }

  async decline(userId: string, friendshipId: string) {
    const f = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!f) throw new NotFoundException('Friendship not found');
    if (f.addresseeId !== userId) throw new ForbiddenException('Not the addressee');
    if (f.status !== 'pending') throw new BadRequestException('Friendship is not pending');
    return this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'declined' },
    });
  }

  async removeFriend(userId: string, targetId: string): Promise<void> {
    await this.prisma.friendship.deleteMany({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: userId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: userId },
        ],
      },
    });
  }

  async listFriends(userId: string, cursor?: string, limit = 30) {
    // Cursor is friendship.id for pagination stability
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { updatedAt: 'desc' },
      include: {
        requester: { select: PUBLIC_USER_FIELDS },
        addressee: { select: PUBLIC_USER_FIELDS },
      },
    });

    const items = friendships
      .slice(0, limit)
      .map((f) => (f.requesterId === userId ? f.addressee : f.requester));
    const hasMore = friendships.length > limit;
    return {
      items,
      nextCursor: hasMore ? friendships[limit - 1]!.id : null,
    };
  }

  /**
   * Search a user's ACCEPTED friends by name prefix — backs the @mention
   * autocomplete (you can only tag people you're friends with). Returns a small
   * capped list, no pagination (it's a type-ahead).
   */
  async searchFriends(userId: string, q: string, limit = 8) {
    const nameMatch = [
      { displayName: { contains: q, mode: 'insensitive' as const } },
      { firstName: { contains: q, mode: 'insensitive' as const } },
      { lastName: { contains: q, mode: 'insensitive' as const } },
    ];
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: userId, addressee: { OR: nameMatch } },
          { addresseeId: userId, requester: { OR: nameMatch } },
        ],
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        requester: { select: PUBLIC_USER_FIELDS },
        addressee: { select: PUBLIC_USER_FIELDS },
      },
    });
    const items = friendships.map((f) => (f.requesterId === userId ? f.addressee : f.requester));
    return { items };
  }

  async pendingIncoming(userId: string) {
    return this.prisma.friendship.findMany({
      where: { addresseeId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { requester: { select: PUBLIC_USER_FIELDS } },
    });
  }

  async pendingOutgoing(userId: string) {
    return this.prisma.friendship.findMany({
      where: { requesterId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { addressee: { select: PUBLIC_USER_FIELDS } },
    });
  }

  /**
   * Relationship status between the viewer and a target user:
   *   - 'self'    : same user
   *   - 'friends' : accepted friendship
   *   - 'outgoing': viewer has sent a pending request
   *   - 'incoming': target has sent a pending request to viewer
   *   - 'blocked' : at least one side blocked the other
   *   - 'none'    : no relationship
   */
  async relationship(
    viewerId: string,
    targetId: string,
  ): Promise<{
    status: 'self' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'none';
    friendshipId: string | null;
  }> {
    if (viewerId === targetId) return { status: 'self', friendshipId: null };
    if (await this.blocks.isBlocked(viewerId, targetId)) {
      return { status: 'blocked', friendshipId: null };
    }
    const f = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: viewerId },
        ],
      },
    });
    // Mirror the profile privacy gate: a private target is invisible to anyone
    // who is not already an accepted friend — don't even disclose whether a
    // (pending/declined) relationship exists.
    if (await this.isHiddenByPrivacy(viewerId, targetId, f?.status)) {
      return { status: 'none', friendshipId: null };
    }
    if (!f) return { status: 'none', friendshipId: null };
    if (f.status === 'accepted') return { status: 'friends', friendshipId: f.id };
    if (f.status === 'pending') {
      return {
        status: f.requesterId === viewerId ? 'outgoing' : 'incoming',
        friendshipId: f.id,
      };
    }
    return { status: 'none', friendshipId: f.id };
  }

  /**
   * True when `targetId` is private and `viewerId` is not an accepted friend.
   * Used to keep relationship/mutual-friends surfaces consistent with the
   * profile privacy gate in ProfileService.getById.
   */
  private async isHiddenByPrivacy(
    viewerId: string,
    targetId: string,
    friendshipStatus?: string,
  ): Promise<boolean> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { privacyLevel: true },
    });
    if (!target || target.privacyLevel !== 'private') return false;
    return friendshipStatus !== 'accepted';
  }

  async mutualFriends(userId: string, targetId: string) {
    // Private targets only reveal mutuals to accepted friends.
    const f = await this.prisma.friendship.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: userId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: userId },
        ],
      },
      select: { status: true },
    });
    if (await this.isHiddenByPrivacy(userId, targetId, f?.status)) {
      return [];
    }
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
      }>
    >`
      WITH my_friends AS (
        SELECT CASE WHEN requester_id = ${userId}::uuid THEN addressee_id ELSE requester_id END AS friend_id
        FROM friendships
        WHERE status = 'accepted'
          AND (requester_id = ${userId}::uuid OR addressee_id = ${userId}::uuid)
      ),
      their_friends AS (
        SELECT CASE WHEN requester_id = ${targetId}::uuid THEN addressee_id ELSE requester_id END AS friend_id
        FROM friendships
        WHERE status = 'accepted'
          AND (requester_id = ${targetId}::uuid OR addressee_id = ${targetId}::uuid)
      )
      SELECT u.id, u.display_name, u.first_name, u.last_name, u.avatar_url
      FROM my_friends m
      JOIN their_friends t ON t.friend_id = m.friend_id
      JOIN users u ON u.id = m.friend_id
      WHERE u.status = 'active'
      LIMIT 50
    `;
  }

  /**
   * Suggestions: friends of friends + same country/city, excluding current friends and blocked users.
   * Score = mutualFriends * 3 + sameCity * 2 + sameCountry * 1.
   */
  async suggestions(userId: string, limit = 20) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { city: true, countryCode: true },
    });

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
        city: string | null;
        country_code: string | null;
        mutual_count: bigint;
        same_city: boolean;
        same_country: boolean;
      }>
    >`
      WITH my_friends AS (
        SELECT CASE WHEN requester_id = ${userId}::uuid THEN addressee_id ELSE requester_id END AS friend_id
        FROM friendships
        WHERE status = 'accepted'
          AND (requester_id = ${userId}::uuid OR addressee_id = ${userId}::uuid)
      ),
      excluded AS (
        SELECT friend_id AS id FROM my_friends
        UNION ALL
        SELECT ${userId}::uuid AS id
        UNION ALL
        SELECT blocked_id FROM blocks WHERE blocker_id = ${userId}::uuid
        UNION ALL
        SELECT blocker_id FROM blocks WHERE blocked_id = ${userId}::uuid
      ),
      candidates AS (
        SELECT
          u.id,
          u.display_name,
          u.first_name,
          u.last_name,
          u.avatar_url,
          u.city,
          u.country_code,
          (
            SELECT COUNT(*)
            FROM my_friends mf
            JOIN friendships f2
              ON f2.status = 'accepted'
             AND ((f2.requester_id = mf.friend_id AND f2.addressee_id = u.id)
               OR (f2.addressee_id = mf.friend_id AND f2.requester_id = u.id))
          ) AS mutual_count,
          (u.city = ${me?.city ?? null}) AS same_city,
          (u.country_code = ${me?.countryCode ?? null}) AS same_country
        FROM users u
        WHERE u.status = 'active'
          AND u.email_verified = true
          AND u.privacy_level <> 'private'
          AND u.id NOT IN (SELECT id FROM excluded)
      )
      SELECT *
      FROM candidates
      WHERE mutual_count > 0 OR same_city = TRUE OR same_country = TRUE
      ORDER BY (mutual_count * 3 + (CASE WHEN same_city THEN 2 ELSE 0 END) + (CASE WHEN same_country THEN 1 ELSE 0 END)) DESC,
               mutual_count DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      user: {
        id: r.id,
        displayName: r.display_name,
        firstName: r.first_name,
        lastName: r.last_name,
        avatarUrl: r.avatar_url,
        city: r.city,
        countryCode: r.country_code,
      },
      mutualFriends: Number(r.mutual_count),
      sameCity: r.same_city,
      sameCountry: r.same_country,
      score:
        Number(r.mutual_count) * 3 +
        (r.same_city ? 2 : 0) +
        (r.same_country ? 1 : 0),
    }));
  }
}
