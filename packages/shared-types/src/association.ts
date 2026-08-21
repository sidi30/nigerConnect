import type { PublicUser } from './user';

export type AssociationCategory =
  | 'generaliste'
  | 'etudiants'
  | 'femmes'
  | 'jeunesse'
  | 'culture'
  | 'business'
  | 'sport'
  | 'religieux';

// `owner` (A3) is the founder/current title-holder — an `admin` can never
// modify an `owner`'s (or another `admin`'s) role. Set at creation, moved only
// through the accept-side of an ownership transfer.
export type AssociationRole = 'owner' | 'admin' | 'moderator' | 'member';
export type MembershipStatus = 'pending' | 'approved';

// A1 (course-corrected) — default 'public': the nominative member list
// (GET /associations/:id/members) is readable by any authenticated user
// unless THIS association's admin/owner opts into 'members_only'
// (association.service.ts listMembers). Not related to `PrivacyLevel` —
// that's a per-USER setting, this is a per-ASSOCIATION one.
export type AssociationMembersVisibility = 'public' | 'members_only';

export interface Association {
  id: string;
  name: string;
  /** Immutable, generated once at creation (A6 anti-squat). */
  slug: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  category: AssociationCategory;
  countryCode: string | null;
  city: string | null;
  website: string | null;
  contactEmail: string | null;
  isVerified: boolean;
  /** A5 — set only via the platform-admin verify endpoint. Null if never verified. */
  verifiedAt: string | null;
  // A1 — default 'public'. See AssociationMembersVisibility above.
  membersVisibility: AssociationMembersVisibility;
  memberCount: number;
  // A1 — no `createdBy`/`createdById`. `listMembers` is open by default now
  // (see `membersVisibility`), and the founder IS reachable there as the
  // `owner` role — but THIS lighter read has no visibility knob at all, so
  // it still refuses to name the founder directly: for a `religieux`
  // association (RGPD art.9) "who founded it" is the single most sensitive
  // membership fact, and this field is unconditionally public. Accepted
  // board members (AssociationOfficer) are the one nominative exposure here,
  // and that one is consented.
  createdAt: string;
  updatedAt: string;
}

export interface AssociationMember {
  associationId: string;
  user: PublicUser;
  role: AssociationRole;
  status: MembershipStatus;
  joinedAt: string;
}

export interface AssociationEvent {
  id: string;
  associationId: string;
  title: string;
  description: string | null;
  eventDate: string;
  location: string | null;
  coverUrl: string | null;
  createdAt: string;
}

export type AssociationOfficerTitle =
  | 'president'
  | 'vice_president'
  | 'secretary'
  | 'treasurer'
  | 'spokesperson'
  | 'other';

// A4 — bureau exécutif, distinct de AssociationRole. N'apparaît côté client
// qu'une fois accepté (acceptedAt non-null) : voir association.service.ts
// listOfficers().
export interface AssociationOfficer {
  id: string;
  associationId: string;
  user: PublicUser;
  title: AssociationOfficerTitle;
  customTitle: string | null;
  sortOrder: number;
  acceptedAt: string;
}
