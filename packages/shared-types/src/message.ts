import type { PublicUser } from './user';

export type ConversationType = 'direct' | 'group';
export type MessageType = 'text' | 'image' | 'file' | 'system';

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  avatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  members: PublicUser[];
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: PublicUser;
  content: string | null;
  messageType: MessageType;
  mediaUrl: string | null;
  replyToId: string | null;
  deletedAt: string | null;
  createdAt: string;
}
