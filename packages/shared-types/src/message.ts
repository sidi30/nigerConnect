import type { PublicUser } from './user';

export type ConversationType = 'direct' | 'group';
export type MessageType = 'text' | 'image' | 'file' | 'system';

/**
 * Per-member read metadata returned inside a Conversation response.
 * Used by the chat screen to derive per-message read receipts without
 * a per-message flag in the DB: a message is "read by member X" when
 * member.lastReadAt >= message.createdAt.
 */
export interface ConversationMemberMeta {
  userId: string;
  lastReadAt: string | null;  // ISO-8601 or null if never opened
  unreadCount: number;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  avatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  members: PublicUser[];
  /**
   * Parallel array to `members` that carries read-receipt state per member.
   * Index-aligned: membersMeta[i] belongs to members[i].
   * The chat screen uses this to render ✓✓ on its own messages once the
   * peer's lastReadAt has advanced past the message's createdAt.
   */
  membersMeta: ConversationMemberMeta[];
  createdAt: string;
}

/** Lightweight snippet of the quoted message, for the swipe-to-reply quote bubble. */
export interface MessageReplyPreview {
  id: string;
  content: string | null;
  messageType: MessageType;
  deletedAt: string | null;
  sender: PublicUser;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: PublicUser;
  content: string | null;
  messageType: MessageType;
  mediaUrl: string | null;
  replyToId: string | null;
  /** Hydrated quoted message when replyToId is set (absent on older payloads). */
  replyTo?: MessageReplyPreview | null;
  /** Emoji reactions on this message (one per user). Client aggregates by emoji. */
  reactions?: { userId: string; emoji: string }[];
  deletedAt: string | null;
  editedAt: string | null;
  createdAt: string;
}
