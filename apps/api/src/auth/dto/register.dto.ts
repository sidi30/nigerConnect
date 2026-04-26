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
  avatarUrl: z.string().url().max(500).optional(),
});

export type RegisterDto = z.infer<typeof registerSchema>;
