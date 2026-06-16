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
  // Optional anti-replay nonce. When the client supplies it, the server asserts
  // it matches the `nonce` claim Google echoed into the ID token. Optional for
  // backward compatibility — older clients that don't send it still work, but a
  // present-and-mismatched nonce is rejected.
  nonce: z.string().min(1).max(256).optional(),
  deviceName: z.string().max(100).optional(),
  // Parrainage (§5.1): optional invite code. Required in 'invite_only' mode
  // for the account-creation branch only. Ignored for existing-account logins.
  inviteCode: z.string().trim().min(6).max(16).optional(),
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
  // Optional anti-replay nonce — the RAW value the client generated. The client
  // passed `sha256(rawNonce)` to AppleAuth.signInAsync, so the server hashes
  // this and asserts it equals the token's `nonce` claim. Optional for backward
  // compatibility; a present-and-mismatched nonce is rejected.
  rawNonce: z.string().min(1).max(256).optional(),
  deviceName: z.string().max(100).optional(),
  // Parrainage (§5.1): optional invite code. Required in 'invite_only' mode
  // for the account-creation branch only. Ignored for existing-account logins.
  inviteCode: z.string().trim().min(6).max(16).optional(),
});

export type AppleDto = z.infer<typeof appleSchema>;
