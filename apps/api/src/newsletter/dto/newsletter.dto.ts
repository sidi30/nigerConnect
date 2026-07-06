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

/** All four targeting modes. See {@link campaignAudienceSchema}. */
export const campaignAudienceSchema = z.enum([
  'subscribers', // public landing email list (legacy default)
  'app_users', // every registered account (in-app notif + push + email)
  'segment', // registered accounts filtered by {@link segmentSchema}
  'custom', // only the hand-picked `includeEmails`
]);

/**
 * `segment` audience filters (registered accounts only). All optional and
 * AND-combined. `verifiedOnly` = identity-approved; `activeSince` = last login
 * on/after that instant. The per-user opt-out is ALWAYS enforced for a
 * non-critical send regardless of `optInOnly` (privacy rule).
 */
export const segmentSchema = z
  .object({
    countryCode: z.string().trim().length(2).toUpperCase().optional(),
    city: z.string().trim().min(1).max(100).optional(),
    verifiedOnly: z.boolean().optional(),
    ambassadorOnly: z.boolean().optional(),
    optInOnly: z.boolean().optional(),
    activeSince: z.string().datetime().optional(),
  })
  .strict();
export type SegmentDto = z.infer<typeof segmentSchema>;

/** One email attachment reference (object already uploaded to our own bucket). */
export const attachmentSchema = z
  .object({
    url: z.string().url().max(1024),
    filename: z.string().trim().min(1).max(200),
    contentType: z.string().trim().min(1).max(100),
  })
  .strict();
export type AttachmentDto = z.infer<typeof attachmentSchema>;

/** Individual add/remove lists — lower-cased + deduped emails, capped. */
const emailListSchema = z
  .array(z.string().trim().toLowerCase().email().max(255))
  .max(1000)
  .transform((list) => Array.from(new Set(list)));

const targetingSchema = z.object({
  segment: segmentSchema.optional(),
  includeEmails: emailListSchema.optional(),
  excludeEmails: emailListSchema.optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

/**
 * Admin: create a campaign draft.
 * - `audience` 'subscribers' = legacy public email list; 'app_users' = every
 *   registered account; 'segment' = registered accounts filtered by `segment`;
 *   'custom' = only the hand-picked `includeEmails`.
 * - `critical` (app_users / segment only) bypasses the per-user opt-out.
 * - `includeEmails` / `excludeEmails` add or remove individual addresses on top
 *   of the resolved audience (deduped by email at send time).
 * - `attachments` are files already uploaded via POST /admin/newsletter/upload.
 */
export const createCampaignSchema = campaignContentSchema.merge(targetingSchema).extend({
  audience: campaignAudienceSchema.default('subscribers'),
  critical: z.boolean().default(false),
});
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

/**
 * Admin: edit a draft (all fields optional — defaults intentionally omitted so a
 * PATCH never silently resets audience/critical on an existing draft).
 */
export const updateCampaignSchema = campaignContentSchema
  .partial()
  .merge(targetingSchema)
  .extend({
    audience: campaignAudienceSchema.optional(),
    critical: z.boolean().optional(),
  });
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

/** Admin: presign an image upload for a campaign (body image or attachment). */
export const uploadNewsletterMediaSchema = z
  .object({
    contentType: z.string().trim().min(1).max(100),
    filename: z.string().trim().max(200).optional(),
  })
  .strict();
export type UploadNewsletterMediaDto = z.infer<typeof uploadNewsletterMediaSchema>;

/** Admin: estimate a recipient count from an unsaved targeting draft (preview). */
export const previewRecipientsSchema = z
  .object({
    audience: campaignAudienceSchema.default('subscribers'),
    critical: z.boolean().default(false),
  })
  .merge(targetingSchema);
export type PreviewRecipientsDto = z.infer<typeof previewRecipientsSchema>;

/** Admin: send a single test message of a campaign to one address. */
export const testCampaignSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide').max(255),
});
export type TestCampaignDto = z.infer<typeof testCampaignSchema>;
