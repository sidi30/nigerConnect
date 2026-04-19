import { z } from 'zod';

export const createPhotoSchema = z.object({
  url: z.string().url().max(500),
  thumbnailUrl: z.string().url().max(500).optional(),
  caption: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreatePhotoDto = z.infer<typeof createPhotoSchema>;

export const presignUploadSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  kind: z.enum(['avatar', 'cover', 'photo', 'identity']).default('photo'),
});
export type PresignUploadDto = z.infer<typeof presignUploadSchema>;

export const searchSchema = z.object({
  q: z.string().min(1).max(100).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  city: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchDto = z.infer<typeof searchSchema>;
