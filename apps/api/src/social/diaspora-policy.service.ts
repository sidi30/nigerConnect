import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { SettingsService } from '../common/settings/settings.service';

const CACHE_TTL = 300;

/** ISO-3166-1 alpha-2 for Niger. Members living here are not the diaspora. */
const HOME_COUNTRY = 'NE';

/**
 * NigerConnect connects the Nigerien DIASPORA. Members living in Niger are
 * welcome to read the whole network and to talk among themselves, but they may
 * not reach OUT to diaspora members — no friend request, no first message.
 *
 * The restriction is one-directional on purpose: a diaspora member keeps the
 * right to contact family back home, and once they have opened the exchange the
 * home-based member may answer. Existing friendships and conversations are
 * grandfathered — see `mayReply`.
 *
 * A member who has not filled in their country is treated as home-based. That
 * closes the obvious bypass (leave the field empty), at the cost of holding back
 * OAuth signups that skipped the registration form — which is why the refusal
 * message tells them exactly what to fix.
 */
@Injectable()
export class DiasporaPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * True when the member lives in Niger, or has not told us where they live.
   * Cached 5 min in Redis, like BlockService — this is read on every send.
   */
  async isHomeBased(userId: string): Promise<boolean> {
    const key = `diaspora:home:${userId}`;
    const cached = await this.redis.client.get(key);
    if (cached !== null) return cached === '1';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { countryCode: true },
    });
    // Unknown user: let the caller's own existence check produce the 404.
    const value = !user || !user.countryCode || user.countryCode === HOME_COUNTRY ? '1' : '0';
    await this.redis.client.set(key, value, 'EX', CACHE_TTL);
    return value === '1';
  }

  /** Call after any write that changes a member's country. */
  async invalidate(userId: string): Promise<void> {
    await this.redis.client.del(`diaspora:home:${userId}`);
  }

  /**
   * May `actorId` open contact with `targetId` (friend request, new DM, first
   * message)? Only the home-based → diaspora direction is refused.
   */
  async mayInitiateContact(actorId: string, targetId: string): Promise<boolean> {
    if (!(await this.settings.isDiasporaContactRestricted())) return true;
    if (!(await this.isHomeBased(actorId))) return true;
    // Home-based to home-based is the whole point: they can talk freely.
    return this.isHomeBased(targetId);
  }

  /**
   * Throws 403 when the actor may not open contact. The two messages are
   * deliberately different: one is a rule, the other is a form to fill in, and
   * a member who simply never set their country must not be left guessing.
   */
  async assertMayInitiateContact(actorId: string, targetId: string): Promise<void> {
    if (await this.mayInitiateContact(actorId, targetId)) return;

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { countryCode: true },
    });
    throw new ForbiddenException(
      actor?.countryCode
        ? 'NigerConnect met en relation les Nigériens de la diaspora. Depuis le Niger, vous pouvez échanger avec les membres qui résident au Niger.'
        : 'Renseignez votre pays de résidence dans votre profil pour contacter les membres de la diaspora.',
    );
  }

  /**
   * May `actorId` write in an EXISTING direct conversation with `targetId`?
   *
   * Yes when the pair is already friends (relationships predating the rule stay
   * intact) or when the diaspora member has already written here — that is what
   * makes the exchange theirs to have opened.
   */
  async mayReply(actorId: string, targetId: string, conversationId: string): Promise<boolean> {
    if (await this.mayInitiateContact(actorId, targetId)) return true;

    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: actorId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: actorId },
        ],
      },
      select: { id: true },
    });
    if (friendship) return true;

    const theirMessage = await this.prisma.message.findFirst({
      where: { conversationId, senderId: targetId, deletedAt: null },
      select: { id: true },
    });
    return theirMessage !== null;
  }

  async assertMayReply(actorId: string, targetId: string, conversationId: string): Promise<void> {
    if (await this.mayReply(actorId, targetId, conversationId)) return;
    throw new ForbiddenException(
      'NigerConnect met en relation les Nigériens de la diaspora. Vous pourrez répondre dès que votre correspondant vous aura écrit.',
    );
  }
}
