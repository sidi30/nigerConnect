import type { Post, Comment, CursorPage, PublicUser } from '@nigerconnect/shared-types';
import { api } from './api';

export interface StoryGroup {
  author: PublicUser;
  stories: Post[];
}

export const feedApi = {
  async stories(): Promise<StoryGroup[]> {
    const { data } = await api.get<StoryGroup[]>('/stories/feed');
    return data;
  },

  async getFeed(params: { cursor?: string; limit?: number }): Promise<CursorPage<Post>> {
    const { data } = await api.get<CursorPage<Post>>('/feed', { params });
    return data;
  },

  async getPost(id: string): Promise<Post> {
    const { data } = await api.get<Post>(`/posts/${id}`);
    return data;
  },

  async createPost(input: {
    content?: string;
    visibility?: 'public' | 'friends' | 'association';
    associationId?: string;
    media?: Array<{ mediaUrl: string; mediaType: 'image' | 'video' }>;
  }): Promise<Post> {
    const { data } = await api.post<Post>('/posts', input);
    return data;
  },

  async toggleLike(postId: string): Promise<{ liked: boolean; count: number }> {
    const { data } = await api.post<{ liked: boolean; count: number }>(`/posts/${postId}/like`);
    return data;
  },

  async comment(postId: string, content: string, parentId?: string): Promise<Comment> {
    const { data } = await api.post<Comment>(`/posts/${postId}/comments`, { content, parentId });
    return data;
  },

  async getComments(postId: string, cursor?: string): Promise<CursorPage<Comment>> {
    const { data } = await api.get<CursorPage<Comment>>(`/posts/${postId}/comments`, {
      params: { cursor },
    });
    return data;
  },

  async share(postId: string, content?: string): Promise<Post> {
    const { data } = await api.post<Post>(`/posts/${postId}/share`, { content });
    return data;
  },

  async updatePost(
    postId: string,
    input: { content?: string; visibility?: 'public' | 'friends' | 'association' },
  ): Promise<Post> {
    const { data } = await api.patch<Post>(`/posts/${postId}`, input);
    return data;
  },

  async deletePost(postId: string): Promise<void> {
    await api.delete(`/posts/${postId}`);
  },

  async deleteComment(commentId: string): Promise<void> {
    await api.delete(`/comments/${commentId}`);
  },

  async editComment(commentId: string, content: string): Promise<Comment> {
    const { data } = await api.patch<Comment>(`/comments/${commentId}`, { content });
    return data;
  },

  async deleteStory(storyId: string): Promise<void> {
    await api.delete(`/stories/${storyId}`);
  },
};
