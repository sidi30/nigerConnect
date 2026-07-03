import type { PublicUser } from './user';

export type ServiceCategory =
  | 'logement'
  | 'transport'
  | 'admin_category'
  | 'sante'
  | 'emploi'
  | 'business'
  | 'education'
  | 'autre';

export type ServiceUrgency = 'urgent' | 'normal';
export type ServiceStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
// Free help request (default landing) vs paid service listing (secondary).
export type ServiceIntent = 'help_free' | 'paid_service';

// Ordered gallery item on a service request — mirrors PostMedia (image-only V1).
export interface ServiceMedia {
  id: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  mediaType: 'image';
  width: number | null;
  height: number | null;
  blurhash: string | null;
  sortOrder: number;
}

export interface ServiceRequest {
  id: string;
  author: PublicUser;
  title: string;
  description: string | null;
  category: ServiceCategory;
  intent: ServiceIntent;
  urgency: ServiceUrgency;
  budget: string | null;
  city: string | null;
  countryCode: string | null;
  status: ServiceStatus;
  responseCount: number;
  media: ServiceMedia[];
  createdAt: string;
  updatedAt: string;
}

export interface ServiceResponse {
  id: string;
  requestId: string;
  responder: PublicUser;
  message: string;
  accepted: boolean;
  createdAt: string;
}

export interface ServiceRating {
  id: string;
  requestId: string;
  ratedUserId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}
