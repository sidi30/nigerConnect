import { z } from 'zod';

export const createPollSchema = z.object({
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(200)).min(2).max(10),
  multiChoice: z.boolean().optional().default(false),
  pageId: z.string().uuid().optional(),
  expiresInHours: z.coerce.number().int().min(1).max(720).optional(),
});
export type CreatePollDto = z.infer<typeof createPollSchema>;

export const votePollSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(1).max(10),
});
export type VotePollDto = z.infer<typeof votePollSchema>;

export const listPollsSchema = z.object({
  pageId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListPollsDto = z.infer<typeof listPollsSchema>;
