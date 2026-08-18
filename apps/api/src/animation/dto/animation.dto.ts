import { z } from 'zod';

/**
 * Dépôt d'une publication par l'atelier. `kind: 'law'` exige une source —
 * vérifié ici, à nouveau dans le service, et une troisième fois par une
 * contrainte CHECK en base. Trois filets pour la seule catégorie dont une
 * erreur coûte un titre de séjour à quelqu'un.
 */
export const enqueueSchema = z
  .object({
    /** nc01…nc25 — identifie le compte, jamais son e-mail ni son id. */
    handle: z
      .string()
      .trim()
      .regex(/^nc\d{2}$/, 'handle attendu au format nc01…nc25'),
    kind: z.enum(['law', 'tip', 'chat']),
    content: z.string().trim().min(1).max(5000),
    mediaUrl: z.string().url().max(500).optional(),
    sourceUrl: z.string().url().max(500).optional(),
    /** ISO 8601. Le cron publie dès que l'heure est passée. */
    scheduledAt: z.string().datetime(),
  })
  .refine((d) => d.kind !== 'law' || !!d.sourceUrl, {
    message: 'Une publication juridique exige une source officielle',
    path: ['sourceUrl'],
  });
export type EnqueueDto = z.infer<typeof enqueueSchema>;

/** Relecture humaine d'un brouillon. Le texte peut être corrigé au passage. */
export const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  content: z.string().trim().min(1).max(5000).optional(),
  sourceUrl: z.string().url().max(500).optional(),
  note: z.string().trim().max(500).optional(),
});
export type ReviewDto = z.infer<typeof reviewSchema>;

export const listQueueSchema = z.object({
  status: z.enum(['draft', 'approved', 'published', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListQueueDto = z.infer<typeof listQueueSchema>;

/** Réglages d'exploitation d'un compte, modifiables depuis la console. */
export const updateBotSchema = z
  .object({
    active: z.boolean().optional(),
    postsPerWeek: z.number().int().min(0).max(21).optional(),
    commentsPerDay: z.number().int().min(0).max(30).optional(),
    likesPerDay: z.number().int().min(0).max(100).optional(),
    friendReqPerDay: z.number().int().min(0).max(20).optional(),
    activeFromHour: z.number().int().min(0).max(23).optional(),
    activeToHour: z.number().int().min(0).max(23).optional(),
    topics: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export type UpdateBotDto = z.infer<typeof updateBotSchema>;

/** Texte de réponse écrit par l'atelier pour une conversation en attente. */
export const draftReplySchema = z.object({
  draft: z.string().trim().min(1).max(2000),
});
export type DraftReplyDto = z.infer<typeof draftReplySchema>;

/** Téléversement de l'avatar d'un compte d'animation (PNG issu de Midjourney). */
export const presignAvatarSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});
export type PresignAvatarDto = z.infer<typeof presignAvatarSchema>;

export const setAvatarSchema = z.object({
  avatarUrl: z.string().url().max(500),
});
export type SetAvatarDto = z.infer<typeof setAvatarSchema>;
