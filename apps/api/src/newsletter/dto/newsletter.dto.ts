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

/** App-user one-click opt-out (GET /newsletter/app-unsubscribe?token=…). */
export const appUnsubscribeSchema = z.object({
  token: z.string().trim().min(16).max(64),
});
export type AppUnsubscribeDto = z.infer<typeof appUnsubscribeSchema>;

/** Admin: paginated subscriber list. Mirrors admin.controller list shape. */
export const listSubscribersSchema = z.object({
  status: z.enum(['subscribed', 'unsubscribed']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListSubscribersDto = z.infer<typeof listSubscribersSchema>;

/** Campaign content fields shared by create + update (no defaults). */
const campaignContentSchema = z.object({
  subject: z.string().trim().min(1, 'Sujet requis').max(200),
  bodyHtml: z.string().min(1, 'Corps requis').max(100_000),
  bodyText: z.string().min(1).max(100_000),
});

/**
 * Admin: create a campaign draft.
 * - `audience` 'subscribers' = legacy public email list; 'app_users' = registered
 *   accounts (in-app notif + push + email).
 * - `critical` (app_users only) bypasses the per-user opt-out — service notices.
 */
export const createCampaignSchema = campaignContentSchema.extend({
  audience: z.enum(['subscribers', 'app_users']).default('subscribers'),
  critical: z.boolean().default(false),
});
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

/**
 * Admin: edit a draft (all fields optional — defaults intentionally omitted so a
 * PATCH never silently resets audience/critical on an existing draft).
 */
export const updateCampaignSchema = campaignContentSchema.partial().extend({
  audience: z.enum(['subscribers', 'app_users']).optional(),
  critical: z.boolean().optional(),
});
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

/** Admin: send a single test message of a campaign to one address. */
export const testCampaignSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(255),
});
export type TestCampaignDto = z.infer<typeof testCampaignSchema>;
