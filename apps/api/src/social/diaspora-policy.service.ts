import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { SettingsService } from '../common/settings/settings.service';

const CACHE_TTL = 300;

/** ISO-3166-1 alpha-2 for Niger. Members living here are not the diaspora. */
const HOME_COUNTRY = 'NE';

/**
 * NigerConnect connects the Nigerien DIASPORA. Two rules, with two different
 * shapes — read them together, they are easy to confuse:
 *
 * CONTACT is one-directional (`mayInitiateContact`). A member living in Niger
 * may not reach OUT to a diaspora member — no friend request, no first message.
 * The diaspora keeps the right to contact family back home, and once they have
 * opened the exchange the home-based member may answer (`mayReply`). Existing
 * friendships and conversations are grandfathered.
 *
 * CONTENT is symmetric (`authorScope`). Each side sees only its own posts,
 * stories, comments, reactions, polls and reviews. Two feeds, side by side.
 *
 * MEMBERS are never split. Profiles, search and the map stay whole — hiding
 * home-based members would silently cancel the contact right above: you cannot
 * write to family you can no longer find.
 *
 * EXEMPT entirely: services (marketplace) and associations, which are community
 * resources meant to reach everyone.
 *
 * A member who has not filled in their country is treated as home-based. That
 * closes the obvious bypass (leave the field empty), at the cost of holding back
 * OAuth signups that skipped the registration form — which is why the refusal
 * message tells them exactly what to fix.
 *
 * ALL THREE behaviours are admin switches, ON by default and independent, so the
 * owner can relax one without relaxing the others from the console, with no
 * deploy: `diaspora_contact_restriction`, `diaspora_content_split` and
 * `diaspora_unknown_country_restricted` (see SettingsService).
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
    const country = await this.countryOf(userId);
    if (country === HOME_COUNTRY) return true;
    if (country !== null) return false;
    // No country on file. Whether that counts as living in Niger is an admin
    // decision, read here and NOT baked into the cache below — otherwise
    // flipping the switch would leave stale verdicts behind for 5 minutes.
    return this.settings.isDiasporaUnknownCountryRestricted();
  }

  /**
   * Country code on file, or null. Cached 5 min in Redis, like BlockService.
   * We cache the COUNTRY, never the home/diaspora verdict: the verdict depends
   * on an admin switch, and caching it would make that switch take up to five
   * minutes to bite. The empty string stands in for "no country" because Redis
   * cannot store null.
   */
  private async countryOf(userId: string): Promise<string | null> {
    const key = `diaspora:country:${userId}`;
    const cached = await this.redis.client.get(key);
    if (cached !== null) return cached === '' ? null : cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { countryCode: true },
    });
    // Unknown user: let the caller's own existence check produce the 404.
    const value = user?.countryCode ?? '';
    await this.redis.client.set(key, value, 'EX', CACHE_TTL);
    return value === '' ? null : value;
  }

  /**
   * Prisma condition selecting the AUTHORS a viewer is allowed to see content
   * from. Null when the rule is off — callers then add nothing to their query.
   *
   * Content is split symmetrically: each side sees its own. Members, however,
   * are NOT split — profiles, search and the map stay whole, otherwise the
   * diaspora could no longer find the family it is still allowed to write to.
   * So this is for CONTENT queries only (posts, stories, comments, reactions,
   * polls, reviews). Services and associations are deliberately exempt.
   *
   * Returned as a `UserWhereInput` rather than a ready-made clause because the
   * author relation is named differently everywhere (author, user, createdBy);
   * each call site drops it onto its own relation.
   *
   * Applied inside the SQL `where`, never as a post-query filter: every one of
   * these lists is cursor-paginated, and dropping rows after the fact would
   * return short pages and a cursor pointing at a row the caller never saw.
   */
  async authorScope(viewerId: string): Promise<Prisma.UserWhereInput | null> {
    if (!(await this.settings.isDiasporaContentSplit())) return null;
    // Which side owns the members with no country depends on the admin switch,
    // so the SQL clause has to follow it too — otherwise the list and the
    // single-item check would disagree about them.
    const unknownIsHome = await this.settings.isDiasporaUnknownCountryRestricted();
    if (await this.isHomeBased(viewerId)) {
      return unknownIsHome
        ? { OR: [{ countryCode: null }, { countryCode: HOME_COUNTRY }] }
        : { countryCode: HOME_COUNTRY };
    }
    // Diaspora: a real country, and not Niger. `not: null` is required — in SQL
    // a NULL never satisfies `<> 'NE'`, but being explicit keeps the rule
    // readable in one place.
    return unknownIsHome
      ? { countryCode: { not: null, notIn: [HOME_COUNTRY] } }
      : { OR: [{ countryCode: null }, { countryCode: { not: null, notIn: [HOME_COUNTRY] } }] };
  }

  /**
   * Same split as `authorScope`, for a SINGLE known author — used where there is
   * one item to admit or refuse rather than a list to filter (a post opened by
   * its id, a profile wall). Both sides are cached, so this costs nothing.
   */
  async sharesContentScope(viewerId: string, authorId: string): Promise<boolean> {
    if (viewerId === authorId) return true;
    if (!(await this.settings.isDiasporaContentSplit())) return true;
    return (await this.isHomeBased(viewerId)) === (await this.isHomeBased(authorId));
  }

  /** Call after any write that changes a member's country. */
  async invalidate(userId: string): Promise<void> {
    await this.redis.client.del(`diaspora:country:${userId}`);
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
