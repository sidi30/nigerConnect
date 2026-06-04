import { z } from 'zod';

export const reviewTargetEnum = z.enum(['user', 'page']);

export const upsertReviewSchema = z
  .object({
    targetType: reviewTargetEnum,
    targetId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).optional(),
  })
  .strict();
export type UpsertReviewDto = z.infer<typeof upsertReviewSchema>;

export const listReviewsSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListReviewsDto = z.infer<typeof listReviewsSchema>;
