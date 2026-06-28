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

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}
