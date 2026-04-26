import { api } from './api';

export type ReportTargetType = 'user' | 'post' | 'message' | 'association' | 'comment';
export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'inappropriate'
  | 'fake_identity'
  | 'scam'
  | 'other';

export interface CreateReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  description?: string;
}

export const moderationApi = {
  async create(input: CreateReportInput): Promise<void> {
    await api.post('/reports', input);
  },
};
