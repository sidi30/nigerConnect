import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  displayName: z.string().min(1).max(100).trim().optional(),
  bio: z.string().max(1000).optional().nullable(),
  city: z.string().max(100).trim().optional().nullable(),
  countryCode: z
    .string()
    .length(2, 'countryCode must be ISO-3166-1 alpha-2')
    .toUpperCase()
    .optional()
    .nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  showOnMap: z.boolean().optional(),
  proximityAlerts: z.boolean().optional(),
  proximityRadius: z
    .number()
    .int()
    .refine((v) => [50, 100, 500, 1000].includes(v), 'proximityRadius must be 50, 100, 500 or 1000')
    .optional(),
  languages: z.array(z.string().min(2).max(5)).max(10).optional(),
  privacyLevel: z.enum(['public', 'friends', 'private']).optional(),
});

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const updateAvatarSchema = z.object({
  avatarUrl: z.string().url().max(500).nullable(),
});
export type UpdateAvatarDto = z.infer<typeof updateAvatarSchema>;

export const updateCoverSchema = z.object({
  coverUrl: z.string().url().max(500).nullable(),
});
export type UpdateCoverDto = z.infer<typeof updateCoverSchema>;
