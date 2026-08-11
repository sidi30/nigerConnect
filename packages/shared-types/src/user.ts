export type UserRole = 'user' | 'moderator' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'banned';
export type IdentityStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';
export type PrivacyLevel = 'public' | 'friends' | 'private';

export interface PublicUser {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  identityStatus: IdentityStatus;
  /** Admin-curated ambassador distinction, independent of identity verification. */
  isAmbassador: boolean;
  /**
   * Official NigerConnect account — the voice of the platform itself, not a
   * member. Carries the blue badge, is absent from every discovery surface
   * (search, suggestions, map, proximity) and cannot be friended or DMed; it is
   * the only account allowed to address the whole community at once.
   */
  isOfficial?: boolean;
  ratingAvg: number;
  ratingCount: number;
}

export interface User extends PublicUser {
  email: string | null;
  phone: string | null;
  bio: string | null;
  coverUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  showOnMap: boolean;
  proximityAlerts: boolean;
  proximityRadius: number;
  /** Receive NigerConnect announcements & newsletter (opt-out, default true). */
  newsletterOptIn: boolean;
  /** Receive the weekly activity digest (opt-out, default true). */
  digestOptIn: boolean;
  languages: string[];
  privacyLevel: PrivacyLevel;
  emailVerified: boolean;
  phoneVerified: boolean;
  // null = email+password account. Set = the account signs in via this provider;
  // the app uses it to skip the email-verification gate for OAuth users.
  oauthProvider: 'google' | 'apple' | 'facebook' | null;
  role: UserRole;
  status: UserStatus;
  mfaEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Authoritative profile counters (S3/PR1 — apps/api ProfileService.loadCounts).
 * Optional: only `/profile/me` and `/profile/:id` attach them, not every
 * endpoint that returns a `User`/`PublicUser` shape (e.g. search results).
 *
 * `friendsCount`/`postsCount` are `null` when the viewer isn't allowed to see
 * the underlying list (a `friends`-privacy profile viewed by a non-friend) —
 * never a fabricated number, to avoid leaking the target's network size.
 * `photosCount` is never gated further than the profile header itself.
 */
export interface ProfileCounts {
  friendsCount?: number | null;
  postsCount?: number | null;
  photosCount?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}
