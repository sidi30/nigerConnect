import type { PublicUser } from './user';

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'like'
  | 'comment'
  | 'message'
  | 'service_response'
  | 'association_invite'
  | 'identity_approved'
  | 'identity_rejected'
  | 'system';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  actor: PublicUser | null;
  read: boolean;
  createdAt: string;
}
