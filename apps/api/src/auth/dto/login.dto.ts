import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
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
