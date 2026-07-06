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

// ── Manual identity verification (admin, no document) ────────────────────────
// An admin may verify a member's identity WITHOUT an uploaded piece (e.g. vetted
// in person / by a trusted community process). DOB is mandatory (18+ gate for the
// proximity feature) and must be a real, past date describing an adult. reason is
// mandatory so every manual decision is auditable.
const isoDate = z
  .string()
  .date()
  .refine((d) => Date.parse(`${d}T00:00:00.000Z`) <= Date.now(), {
    message: 'dateOfBirth cannot be in the future',
  });

export const manualApproveIdentitySchema = z
  .object({
    userId: z.string().uuid(),
    dateOfBirth: isoDate,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type ManualApproveIdentityDto = z.infer<typeof manualApproveIdentitySchema>;

export const revokeIdentitySchema = z
  .object({
    userId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type RevokeIdentityDto = z.infer<typeof revokeIdentitySchema>;
