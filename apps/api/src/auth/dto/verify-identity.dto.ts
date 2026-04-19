import { z } from 'zod';

export const submitIdentitySchema = z.object({
  documentType: z.enum(['passport', 'id_card', 'driver_license', 'residence_permit']),
  fileUrl: z.string().url().max(500),
});

export type SubmitIdentityDto = z.infer<typeof submitIdentitySchema>;

export const reviewIdentitySchema = z.object({
  userId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

export type ReviewIdentityDto = z.infer<typeof reviewIdentitySchema>;
