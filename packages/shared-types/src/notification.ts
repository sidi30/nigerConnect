import type { PublicUser } from './user';

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'like'
  | 'comment'
  | 'message'
  | 'service_response'
  | 'association_invite'
  | 'association_join_request'
  | 'association_join_approved'
  | 'association_join_rejected'
  | 'identity_approved'
  | 'identity_rejected'
  | 'proximity'
  | 'page_follow'
  | 'poll_new'
  | 'review_received'
  | 'system'
  | 'invite_accepted';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  actor: PublicUser | null;
  read: boolean;
  /** ISO instant after which the item is purged from history (24h default). */
  expiresAt: string | null;
  createdAt: string;
}
