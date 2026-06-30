import type { Conversation, Message, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export const chatApi = {
  async listConversations(cursor?: string): Promise<CursorPage<Conversation>> {
    const { data } = await api.get<CursorPage<Conversation>>('/conversations', {
      params: { cursor },
    });
    return data;
  },

  /** Fetch a single conversation by id — much cheaper than listing all of them
   *  just to render the chat header. */
  async getConversation(conversationId: string): Promise<Conversation> {
    const { data } = await api.get<Conversation>(`/conversations/${conversationId}`);
    return data;
  },

  async listMessages(conversationId: string, cursor?: string): Promise<CursorPage<Message>> {
    const { data } = await api.get<CursorPage<Message>>(`/conversations/${conversationId}/messages`, {
      params: { cursor },
    });
    return data;
  },

  async createConversation(participantIds: string[], name?: string): Promise<Conversation> {
    const { data } = await api.post<Conversation>('/conversations', { participantIds, name });
    return data;
  },

  async sendMessage(
    conversationId: string,
    content: string,
    options?: { messageType?: 'text' | 'image' | 'file'; mediaUrl?: string; replyToId?: string },
  ): Promise<Message> {
    const { data } = await api.post<Message>(`/conversations/${conversationId}/messages`, {
      content,
      ...options,
    });
    return data;
  },

  /** Edit a text message in place (sender-only, within 15 min server-side). */
  async editMessage(messageId: string, content: string): Promise<Message> {
    const { data } = await api.patch<Message>(`/messages/${messageId}`, { content });
    return data;
  },

  /** Add / switch / remove the viewer's emoji reaction on a message. */
  async reactToMessage(messageId: string, emoji: string): Promise<Message> {
    const { data } = await api.post<Message>(`/messages/${messageId}/react`, { emoji });
    return data;
  },

  /** Delete a message for everyone (sender-only, within 15 min server-side). */
  async deleteMessage(messageId: string): Promise<Message> {
    const { data } = await api.delete<Message>(`/messages/${messageId}`);
    return data;
  },

  async markRead(conversationId: string): Promise<void> {
    await api.post(`/conversations/${conversationId}/read`);
  },
};
