import type { PublicUser } from './user';

export type PostVisibility = 'public' | 'friends' | 'association';
export type MediaType = 'image' | 'video';

export interface PostMedia {
  id: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  mediaType: MediaType;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  sortOrder: number;
}

/**
 * Original post a share refers back to. Comes WITHOUT viewer-specific fields
 * (`isLikedByMe`) and never recurses (no shared-of-shared chains in the wire
 * format). Backend serializer only attaches author + media.
 */
export interface SharedPost {
  id: string;
  author: PublicUser;
  content: string | null;
  visibility: PostVisibility;
  isStory: boolean;
  media: PostMedia[];
  createdAt: string;
}

export interface Post {
  id: string;
  author: PublicUser;
  content: string | null;
  visibility: PostVisibility;
  associationId: string | null;
  isStory: boolean;
  storyExpiresAt: string | null;
  /** When set, this post is a re-share. The original is here. */
  sharedPost: SharedPost | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  isLikedByMe: boolean;
  /** The viewer's chosen reaction emoji (e.g. '❤️','😂'), or null if none. */
  myReaction?: string | null;
  /** Top reaction emojis with counts (the pile under a post), count-desc. */
  reactionCounts?: { emoji: string; count: number }[];
  media: PostMedia[];
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  author: PublicUser;
  parentId: string | null;
  content: string;
  likeCount: number;
  isLikedByMe?: boolean;
  /** The viewer's chosen reaction emoji on this comment, or null. */
  myReaction?: string | null;
  replies?: Comment[];
  createdAt: string;
}

/**
 * One country the viewer can switch their feed to. Volume-ordered by the API —
 * the client renders them in the order it receives, it does not re-sort.
 */
export interface FeedCountry {
  /** ISO-3166-1 alpha-2. */
  countryCode: string;
  /** Public posts behind that chip. The viewer's own country may be 0. */
  posts: number;
  authors: number;
}

export interface FeedCountries {
  items: FeedCountry[];
  /** The viewer's own country, i.e. the default feed. Null if never filled in. */
  ownCountry: string | null;
}
