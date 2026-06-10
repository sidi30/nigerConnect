import { z } from 'zod';

export const pageKindEnum = z.enum(['community', 'cause', 'business', 'official', 'group']);

export const createPageSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  kind: pageKindEnum,
  avatarUrl: z.string().url().max(500).optional(),
  coverUrl: z.string().url().max(500).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  city: z.string().max(100).optional(),
  website: z.string().url().max(300).optional(),
  contactEmail: z.string().email().max(255).optional(),
});
export type CreatePageDto = z.infer<typeof createPageSchema>;

export const updatePageSchema = createPageSchema.partial();
export type UpdatePageDto = z.infer<typeof updatePageSchema>;

export const listPagesSchema = z.object({
  kind: pageKindEnum.optional(),
  country: z.string().length(2).toUpperCase().optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListPagesDto = z.infer<typeof listPagesSchema>;

export const changePageRoleSchema = z.object({
  role: z.enum(['admin', 'editor']),
});
export type ChangePageRoleDto = z.infer<typeof changePageRoleSchema>;
