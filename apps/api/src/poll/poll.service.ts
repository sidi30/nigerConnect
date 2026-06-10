import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { USER_PUBLIC_SELECT } from '../common/prisma/user-select';
import type { CreatePollDto, ListPollsDto, VotePollDto } from './dto/poll.dto';

const POLL_INCLUDE = {
  author: { select: USER_PUBLIC_SELECT },
  options: { orderBy: { sortOrder: 'asc' } },
} as const satisfies Prisma.PollInclude;

@Injectable()
export class PollService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreatePollDto) {
    if (dto.pageId) {
      // Only page admins/editors may attach a poll to a page.
      const admin = await this.prisma.pageAdmin.findUnique({
        where: { pageId_userId: { pageId: dto.pageId, userId } },
        select: { role: true },
      });
      if (!admin) throw new ForbiddenException('Only page admins can create page polls');
    }

    const expiresAt = dto.expiresInHours
      ? new Date(Date.now() + dto.expiresInHours * 3_600_000)
      : null;

    const poll = await this.prisma.poll.create({
      data: {
        pageId: dto.pageId ?? null,
        authorId: userId,
        question: dto.question,
        multiChoice: dto.multiChoice ?? false,
        expiresAt,
        options: {
          create: dto.options.map((label, i) => ({ label, sortOrder: i })),
        },
      },
      include: POLL_INCLUDE,
    });
    return this.decorate(poll, userId, []);
  }

  async getById(id: string, viewerId?: string) {
    const poll = await this.prisma.poll.findUnique({
      where: { id },
      include: POLL_INCLUDE,
    });
    if (!poll) throw new NotFoundException('Poll not found');
    const myVotes = viewerId ? await this.myVoteOptionIds(id, viewerId) : [];
    return this.decorate(poll, viewerId, myVotes);
  }

  async list(dto: ListPollsDto, viewerId?: string) {
    const where: Prisma.PollWhereInput = {};
    where.pageId = dto.pageId ?? null;

    const items = await this.prisma.poll.findMany({
      where,
      take: dto.limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: POLL_INCLUDE,
    });
    const hasMore = items.length > dto.limit;
    const page = hasMore ? items.slice(0, dto.limit) : items;

    const myVotesByPoll = new Map<string, string[]>();
    if (viewerId && page.length) {
      const votes = await this.prisma.pollVote.findMany({
        where: { userId: viewerId, pollId: { in: page.map((p) => p.id) } },
        select: { pollId: true, optionId: true },
      });
      for (const v of votes) {
        const arr = myVotesByPoll.get(v.pollId) ?? [];
        arr.push(v.optionId);
        myVotesByPoll.set(v.pollId, arr);
      }
    }
    return {
      items: page.map((p) => this.decorate(p, viewerId, myVotesByPoll.get(p.id) ?? [])),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async vote(userId: string, pollId: string, dto: VotePollDto) {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      include: { options: { select: { id: true } } },
    });
    if (!poll) throw new NotFoundException('Poll not found');
    if (poll.expiresAt && poll.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Poll is closed');
    }

    const validIds = new Set(poll.options.map((o) => o.id));
    const chosen = [...new Set(dto.optionIds)].filter((id) => validIds.has(id));
    if (chosen.length === 0) {
      throw new BadRequestException('No valid option selected');
    }
    if (!poll.multiChoice && chosen.length > 1) {
      throw new BadRequestException('This poll accepts a single choice');
    }

    await this.prisma.$transaction(async (tx) => {
      // Remove the user's previous votes on this poll (idempotent re-vote).
      await tx.pollVote.deleteMany({ where: { pollId, userId } });
      await tx.pollVote.createMany({
        data: chosen.map((optionId) => ({ pollId, optionId, userId })),
      });
      // Recompute option + poll counts from the source of truth.
      await this.recount(tx, pollId);
    });

    return this.getById(pollId, userId);
  }

  async retractVote(userId: string, pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { expiresAt: true },
    });
    if (!poll) throw new NotFoundException('Poll not found');
    if (poll.expiresAt && poll.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Poll is closed');
    }
    const existing = await this.prisma.pollVote.findFirst({
      where: { pollId, userId },
      select: { pollId: true },
    });
    if (!existing) throw new NotFoundException('No vote to retract');
    await this.prisma.$transaction(async (tx) => {
      await tx.pollVote.deleteMany({ where: { pollId, userId } });
      await this.recount(tx, pollId);
    });
  }

  async remove(userId: string, pollId: string): Promise<void> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { authorId: true, pageId: true },
    });
    if (!poll) throw new NotFoundException('Poll not found');

    let allowed = poll.authorId === userId;
    if (!allowed && poll.pageId) {
      const admin = await this.prisma.pageAdmin.findUnique({
        where: { pageId_userId: { pageId: poll.pageId, userId } },
        select: { role: true },
      });
      allowed = admin?.role === 'admin';
    }
    if (!allowed) throw new ForbiddenException('Not allowed to delete this poll');
    await this.prisma.poll.delete({ where: { id: pollId } });
  }

  // ── helpers ──────────────────────────────────────────────────
  private async myVoteOptionIds(pollId: string, userId: string): Promise<string[]> {
    const votes = await this.prisma.pollVote.findMany({
      where: { pollId, userId },
      select: { optionId: true },
    });
    return votes.map((v) => v.optionId);
  }

  private async recount(tx: Prisma.TransactionClient, pollId: string): Promise<void> {
    const grouped = await tx.pollVote.groupBy({
      by: ['optionId'],
      where: { pollId },
      _count: { optionId: true },
    });
    const countByOption = new Map(grouped.map((g) => [g.optionId, g._count.optionId]));
    const options = await tx.pollOption.findMany({
      where: { pollId },
      select: { id: true },
    });
    await Promise.all(
      options.map((o) =>
        tx.pollOption.update({
          where: { id: o.id },
          data: { voteCount: countByOption.get(o.id) ?? 0 },
        }),
      ),
    );
    const distinctVoters = await tx.pollVote.findMany({
      where: { pollId },
      distinct: ['userId'],
      select: { userId: true },
    });
    await tx.poll.update({
      where: { id: pollId },
      data: { voteCount: distinctVoters.length },
    });
  }

  private decorate(
    poll: Prisma.PollGetPayload<{ include: typeof POLL_INCLUDE }>,
    _viewerId: string | undefined,
    myVotes: string[],
  ) {
    return {
      ...poll,
      myVotes,
      closed: !!poll.expiresAt && poll.expiresAt.getTime() <= Date.now(),
    };
  }
}
