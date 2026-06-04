import type { PublicUser } from './user';

export type ReviewTargetType = 'user' | 'page';

export interface Review {
  id: string;
  author: PublicUser;
  targetType: ReviewTargetType;
  targetUserId: string | null;
  targetPageId: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  ratingAvg: number;
  ratingCount: number;
  /** Count of reviews per star value, index 0 = 1★ … index 4 = 5★. */
  distribution: [number, number, number, number, number];
  /** The current viewer's own review of this target, if any. */
  myReview: Review | null;
}
