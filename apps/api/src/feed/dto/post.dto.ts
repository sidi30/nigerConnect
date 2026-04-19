import { z } from 'zod';

export const postMediaSchema = z.object({
  mediaUrl: z.string().url().max(500),
  thumbnailUrl: z.string().url().max(500).optional(),
  mediaType: z.enum(['image', 'video']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  blurhash: z.string().max(100).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const createPostSchema = z.object({
  content: z.string().max(5000).optional(),
  visibility: z.enum(['public', 'friends', 'association']).default('friends'),
  associationId: z.string().uuid().optional(),
  media: z.array(postMediaSchema).max(10).optional(),
});
export type CreatePostDto = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  content: z.string().max(5000).optional(),
  visibility: z.enum(['public', 'friends', 'association']).optional(),
});
export type UpdatePostDto = z.infer<typeof updatePostSchema>;

export const createCommentSchema = z.object({
  content: z.string().min(1).max(1000),
  parentId: z.string().uuid().optional(),
});
export type CreateCommentDto = z.infer<typeof createCommentSchema>;

export const createStorySchema = z.object({
  content: z.string().max(500).optional(),
  media: postMediaSchema,
});
export type CreateStoryDto = z.infer<typeof createStorySchema>;

export const feedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQueryDto = z.infer<typeof feedQuerySchema>;
