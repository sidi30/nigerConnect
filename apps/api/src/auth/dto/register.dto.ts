import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,19}$/, 'Phone must be in international format (e.g. +22790000000)')
    .optional(),
  city: z.string().min(1).max(100).trim().optional(),
  countryCode: z
    .string()
    .length(2, 'countryCode must be ISO-3166-1 alpha-2')
    .toUpperCase()
    .optional(),
  bio: z.string().max(1000).optional(),
  // Pas d'avatarUrl au register : une URL client brute ne doit jamais être
  // persistée (elle n'est pas bindée S3). L'avatar se règle après inscription
  // via updateAvatar, qui valide l'appartenance via S3Service.
  // Client-provided coordinates from the city search endpoint. When present
  // these are used directly (with jitter) instead of running geocode(), so
  // a city that has no entry in the hardcoded diaspora map still gets correct
  // map placement. Values are validated to legal WGS-84 ranges.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Parrainage (§5.1): optional invite code forwarded by the client.
  // Ignored in 'open' mode; required + consumed in 'invite_only'.
  inviteCode: z.string().trim().min(6).max(16).optional(),
}).refine(
  // A coordinate is only meaningful as a (lat, lng) pair. Reject a half-supplied
  // pair so the register() coords branch never runs with one axis undefined.
  (d) => (d.latitude === undefined) === (d.longitude === undefined),
  { message: 'latitude and longitude must be provided together', path: ['latitude'] },
);

export type RegisterDto = z.infer<typeof registerSchema>;
