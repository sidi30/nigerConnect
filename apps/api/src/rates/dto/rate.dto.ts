import { z } from 'zod';

export const communityPriceTypeEnum = z.enum([
  'billet_avion',
  'transfert_argent',
  'colis_kg',
]);

// A community price report. `submitterId` is NEVER read from the body — it is
// derived from the JWT in the service layer (anti-IDOR, mirror of
// services.service create). `amount` is a positive decimal serialised as string
// to preserve precision across the wire.
export const createCommunityPriceSchema = z.object({
  type: communityPriceTypeEnum,
  originCity: z.string().trim().min(1).max(100).optional(),
  originCountry: z.string().length(2).toUpperCase().optional(),
  destCity: z.string().trim().min(1).max(100).optional(),
  destCountry: z.string().length(2).toUpperCase().optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  amount: z.coerce.number().positive().max(100_000_000).finite(),
  currency: z.string().length(3).toUpperCase(),
  note: z.string().trim().max(280).optional(),
});
export type CreateCommunityPriceDto = z.infer<typeof createCommunityPriceSchema>;

// Owner-only correction — only the mutable value fields, never type/route
// (a wrong route is a delete + re-create, not an edit).
export const updateCommunityPriceSchema = z
  .object({
    provider: z.string().trim().min(1).max(100).optional(),
    amount: z.coerce.number().positive().max(100_000_000).finite().optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    note: z.string().trim().max(280).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateCommunityPriceDto = z.infer<typeof updateCommunityPriceSchema>;

export const listCommunityPricesSchema = z.object({
  type: communityPriceTypeEnum.optional(),
  originCountry: z.string().length(2).toUpperCase().optional(),
  destCountry: z.string().length(2).toUpperCase().optional(),
  // Only 'active' is listable through this member-facing endpoint. Moderation-
  // removed rows (scam/abuse taken down via Report → content_removed) must NEVER
  // be re-surfaceable by a query param — a `?status=removed` filter would let any
  // authenticated member undo a takedown. Reviewing removed content is a
  // moderation-console concern (getTarget), not a public listing one. Locking the
  // literal here means an explicit `status=removed` is rejected (400), not served.
  status: z.literal('active').default('active'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListCommunityPricesDto = z.infer<typeof listCommunityPricesSchema>;

export const voteCommunityPriceSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1)]),
});
export type VoteCommunityPriceDto = z.infer<typeof voteCommunityPriceSchema>;
