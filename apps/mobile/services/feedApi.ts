import type { Post, Comment, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export const feedApi = {
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
};
