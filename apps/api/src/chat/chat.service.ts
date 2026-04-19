import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, MessageType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlockService } from '../social/block.service';

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
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlockService,
  ) {}

  async listConversations(userId: string, cursor?: string, limit = 30) {
    const conversations = await this.prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { lastMessageAt: 'desc' },
      include: {
        members: {
          include: { user: { select: MEMBER_SELECT } },
        },
      },
    });
    const hasMore = conversations.length > limit;
    const items = hasMore ? conversations.slice(0, limit) : conversations;
    const mapped = items.map((c) => this.decorate(c, userId));
    return {
      items: mapped,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async listMessages(userId: string, conversationId: string, cursor?: string, limit = 50) {
    await this.assertMember(userId, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: MEMBER_SELECT },
      },
    });
    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async createConversation(creatorId: string, participantIds: string[], name?: string) {
    const uniqueParticipants = Array.from(new Set(participantIds.filter((id) => id !== creatorId)));
    if (uniqueParticipants.length === 0) {
      throw new BadRequestException('At least one other participant required');
    }

    // Reject if any participant has blocked the creator (or vice versa)
    for (const p of uniqueParticipants) {
      if (await this.blocks.isBlocked(creatorId, p)) {
        throw new ForbiddenException('Cannot start conversation with blocked user');
      }
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueParticipants } },
      select: { id: true },
    });
    if (users.length !== uniqueParticipants.length) {
      throw new NotFoundException('One or more participants not found');
    }

    const isDirect = uniqueParticipants.length === 1;
    if (isDirect) {
      // Check for existing direct conversation
      const otherId = uniqueParticipants[0]!;
      const existing = await this.prisma.conversation.findFirst({
        where: {
          type: 'direct',
          AND: [
            { members: { some: { userId: creatorId } } },
            { members: { some: { userId: otherId } } },
          ],
        },
      });
      if (existing) return existing;
    }

    return this.prisma.conversation.create({
      data: {
        type: isDirect ? 'direct' : 'group',
        name: isDirect ? null : name ?? null,
        createdById: creatorId,
        members: {
          create: [
            { userId: creatorId, role: 'admin' },
            ...uniqueParticipants.map((id) => ({ userId: id, role: 'member' as const })),
          ],
        },
      },
      include: {
        members: { include: { user: { select: MEMBER_SELECT } } },
      },
    });
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    payload: {
      content?: string;
      messageType?: MessageType;
      mediaUrl?: string;
      replyToId?: string;
    },
  ) {
    await this.assertMember(userId, conversationId);

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          content: payload.content ?? null,
          messageType: payload.messageType ?? 'text',
          mediaUrl: payload.mediaUrl ?? null,
          replyToId: payload.replyToId ?? null,
        },
        include: { sender: { select: MEMBER_SELECT } },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: payload.content ?? '[media]',
        },
      }),
      this.prisma.conversationMember.updateMany({
        where: { conversationId, userId: { not: userId } },
        data: { unreadCount: { increment: 1 } },
      }),
    ]);

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return { message, memberIds: members.map((m) => m.userId) };
  }

  async markAsRead(userId: string, conversationId: string): Promise<void> {
    await this.assertMember(userId, conversationId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });
  }

  async softDeleteMessage(userId: string, messageId: string) {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg || msg.deletedAt) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId) throw new ForbiddenException('Not your message');
    return this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: null, mediaUrl: null },
    });
  }

  async assertMember(userId: string, conversationId: string): Promise<void> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });
    if (!member) throw new ForbiddenException('Not a conversation member');
  }

  async getMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  private decorate(
    c: {
      id: string;
      type: string;
      name: string | null;
      avatarUrl: string | null;
      lastMessageAt: Date | null;
      lastMessagePreview: string | null;
      createdAt: Date;
      members: Array<{
        userId: string;
        unreadCount: number;
        user: { id: string; displayName: string | null; avatarUrl: string | null };
      }>;
    },
    viewerId: string,
  ) {
    const me = c.members.find((m) => m.userId === viewerId);
    const others = c.members.filter((m) => m.userId !== viewerId).map((m) => m.user);
    return {
      id: c.id,
      type: c.type,
      name: c.name ?? (c.type === 'direct' ? others[0]?.displayName ?? null : null),
      avatarUrl: c.avatarUrl ?? (c.type === 'direct' ? others[0]?.avatarUrl ?? null : null),
      lastMessageAt: c.lastMessageAt,
      lastMessagePreview: c.lastMessagePreview,
      unreadCount: me?.unreadCount ?? 0,
      members: c.members.map((m) => m.user),
      createdAt: c.createdAt,
    };
  }
}
