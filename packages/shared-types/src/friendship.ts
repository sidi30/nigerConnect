import type { PublicUser } from './user';

export type FriendshipStatus = 'pending' | 'accepted' | 'declined';

export interface Friendship {
  id: string;
  requester: PublicUser;
  addressee: PublicUser;
  status: FriendshipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FriendSuggestion {
  user: PublicUser;
  mutualFriends: number;
  sameCountry: boolean;
  sameCity: boolean;
  score: number;
}
