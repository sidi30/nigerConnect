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
  proximityAlerts: true,
  proximityRadius: true,
  newsletterOptIn: true,
  languages: true,
  privacyLevel: true,
  emailVerified: true,
  phoneVerified: true,
  // Which provider the account authenticates with (null = email+password). The
  // client uses this to never route an OAuth (Apple/Google) user to the
  // email-verification screen — Apple HIG / App Store Guideline 4. Not sensitive
  // (it's the user's own account); oauthProviderId stays stripped by the serializer.
  oauthProvider: true,
  identityStatus: true,
  isAmbassador: true,
  role: true,
  status: true,
  mfaEnabled: true,
  ratingAvg: true,
  ratingCount: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

/**
 * Whitelist of User columns exposed when ANOTHER user views this profile.
 *
 * Strictly narrower than USER_SELF_SELECT: no email, no phone, no role,
 * no internal metadata. Enough to render a card / profile header.
 *
 * Deliberately EXCLUDES exact latitude/longitude: with live GPS now written on
 * every proximity ping, exposing precise coordinates on a public profile fetch
 * would turn the app into a stalking tool. The map surfaces position only at
 * cluster/marker granularity through the dedicated geo endpoints — never here.
 * City/country are the coarsest location a profile reveals.
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
  showOnMap: true,
  languages: true,
  privacyLevel: true,
  identityStatus: true,
  isAmbassador: true,
  ratingAvg: true,
  ratingCount: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

export type SelfUser = Prisma.UserGetPayload<{ select: typeof USER_SELF_SELECT }>;
export type PublicUser = Prisma.UserGetPayload<{ select: typeof USER_PUBLIC_SELECT }>;
