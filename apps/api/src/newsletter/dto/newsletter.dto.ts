import { z } from 'zod';

/**
 * Public subscribe payload (POST /newsletter/subscribe). Email is lowercased
 * and trimmed so the @unique constraint dedupes case/space variants. `source`
 * tags where the address came from (e.g. 'landing') for admin stats.
 */
export const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(255),
  source: z.string().trim().max(50).optional(),
  locale: z.string().trim().max(10).optional(),
});
export type SubscribeDto = z.infer<typeof subscribeSchema>;

/** One-click unsubscribe (GET /newsletter/unsubscribe?token=…). */
export const unsubscribeSchema = z.object({
  token: z.string().trim().min(16).max(64),
});
export type UnsubscribeDto = z.infer<typeof unsubscribeSchema>;

/** Admin: paginated subscriber list. Mirrors admin.controller list shape. */
export const listSubscribersSchema = z.object({
  status: z.enum(['subscribed', 'unsubscribed']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListSubscribersDto = z.infer<typeof listSubscribersSchema>;

/** Admin: create a campaign draft. */
export const createCampaignSchema = z.object({
  subject: z.string().trim().min(1, 'Sujet requis').max(200),
  bodyHtml: z.string().min(1, 'Corps requis').max(100_000),
  bodyText: z.string().min(1).max(100_000),
});
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

/** Admin: edit a draft (all fields optional). */
export const updateCampaignSchema = createCampaignSchema.partial();
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

/** Admin: send a single test message of a campaign to one address. */
export const testCampaignSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(255),
});
export type TestCampaignDto = z.infer<typeof testCampaignSchema>;
