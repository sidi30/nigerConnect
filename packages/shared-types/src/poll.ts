import type { PublicUser } from './user';

export interface PollOption {
  id: string;
  label: string;
  voteCount: number;
  sortOrder: number;
}

export interface Poll {
  id: string;
  pageId: string | null;
  author: PublicUser | null;
  question: string;
  multiChoice: boolean;
  expiresAt: string | null;
  voteCount: number;
  createdAt: string;
  options: PollOption[];
  /** Option ids the current viewer voted for (empty if not voted / anonymous). */
  myVotes: string[];
  /** True when expiresAt is in the past. */
  closed: boolean;
}
