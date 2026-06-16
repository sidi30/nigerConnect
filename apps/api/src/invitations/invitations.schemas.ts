import { z } from 'zod';

// ── Request schemas ────────────────────────────────────────────────

export const createInvitationSchema = z
  .object({
    // Optional: inviter provides the invitee's email → platform sends an
    // invitation email AND stores it for email-match registration.
    // Normalized to lowercase+trim before use. Not stored if absent.
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .strict();
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;

export const revokeInvitationSchema = z.object({}).strict();
export type RevokeInvitationDto = z.infer<typeof revokeInvitationSchema>;

export const checkInvitationSchema = z.object({
  code: z.string().trim().min(6).max(16),
});
export type CheckInvitationDto = z.infer<typeof checkInvitationSchema>;
