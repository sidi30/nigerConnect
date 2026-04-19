import { z } from 'zod';

export const createReportSchema = z.object({
  targetType: z.enum(['user', 'post', 'message', 'association', 'comment']),
  targetId: z.string().uuid(),
  reason: z.enum(['spam', 'harassment', 'inappropriate', 'fake_identity', 'scam', 'other']),
  description: z.string().max(1000).optional(),
});
export type CreateReportDto = z.infer<typeof createReportSchema>;

export const resolveReportSchema = z.object({
  action: z.enum(['warning', 'content_removed', 'suspended', 'banned', 'none']),
  note: z.string().max(1000).optional(),
});
export type ResolveReportDto = z.infer<typeof resolveReportSchema>;

export const listReportsSchema = z.object({
  status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']).default('pending'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListReportsDto = z.infer<typeof listReportsSchema>;
