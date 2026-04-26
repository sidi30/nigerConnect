import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(128),
  deviceName: z.string().max(100).optional(),
});

export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshDto = z.infer<typeof refreshSchema>;

export const oauthSchema = z.object({
  idToken: z.string().min(1),
  deviceName: z.string().max(100).optional(),
});

export type OAuthDto = z.infer<typeof oauthSchema>;

export const appleSchema = z.object({
  identityToken: z.string().min(1),
  authorizationCode: z.string().optional(),
  // Apple only sends fullName/email on FIRST sign-in — client forwards them.
  fullName: z
    .object({
      givenName: z.string().max(100).optional(),
      familyName: z.string().max(100).optional(),
    })
    .optional(),
  email: z.string().email().optional(),
  deviceName: z.string().max(100).optional(),
});

export type AppleDto = z.infer<typeof appleSchema>;
