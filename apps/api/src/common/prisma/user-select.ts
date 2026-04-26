import type { Prisma } from '@prisma/client';

/**
 * Whitelist of User columns that are safe to expose to the CURRENT user (self).
 *
 * - EXCLUDES secrets / internal counters : passwordHash, mfaSecret, failedLoginCount,
 *   lockedUntil, lastLoginIp, oauthProviderId, oauthProvider.
 * - KEEPS identity fields the client needs to render "My account": email, phone,
 *   mfaEnabled, identityStatus, role, status, …
 *
 * Prefer this select over `prisma.user.findX()` with no `select`. Defense in depth:
 * the serializer (`auth.serializer.ts`) already strips sensitive fields before
 * returning to the client, but nothing prevents a service from logging or caching
 * the raw row. A narrow DB read removes that risk entirely.
 */
export const USER_SELF_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  coverUrl: true,
  city: true,
  countryCode: true,
  latitude: true,
  longitude: true,
  showOnMap: true,
  languages: true,
  privacyLevel: true,
  emailVerified: true,
  phoneVerified: true,
  identityStatus: true,
  role: true,
  status: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

/**
 * Whitelist of User columns exposed when ANOTHER user views this profile.
 *
 * Strictly narrower than USER_SELF_SELECT: no email, no phone, no role,
 * no internal metadata. Enough to render a card / profile header.
 */
export const USER_PUBLIC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  coverUrl: true,
  city: true,
  countryCode: true,
  latitude: true,
  longitude: true,
  showOnMap: true,
  languages: true,
  privacyLevel: true,
  identityStatus: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

export type SelfUser = Prisma.UserGetPayload<{ select: typeof USER_SELF_SELECT }>;
export type PublicUser = Prisma.UserGetPayload<{ select: typeof USER_PUBLIC_SELECT }>;
