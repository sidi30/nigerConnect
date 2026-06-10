import type { Review, ReviewSummary, ReviewTargetType, CursorPage } from '@nigerconnect/shared-types';
import { api } from './api';

export interface UpsertReviewInput {
  targetType: ReviewTargetType;
  targetId: string;
  rating: number;
  comment?: string;
}

export const reviewsApi = {
  async list(
    targetType: ReviewTargetType,
    targetId: string,
    cursor?: string,
  ): Promise<CursorPage<Review>> {
    const { data } = await api.get<CursorPage<Review>>(
      `/reviews/${targetType}/${targetId}`,
      { params: cursor ? { cursor } : undefined },
    );
    return data;
  },

  async summary(targetType: ReviewTargetType, targetId: string): Promise<ReviewSummary> {
    const { data } = await api.get<ReviewSummary>(
      `/reviews/${targetType}/${targetId}/summary`,
    );
    return data;
  },

  async upsert(input: UpsertReviewInput): Promise<Review> {
    const { data } = await api.post<Review>('/reviews', {
      targetType: input.targetType,
      targetId: input.targetId,
      rating: input.rating,
      comment: input.comment,
    });
    return data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/reviews/${id}`);
  },
};
