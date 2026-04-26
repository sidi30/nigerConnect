import type { User } from '@prisma/client';

const SENSITIVE_FIELDS = [
  'passwordHash',
  'mfaSecret',
  'failedLoginCount',
  'lockedUntil',
  'lastLoginIp',
  'oauthProviderId',
] as const;

/**
 * Strip sensitive columns and normalize Decimal lat/lon to number.
 *
 * Accepts any user-like shape: the full `User` row from Prisma as well as
 * the narrowed shapes produced by `USER_SELF_SELECT` / `USER_PUBLIC_SELECT`.
 * When narrowed shapes are used, the sensitive fields aren't even present —
 * the deletes below are harmless no-ops (defense in depth).
 */
export function serializeUser(
  user: Partial<User> & {
    latitude?: unknown;
    longitude?: unknown;
  },
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...user };
  for (const key of SENSITIVE_FIELDS) delete clone[key];
  const lat = user.latitude as { toString: () => string } | null | undefined;
  const lon = user.longitude as { toString: () => string } | null | undefined;
  clone.latitude = lat === null || lat === undefined ? null : Number(lat);
  clone.longitude = lon === null || lon === undefined ? null : Number(lon);
  return clone;
}

export type SerializedUser = ReturnType<typeof serializeUser>;
