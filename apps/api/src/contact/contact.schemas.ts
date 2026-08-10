import { z } from 'zod';

/**
 * Message de contact envoyé depuis l'app (partenariat, demande d'info, souci).
 *
 * Les bornes correspondent aux colonnes (cf. schema.prisma) : dépasser côté Zod
 * ferait remonter une erreur Postgres illisible au lieu d'un 400 explicite.
 */
export const createContactSchema = z
  .object({
    topic: z.enum(['partnership', 'info', 'problem', 'other']).default('info'),
    // Adresse de réponse. Pré-remplie avec celle du compte côté mobile, mais
    // modifiable : un membre peut vouloir être joint sur une adresse pro.
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().min(6).max(32).optional(),
    subject: z.string().trim().min(3).max(140),
    message: z.string().trim().min(10).max(4000),
  })
  .strict();
export type CreateContactDto = z.infer<typeof createContactSchema>;

export const listContactSchema = z
  .object({
    // 'all' = tout, y compris les messages déjà traités.
    status: z.enum(['new', 'read', 'handled', 'all']).default('new'),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ListContactDto = z.infer<typeof listContactSchema>;

export const patchContactSchema = z
  .object({
    status: z.enum(['new', 'read', 'handled']),
  })
  .strict();
export type PatchContactDto = z.infer<typeof patchContactSchema>;
