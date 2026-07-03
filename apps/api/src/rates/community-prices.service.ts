import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import type {
  CreateCommunityPriceDto,
  ListCommunityPricesDto,
  UpdateCommunityPriceDto,
  VoteCommunityPriceDto,
} from './dto/rate.dto';

// Anti-spam: a member may submit at most N price reports per UTC day. Same
// Redis primitive as the rest of the product (incrementCounter + TTL).
const MAX_SUBMISSIONS_PER_DAY = 5;
const DAY_SECONDS = 24 * 60 * 60;

// PII-free contributor projection. A price report must NEVER leak a
// contributor's real name (firstName/lastName) or coarse location
// (city/countryCode) — not to anonymous scrapers, not even to authenticated
// members. Only a display handle + avatar + the curated ambassador badge.
const SUBMITTER_SELECT = {
  id: true,
  displayName: true,
  avatarUrl: true,
  isAmbassador: true,
} as const satisfies Prisma.UserSelect;

const PRICE_INCLUDE = {
  submitter: { select: SUBMITTER_SELECT },
} as const satisfies Prisma.CommunityPriceInclude;

@Injectable()
export class CommunityPricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Throttle first, then persist. `submitterId` is ALWAYS the authenticated
   * caller — never a client-supplied field (anti-IDOR, mirror of
   * services.service create). Amount is stored as a Decimal string.
   */
  async create(submitterId: string, dto: CreateCommunityPriceDto) {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const key = `communityprice:submit:${submitterId}:${day}`;
    const count = await this.redis.incrementCounter(key, DAY_SECONDS);
    if (count > MAX_SUBMISSIONS_PER_DAY) {
      throw new HttpException(
        'Vous avez atteint la limite de signalements aujourd’hui',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.prisma.communityPrice.create({
      data: {
        submitterId,
        type: dto.type,
        originCity: dto.originCity ?? null,
        originCountry: dto.originCountry ?? null,
        destCity: dto.destCity ?? null,
        destCountry: dto.destCountry ?? null,
        provider: dto.provider ?? null,
        amount: dto.amount.toString(),
        currency: dto.currency,
        note: dto.note ?? null,
      },
      include: PRICE_INCLUDE,
    });
  }

  /** Owner-only edit (mutable value fields only). */
  async update(userId: string, id: string, dto: UpdateCommunityPriceDto) {
    const existing = await this.prisma.communityPrice.findUnique({
      where: { id },
      select: { submitterId: true },
    });
    if (!existing) throw new NotFoundException('Community price not found');
    if (existing.submitterId !== userId) throw new ForbiddenException('Not your price report');

    const data: Prisma.CommunityPriceUpdateInput = {};
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.amount !== undefined) data.amount = dto.amount.toString();
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.note !== undefined) data.note = dto.note;

    return this.prisma.communityPrice.update({
      where: { id },
      data,
      include: PRICE_INCLUDE,
    });
  }

  /** Owner-only delete. FK cascade drops the votes. */
  async remove(userId: string, id: string) {
    const existing = await this.prisma.communityPrice.findUnique({
      where: { id },
      select: { submitterId: true },
    });
    if (!existing) throw new NotFoundException('Community price not found');
    if (existing.submitterId !== userId) throw new ForbiddenException('Not your price report');
    await this.prisma.communityPrice.delete({ where: { id } });
  }

  async list(dto: ListCommunityPricesDto) {
    const where: Prisma.CommunityPriceWhereInput = { status: dto.status };
    if (dto.type) where.type = dto.type;
    if (dto.originCountry) where.originCountry = dto.originCountry;
    if (dto.destCountry) where.destCountry = dto.destCountry;

    const items = await this.prisma.communityPrice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      include: PRICE_INCLUDE,
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async getById(id: string) {
    const price = await this.prisma.communityPrice.findUnique({
      where: { id },
      include: PRICE_INCLUDE,
    });
    if (!price) throw new NotFoundException('Community price not found');
    return price;
  }

  mine(userId: string) {
    return this.prisma.communityPrice.findMany({
      where: { submitterId: userId },
      orderBy: { createdAt: 'desc' },
      include: PRICE_INCLUDE,
    });
  }

  /**
   * Trust vote. Toggle-idempotent (revote-same = retract), transactional so the
   * denormalised trustScore never drifts from the vote rows (mirror of
   * toggleCommentLike). Anti-auto-vote and no vote on removed content.
   */
  async vote(userId: string, id: string, dto: VoteCommunityPriceDto) {
    const price = await this.prisma.communityPrice.findUnique({
      where: { id },
      select: { submitterId: true, status: true },
    });
    if (!price) throw new NotFoundException('Community price not found');
    if (price.status === 'removed') {
      throw new ForbiddenException('Cannot vote on removed content');
    }
    if (price.submitterId === userId) {
      throw new ForbiddenException('Cannot vote on your own price report');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.communityPriceVote.findUnique({
        where: { userId_priceId: { userId, priceId: id } },
      });

      let delta: number;
      let myVote: 1 | -1 | null;
      if (!existing) {
        await tx.communityPriceVote.create({ data: { userId, priceId: id, value: dto.value } });
        delta = dto.value;
        myVote = dto.value;
      } else if (existing.value === dto.value) {
        await tx.communityPriceVote.delete({
          where: { userId_priceId: { userId, priceId: id } },
        });
        delta = -dto.value;
        myVote = null;
      } else {
        await tx.communityPriceVote.update({
          where: { userId_priceId: { userId, priceId: id } },
          data: { value: dto.value },
        });
        delta = dto.value - existing.value;
        myVote = dto.value;
      }

      const updated = await tx.communityPrice.update({
        where: { id },
        data: { trustScore: { increment: delta } },
        select: { trustScore: true },
      });
      return { priceId: id, trustScore: updated.trustScore, myVote };
    });
  }
}
