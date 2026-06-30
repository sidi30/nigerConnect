import { z } from 'zod';

export const submitIdentitySchema = z.object({
  documentType: z.enum(['passport', 'id_card', 'driver_license', 'residence_permit']),
  fileUrl: z.string().url().max(500),
});

export type SubmitIdentityDto = z.infer<typeof submitIdentitySchema>;

export const reviewIdentitySchema = z
  .object({
    userId: z.string().uuid(),
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().max(500).optional(),
    // Date of birth read from the document at review (YYYY-MM-DD). Mandatory when
    // approving so the 18+ gate is reliable; must not be in the future.
    dateOfBirth: z
      .string()
      .date()
      .refine((d) => Date.parse(d) <= Date.now(), 'dateOfBirth cannot be in the future')
      .optional(),
  })
  .refine((d) => d.decision !== 'approved' || !!d.dateOfBirth, {
    message: 'dateOfBirth is required to approve an identity document',
    path: ['dateOfBirth'],
  });

export type ReviewIdentityDto = z.infer<typeof reviewIdentitySchema>;
