import type { PublicUser } from './user';

export type PageKind = 'community' | 'cause' | 'business' | 'official' | 'group';
export type PageRole = 'admin' | 'editor';

export interface Page {
  id: string;
  name: string;
  description: string | null;
  kind: PageKind;
  avatarUrl: string | null;
  coverUrl: string | null;
  countryCode: string | null;
  city: string | null;
  website: string | null;
  contactEmail: string | null;
  isVerified: boolean;
  followerCount: number;
  ratingAvg: number;
  ratingCount: number;
  createdBy: PublicUser | null;
  createdAt: string;
  updatedAt: string;
}

/** Page enriched with the current viewer's relationship to it. */
export interface PageWithViewer extends Page {
  isFollowing: boolean;
  myRole: PageRole | null;
}
