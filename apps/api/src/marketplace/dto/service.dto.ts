import { z } from 'zod';

export const serviceCategoryEnum = z.enum([
  'logement',
  'transport',
  'admin_category',
  'sante',
  'emploi',
  'business',
  'education',
  'autre',
]);

export const serviceIntentEnum = z.enum(['help_free', 'paid_service']);

// Ordered gallery item — mirrors postMediaSchema but image-only in V1.
// Each mediaUrl is re-bound to the owner's S3 prefix in the service layer
// (assertOwnedPublicImage) — the URL shape check here is not a trust boundary.
export const serviceMediaSchema = z.object({
  mediaUrl: z.string().url().max(500),
  thumbnailUrl: z.string().url().max(500).optional(),
  mediaType: z.literal('image').default('image'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  blurhash: z.string().max(100).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type ServiceMediaDto = z.infer<typeof serviceMediaSchema>;

export const createServiceSchema = z
  .object({
    intent: serviceIntentEnum.default('help_free'),
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    category: serviceCategoryEnum,
    urgency: z.enum(['urgent', 'normal']).default('normal'),
    budget: z.string().max(50).optional(),
    city: z.string().max(100).optional(),
    countryCode: z.string().length(2).toUpperCase().optional(),
    media: z.array(serviceMediaSchema).max(6).optional(),
  })
  // A free help request never carries a price — reject a budget on help_free
  // rather than silently dropping it (explicit 422, per ADR-002).
  .superRefine((val, ctx) => {
    if (val.intent === 'help_free' && val.budget != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['budget'],
        message: 'budget is only allowed when intent = paid_service',
      });
    }
  });
export type CreateServiceDto = z.infer<typeof createServiceSchema>;

// Partial edit of an existing request. `media`, when present, REPLACES the
// whole gallery (delete + recreate). `budget` is rejected only when the
// *effective* intent resolves to help_free — the service layer merges the
// patched intent with the persisted one before this rule matters, but if the
// body itself sets intent=help_free + budget we reject up front.
export const updateServiceSchema = z
  .object({
    intent: serviceIntentEnum.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    category: serviceCategoryEnum.optional(),
    urgency: z.enum(['urgent', 'normal']).optional(),
    budget: z.string().max(50).optional(),
    city: z.string().max(100).optional(),
    countryCode: z.string().length(2).toUpperCase().optional(),
    media: z.array(serviceMediaSchema).max(6).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.intent === 'help_free' && val.budget != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['budget'],
        message: 'budget is only allowed when intent = paid_service',
      });
    }
  });
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;

export const listServicesSchema = z.object({
  intent: serviceIntentEnum.optional(),
  category: serviceCategoryEnum.optional(),
  country: z.string().length(2).toUpperCase().optional(),
  urgency: z.enum(['urgent', 'normal']).optional(),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  // Free-text search over title/description/city (case-insensitive). Trimmed,
  // bounded; combinable with the category/country filters.
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['recent', 'urgent_first']).default('recent'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListServicesDto = z.infer<typeof listServicesSchema>;

export const respondSchema = z.object({
  message: z.string().min(1).max(1000),
});
export type RespondDto = z.infer<typeof respondSchema>;

export const rateSchema = z.object({
  ratedUserId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});
export type RateDto = z.infer<typeof rateSchema>;
