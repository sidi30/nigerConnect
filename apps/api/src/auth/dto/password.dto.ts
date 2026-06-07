import { z } from 'zod';

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const verifyEmailCodeSchema = z.object({
  // Exactly 6 digits. Strip spaces the user might paste from the email.
  code: z
    .string()
    .transform((s) => s.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'Le code doit contenir 6 chiffres')),
});
export type VerifyEmailCodeDto = z.infer<typeof verifyEmailCodeSchema>;
