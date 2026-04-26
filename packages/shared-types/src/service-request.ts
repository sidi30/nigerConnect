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

export interface ServiceRequest {
  id: string;
  author: PublicUser;
  title: string;
  description: string | null;
  category: ServiceCategory;
  urgency: ServiceUrgency;
  budget: string | null;
  city: string | null;
  countryCode: string | null;
  status: ServiceStatus;
  responseCount: number;
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
