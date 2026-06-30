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

export const createServiceSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: serviceCategoryEnum,
  urgency: z.enum(['urgent', 'normal']).default('normal'),
  budget: z.string().max(50).optional(),
  city: z.string().max(100).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
});
export type CreateServiceDto = z.infer<typeof createServiceSchema>;

export const listServicesSchema = z.object({
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
