import type { User } from '@prisma/client';

const SENSITIVE_FIELDS = [
  'passwordHash',
  'mfaSecret',
  'failedLoginCount',
  'lockedUntil',
  'lastLoginIp',
] as const;

export function serializeUser(user: User) {
  const clone: Partial<Record<keyof User, unknown>> = { ...user };
  for (const key of SENSITIVE_FIELDS) delete clone[key];
  return {
    ...clone,
    latitude: user.latitude === null ? null : Number(user.latitude),
    longitude: user.longitude === null ? null : Number(user.longitude),
  };
}

export type SerializedUser = ReturnType<typeof serializeUser>;
