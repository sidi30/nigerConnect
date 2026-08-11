import { z } from 'zod';
import { postMediaSchema } from '../../feed/dto/post.dto';

/**
 * Profil du compte officiel. `avatarUrl`/`coverUrl` sont des URL rendues par la
 * console : elles sont liées à notre propre bucket côté service (jamais
 * persistées telles quelles), comme partout ailleurs.
 */
export const updateOfficialSchema = z
  .object({
    displayName: z.string().trim().min(2).max(60).optional(),
    bio: z.string().trim().max(1000).nullable().optional(),
    avatarUrl: z.string().url().max(500).nullable().optional(),
    coverUrl: z.string().url().max(500).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Au moins un champ est requis' });
export type UpdateOfficialDto = z.infer<typeof updateOfficialSchema>;

/** Presign d'un média posté PAR le compte officiel (avatar, photo, story). */
export const officialUploadSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});
export type OfficialUploadDto = z.infer<typeof officialUploadSchema>;

/**
 * Chemin d'ouverture dans l'app au tap de la notification. Interne uniquement :
 * un chemin absolu, jamais une URL — sinon la notification devient un vecteur
 * de redirection vers l'extérieur pour toute la communauté d'un seul envoi.
 */
const linkPathSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[A-Za-z0-9\-_/.?=&%]*$/, 'Chemin interne attendu (ex. /post/<id>)')
  .optional();

/** Notification à toute la communauté : cloche + push, sans conversation. */
export const broadcastNotificationSchema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(1).max(500),
  linkPath: linkPathSchema,
});
export type BroadcastNotificationDto = z.infer<typeof broadcastNotificationSchema>;

/**
 * Message direct — à tout le monde ou à une personne. Le membre le reçoit
 * exactement comme un message reçu : conversation, badge non-lu, push.
 */
export const officialMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  imageUrl: z.string().url().max(500).optional(),
});
export type OfficialMessageDto = z.infer<typeof officialMessageSchema>;

export const officialDirectMessageSchema = officialMessageSchema.extend({
  userId: z.string().uuid(),
});
export type OfficialDirectMessageDto = z.infer<typeof officialDirectMessageSchema>;

/**
 * Publication officielle. `announce` déclenche en plus une notification à toute
 * la communauté qui pointe sur la publication — c'est ce qui distingue « poster »
 * de « faire passer une information ».
 */
export const officialPostSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  media: z.array(postMediaSchema).max(10).optional(),
  announce: z.boolean().default(false),
  announceTitle: z.string().trim().max(140).optional(),
});
export type OfficialPostDto = z.infer<typeof officialPostSchema>;

/** Story officielle (24 h). Image uniquement : la vidéo reste sous kill-switch. */
export const officialStorySchema = z.object({
  content: z.string().trim().max(500).optional(),
  media: postMediaSchema.extend({ mediaType: z.literal('image') }),
  announce: z.boolean().default(false),
});
export type OfficialStoryDto = z.infer<typeof officialStorySchema>;

export const officialThreadsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type OfficialThreadsQueryDto = z.infer<typeof officialThreadsQuerySchema>;

export const officialMessagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OfficialMessagesQueryDto = z.infer<typeof officialMessagesQuerySchema>;
