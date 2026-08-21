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

// A6 — the DISPLAY name is the other half of anti-squat. `slugify()` makes two
// look-alike names collide on the uniqueness key, but a name is still rendered
// verbatim in the app, in push notifications and in the A2 e-mail subject: a
// bidi override (U+202E) reverses what the reader sees, and C0/C1 controls let
// a name carry line breaks into places that expect one line. Neither is a
// legitimate association name, so they are refused outright rather than
// silently stripped — the founder should see the error.
const RENDERABLE_NAME = /^[^\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/;

export const createAssociationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(RENDERABLE_NAME, 'Name contains control or text-direction characters'),
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
  // A1 — default 'public' is set at the DB level (schema.prisma). Only an
  // admin/owner can ever set this (update() gates on assertRole), and only
  // through this schema — never trust a client-supplied value elsewhere.
  membersVisibility: z.enum(['public', 'members_only']).optional(),
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

// `owner` is deliberately excluded: it can only move via the ownership
// transfer accept flow (requestOwnershipTransfer/acceptOwnershipTransfer), not
// through this generic role PATCH (A3).
export const changeRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
});
export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;

export const inviteMemberSchema = z.object({
  userId: z.string().uuid(),
});
export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;

/** Optional note an admin attaches when turning down a join request. */
export const rejectRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type RejectRequestDto = z.infer<typeof rejectRequestSchema>;

export const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  eventDate: z.string().datetime(),
  location: z.string().max(200).optional(),
  coverUrl: z.string().url().max(500).optional(),
});
export type CreateEventDto = z.infer<typeof createEventSchema>;

// ── A3 — ownership transfer ─────────────────────────────────────────────────
export const transferOwnershipSchema = z.object({
  userId: z.string().uuid(),
});
export type TransferOwnershipDto = z.infer<typeof transferOwnershipSchema>;

// ── A4 — bureau exécutif ─────────────────────────────────────────────────────
export const associationOfficerTitleEnum = z.enum([
  'president',
  'vice_president',
  'secretary',
  'treasurer',
  'spokesperson',
  'other',
]);

export const designateOfficerSchema = z
  .object({
    userId: z.string().uuid(),
    title: associationOfficerTitleEnum,
    // Free text, and `listOfficers` renders it verbatim on the one board
    // surface readable without being a member — so it gets the same filter as
    // `name`: no bidi override (it reverses what the reader sees), no C0/C1
    // controls (they carry line breaks into places that expect one line).
    customTitle: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(RENDERABLE_NAME, 'Title contains control or text-direction characters')
      .optional(),
    sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .refine((d) => d.title !== 'other' || !!d.customTitle, {
    message: 'customTitle is required when title is "other"',
    path: ['customTitle'],
  });
export type DesignateOfficerDto = z.infer<typeof designateOfficerSchema>;

// ── ADR-002 — médias portés par une association ────────────────────────────
// Le préfixe `associations/{id}/` n'est plus auto-autorisant (plusieurs
// dirigeants y déposent), donc le rôle est vérifié AVANT de signer l'upload,
// et pas seulement à l'attache. Sans ça, n'importe quel inscrit obtiendrait
// une URL signée sur l'espace d'une association dont il n'est pas dirigeant.
export const associationMediaPresignSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
});
export type AssociationMediaPresignDto = z.infer<typeof associationMediaPresignSchema>;

// ── A5 — certification (platform-admin only, see admin.controller.ts) ──────
export const verifyAssociationSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type VerifyAssociationDto = z.infer<typeof verifyAssociationSchema>;
