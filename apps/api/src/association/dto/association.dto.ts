import { z } from 'zod';

export const associationCategoryEnum = z.enum([
  'generaliste',
  'etudiants',
  'femmes',
  'jeunesse',
  'culture',
  'business',
  'sport',
  'religieux',
]);

export const createAssociationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  logoUrl: z.string().url().max(500).optional(),
  coverUrl: z.string().url().max(500).optional(),
  category: associationCategoryEnum,
  // Required so the entity is always placeable on the map (geo.service filters
  // out rows with a null countryCode). Update stays optional via .partial().
  countryCode: z.string().length(2).toUpperCase(),
  city: z.string().min(1).max(100),
  website: z.string().url().max(300).optional(),
  contactEmail: z.string().email().max(255).optional(),
  requiresApproval: z.boolean().optional(),
});
export type CreateAssociationDto = z.infer<typeof createAssociationSchema>;

export const updateAssociationSchema = createAssociationSchema.partial();
export type UpdateAssociationDto = z.infer<typeof updateAssociationSchema>;

export const listAssociationsSchema = z.object({
  category: associationCategoryEnum.optional(),
  country: z.string().length(2).toUpperCase().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListAssociationsDto = z.infer<typeof listAssociationsSchema>;

export const changeRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
});
export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;

export const inviteMemberSchema = z.object({
  userId: z.string().uuid(),
});
export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;

export const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  eventDate: z.string().datetime(),
  location: z.string().max(200).optional(),
  coverUrl: z.string().url().max(500).optional(),
});
export type CreateEventDto = z.infer<typeof createEventSchema>;
