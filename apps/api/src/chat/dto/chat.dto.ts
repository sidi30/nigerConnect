import { z } from 'zod';

export const createConversationSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(50),
  name: z.string().max(100).optional(),
});
export type CreateConversationDto = z.infer<typeof createConversationSchema>;

export const sendMessageSchema = z.object({
  content: z.string().max(5000).optional(),
  messageType: z.enum(['text', 'image', 'file']).default('text'),
  mediaUrl: z.string().url().max(500).optional(),
  replyToId: z.string().uuid().optional(),
}).refine(
  (d) => d.content || d.mediaUrl,
  { message: 'content or mediaUrl is required' },
);
export type SendMessageDto = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  // Empty allowed so an image caption can be cleared; the service still rejects
  // an empty edit on a text message (text must keep content).
  content: z.string().max(5000),
});
export type EditMessageDto = z.infer<typeof editMessageSchema>;

export const reactMessageSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
});
export type ReactMessageDto = z.infer<typeof reactMessageSchema>;
