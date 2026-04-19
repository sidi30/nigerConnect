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

export interface Post {
  id: string;
  author: PublicUser;
  content: string | null;
  visibility: PostVisibility;
  associationId: string | null;
  isStory: boolean;
  storyExpiresAt: string | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  isLikedByMe: boolean;
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
  replies?: Comment[];
  createdAt: string;
}
