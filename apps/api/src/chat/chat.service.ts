import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, MessageType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BlockService } from '../social/block.service';
import { NotificationService } from '../notification/notification.service';

/**
 * Hard cap on a single message. Matches our DTO validation but also guards
 * the raw Gateway path that bypasses Zod pipes.
 */
const MAX_MESSAGE_LENGTH = 4000;

// Precompiled sanitizers built from unicode ranges rather than inline
// literals, so the source file stays ASCII-safe and Edit-friendly.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]',
  'g',
);
const INVISIBLE_CHARS_RE = new RegExp(
  '[\\u200B-\\u200F\\u2028-\\u202E\\uFEFF]',
  'g',
);

/**
 * Strip characters that have no business being in a plain-text message and
 * would enable homograph/invisible-char attacks or break rendering:
 *   - C0/C1 control chars except \t, \n, \r
 *   - Zero-width spaces, bidi-override chars, BOM
 *
 * We intentionally do NOT escape HTML here: content is rendered as text by
 * the mobile client. Any future web client must escape at the RENDER layer,
 * not at write time (otherwise `&lt;` leaks back to users).
 */
function sanitizeMessageText(raw: string): string {
  return raw.replace(CONTROL_CHARS_RE, '').replace(INVISIBLE_CHARS_RE, '').trim();
}

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
    private readonly notifications: NotificationService,
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

  /**
   * Fetch a single conversation by id. Used by the chat screen on cold open
   * — without it, the screen had to download the *entire* conversation list
   * just to render the peer header, which delayed the first paint by 200–
   * 500 ms on cellular connections.
   *
   * Returns the same shape as a single entry of `listConversations`.
   */
  async getConversation(userId: string, conversationId: string) {
    await this.assertMember(userId, conversationId);
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: { include: { user: { select: MEMBER_SELECT } } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    return this.decorate(conv, userId);
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

    // Block check for direct conversations. createConversation already
    // refuses NEW DMs across a block, but if A and B were already in a
    // direct conv when B blocked A, the membership row stays around and
    // A could keep messaging B unfiltered. Group chats are intentionally
    // exempt — blocking one member doesn't muzzle the whole room.
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        type: true,
        members: { select: { userId: true } },
      },
    });
    if (conv?.type === 'direct') {
      const other = conv.members.find((m) => m.userId !== userId)?.userId;
      if (other && (await this.blocks.isBlocked(userId, other))) {
        throw new ForbiddenException('Cannot send message: user has blocked you');
      }
    }

    // Sanitize + length-cap the text content BEFORE touching the DB.
    // Applies to both REST and Gateway paths.
    const cleanContent = payload.content !== undefined
      ? this.normalizeContent(payload.content)
      : undefined;
    const messageType: MessageType = payload.messageType ?? 'text';
    if (messageType === 'text' && (!cleanContent || cleanContent.length === 0)) {
      throw new BadRequestException('Message content is empty');
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          content: cleanContent ?? null,
          messageType,
          mediaUrl: payload.mediaUrl ?? null,
          replyToId: payload.replyToId ?? null,
        },
        include: { sender: { select: MEMBER_SELECT } },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          // Preview is truncated to avoid hauling a 4kB blob into every
          // conversation-list fetch.
          lastMessagePreview: cleanContent ? cleanContent.slice(0, 140) : '[media]',
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

    // Notify every other member — fire-and-forget so the HTTP response stays
    // fast. NotificationService.create persists the row + dispatches the push.
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, firstName: true },
    });
    const senderName =
      sender?.displayName ?? sender?.firstName ?? 'Quelqu’un';
    const preview = cleanContent
      ? cleanContent.slice(0, 140)
      : messageType === 'image'
        ? '📷 Photo'
        : '📎 Pièce jointe';
    for (const m of members) {
      if (m.userId === userId) continue;
      void this.notifications
        .create({
          userId: m.userId,
          actorId: userId,
          type: 'message',
          title: senderName,
          body: preview,
          data: { conversationId, messageId: message.id },
        })
        .catch(() => {
          /* fire-and-forget */
        });
    }

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

  private normalizeContent(raw: string): string {
    const clean = sanitizeMessageText(raw);
    if (clean.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }
    return clean;
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
