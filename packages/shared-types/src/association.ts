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

export type AssociationRole = 'admin' | 'moderator' | 'member';
export type MembershipStatus = 'pending' | 'approved';

export interface Association {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  category: AssociationCategory;
  countryCode: string | null;
  city: string | null;
  website: string | null;
  contactEmail: string | null;
  isVerified: boolean;
  memberCount: number;
  createdBy: PublicUser;
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
