import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlockService } from '../social/block.service';

const AUTHOR_SELECT = {
  id: true,
  displayName: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
} as const;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlockService,
  ) {}

  async create(userId: string, postId: string, content: string, parentId?: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true, authorId: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (await this.blocks.isBlocked(userId, post.authorId)) {
      throw new NotFoundException('Post not found');
    }

    if (parentId) {
      const parent = await this.prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, postId: true, parentId: true },
      });
      if (!parent || parent.postId !== postId) {
        throw new NotFoundException('Parent comment not found');
      }
      if (parent.parentId) {
        throw new BadRequestException('Only one level of nested replies is allowed');
      }
    }

    const [comment] = await this.prisma.$transaction([
      this.prisma.comment.create({
        data: { postId, authorId: userId, content, parentId: parentId ?? null },
        include: { author: { select: AUTHOR_SELECT } },
      }),
      this.prisma.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      }),
    ]);
    return comment;
  }

  async list(postId: string, cursor?: string, limit = 20) {
    const roots = await this.prisma.comment.findMany({
      where: { postId, parentId: null, deletedAt: null },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: AUTHOR_SELECT },
        replies: {
          where: { deletedAt: null },
          include: { author: { select: AUTHOR_SELECT } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    const hasMore = roots.length > limit;
    const items = hasMore ? roots.slice(0, limit) : roots;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async softDelete(userId: string, commentId: string): Promise<void> {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c || c.deletedAt) throw new NotFoundException('Comment not found');
    if (c.authorId !== userId) throw new ForbiddenException('Not your comment');
    await this.prisma.$transaction([
      this.prisma.comment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.post.update({
        where: { id: c.postId },
        data: { commentCount: { decrement: 1 } },
      }),
    ]);
  }
}
