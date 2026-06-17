// Tiny fetch helper + typed API client for the internal admin console.
//
// Auth model: NestJS API with Bearer JWT, CORS credentials:false (no cookies).
// The access token lives in localStorage under `nc_admin_token`. Every admin
// request injects `Authorization: Bearer <token>`. On 401/403 we clear the
// token and bounce to /admin/login so a stale/expired session can't get stuck.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export const TOKEN_KEY = "nc_admin_token";
export const ROLE_KEY = "nc_admin_role";

export type AdminRole = "user" | "moderator" | "admin";

// ---------------------------------------------------------------------------
// Token helpers (localStorage). Guarded for SSR safety even though these pages
// are client-only — keeps the module importable from a server context.
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, role: AdminRole): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(ROLE_KEY, role);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  // Hard navigation: drops all in-memory state, including any fetched ID images.
  window.location.href = "/admin/login";
}

// ---------------------------------------------------------------------------
// Core fetch helper.
// ---------------------------------------------------------------------------

export class AdminApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

interface AdminFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Fetch against the admin API with the Bearer token attached.
 *
 * - Injects `Authorization: Bearer <token>` from localStorage.
 * - Sends/parses JSON. Returns `undefined` for 204 No Content.
 * - On 401/403: clears the session and redirects to /admin/login.
 * - On any other non-2xx: throws an `AdminApiError` with the server message.
 */
export async function adminFetch<T>(
  path: string,
  options: AdminFetchOptions = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      // ID document images are sensitive: never let them sit in the HTTP cache.
      cache: "no-store",
    });
  } catch {
    throw new AdminApiError(0, "Impossible de joindre le serveur. Réessaie.");
  }

  if (res.status === 401 || res.status === 403) {
    clearSession();
    redirectToLogin();
    throw new AdminApiError(res.status, "Session expirée. Reconnecte-toi.");
  }

  if (!res.ok) {
    const message = await extractError(res);
    throw new AdminApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

async function extractError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (typeof body.message === "string") return body.message;
  } catch {
    // fall through to generic message
  }
  return `Erreur serveur (${res.status}).`;
}

// ---------------------------------------------------------------------------
// Shared / domain types
// ---------------------------------------------------------------------------

export interface LoginResponse {
  user: {
    id: string;
    email: string;
    role: AdminRole;
    displayName?: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface AdminMetrics {
  users: {
    total: number;
    emailVerified: number;
    identityApproved: number;
    signups24h: number;
    signups7d: number;
    signups7dPrev: number;
    active7d: number;
    suspended: number;
    banned: number;
  };
  identity: {
    pending: number;
    approved: number;
    rejected: number;
  };
  content: {
    posts: number;
    posts7d: number;
    messages24h: number;
    comments: number;
  };
  moderation: {
    reportsPending: number;
    resolved7d: number;
  };
}

// GET /admin/metrics/timeseries?days=30
export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  signups: number;
  posts: number;
  messages: number;
  comments: number;
  reports: number;
}

export interface MetricsTimeseries {
  days: number;
  series: TimeseriesPoint[];
}

// GET /admin/metrics/breakdowns
export type UserStatus = "active" | "suspended" | "banned";
export type UserRole = "user" | "moderator" | "admin";
export type IdentityDistStatus =
  | "not_submitted"
  | "pending"
  | "approved"
  | "rejected";
export type AuthMethod = "password" | "google" | "facebook" | "apple";

export interface MetricsBreakdowns {
  usersByCountry: Array<{ code: string; count: number }>; // code '' = unknown
  usersByStatus: Array<{ status: UserStatus; count: number }>;
  usersByRole: Array<{ role: UserRole; count: number }>;
  identityDistribution: Array<{ status: IdentityDistStatus; count: number }>;
  reportsByReason: Array<{ reason: string; count: number }>;
  reportsByTarget: Array<{ targetType: string; count: number }>;
  authMethods: Array<{ method: AuthMethod; count: number }>;
  funnel: {
    registered: number;
    emailVerified: number;
    identitySubmitted: number;
    identityApproved: number;
  };
}

export interface IdentityUser {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  identityStatus: string;
  createdAt: string;
}

export interface IdentitySubmission {
  id: string;
  userId: string;
  documentType: string;
  status: string;
  createdAt: string;
  rejectionReason: string | null;
  viewUrl: string;
  user: IdentityUser;
}

export interface IdentityListResponse {
  items: IdentitySubmission[];
  nextCursor: string | null;
}

export interface ReportReporter {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Report {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description: string | null;
  status: string;
  createdAt: string;
  reporter: ReportReporter;
}

export interface ReportListResponse {
  items: Report[];
  nextCursor: string | null;
}

// GET /reports/:id/target — resolves a report's reported content for preview.
// Discriminated on `type`; `found: false` when the target was hard-deleted.
export interface ReportTargetAuthor {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ReportTargetMedia {
  mediaUrl: string;
  thumbnailUrl: string | null;
  mediaType: string;
}

export type ReportTarget =
  | { type: "post"; found: false }
  | {
      type: "post";
      found: true;
      id: string;
      content: string | null;
      visibility: string;
      isStory: boolean;
      createdAt: string;
      deletedAt: string | null;
      author: ReportTargetAuthor;
      media: ReportTargetMedia[];
    }
  | { type: "comment"; found: false }
  | {
      type: "comment";
      found: true;
      id: string;
      content: string;
      createdAt: string;
      deletedAt: string | null;
      postId: string;
      author: ReportTargetAuthor;
    }
  | { type: "message"; found: false }
  | {
      type: "message";
      found: true;
      id: string;
      content: string | null;
      mediaUrl: string | null;
      messageType: string;
      createdAt: string;
      deletedAt: string | null;
      sender: ReportTargetAuthor;
    }
  | { type: "user"; found: false }
  | {
      type: "user";
      found: true;
      id: string;
      displayName: string | null;
      avatarUrl: string | null;
      bio: string | null;
      city: string | null;
      countryCode: string | null;
      status: string;
      createdAt: string;
    }
  | { type: "association"; found: false }
  | {
      type: "association";
      found: true;
      id: string;
      name: string;
      description: string | null;
      logoUrl: string | null;
      category: string;
      city: string | null;
      countryCode: string | null;
      createdAt: string;
    }
  | { type: string; found: false };

export type IdentityDecision = "approved" | "rejected";
export type ReportAction =
  | "warning"
  | "content_removed"
  | "suspended"
  | "banned"
  | "none";

// ---------------------------------------------------------------------------
// Public login call (no token required — used before a session exists).
// ---------------------------------------------------------------------------

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    throw new AdminApiError(0, "Impossible de joindre le serveur. Réessaie.");
  }
  if (!res.ok) {
    throw new AdminApiError(res.status, await extractError(res));
  }
  return (await res.json()) as LoginResponse;
}

// ---------------------------------------------------------------------------
// Typed admin endpoints.
// ---------------------------------------------------------------------------

export function fetchMetrics(signal?: AbortSignal): Promise<AdminMetrics> {
  return adminFetch<AdminMetrics>("/admin/metrics", { signal });
}

export function fetchTimeseries(
  days: number,
  signal?: AbortSignal,
): Promise<MetricsTimeseries> {
  return adminFetch<MetricsTimeseries>(
    `/admin/metrics/timeseries?days=${days}`,
    { signal },
  );
}

export function fetchBreakdowns(
  signal?: AbortSignal,
): Promise<MetricsBreakdowns> {
  return adminFetch<MetricsBreakdowns>("/admin/metrics/breakdowns", { signal });
}

export function fetchPendingIdentity(
  signal?: AbortSignal,
): Promise<IdentityListResponse> {
  return adminFetch<IdentityListResponse>("/admin/identity?status=pending", {
    signal,
  });
}

export function reviewIdentity(
  userId: string,
  decision: IdentityDecision,
  reason?: string,
): Promise<void> {
  const body: { userId: string; decision: IdentityDecision; reason?: string } = {
    userId,
    decision,
  };
  if (decision === "rejected" && reason) body.reason = reason;
  return adminFetch<void>("/auth/identity/review", {
    method: "PATCH",
    body,
  });
}

export function fetchPendingReports(
  signal?: AbortSignal,
): Promise<ReportListResponse> {
  return adminFetch<ReportListResponse>("/reports?status=pending", { signal });
}

export function fetchReportTarget(
  id: string,
  signal?: AbortSignal,
): Promise<ReportTarget> {
  return adminFetch<ReportTarget>(`/reports/${id}/target`, { signal });
}

export function resolveReport(
  id: string,
  action: ReportAction,
  note?: string,
): Promise<void> {
  const body: { action: ReportAction; note?: string } = { action };
  if (note) body.note = note;
  return adminFetch<void>(`/reports/${id}/resolve`, {
    method: "PATCH",
    body,
  });
}

// ---------------------------------------------------------------------------
// Newsletter — subscribers + campaigns (admin-only).
// ---------------------------------------------------------------------------

export type NewsletterSubStatus = "subscribed" | "unsubscribed";

export interface NewsletterSubscriber {
  id: string;
  email: string;
  status: NewsletterSubStatus;
  source: string | null;
  locale: string | null;
  createdAt: string;
  unsubscribedAt: string | null;
}

export interface NewsletterSubscriberList {
  items: NewsletterSubscriber[];
  nextCursor: string | null;
}

export interface NewsletterStats {
  subscribed: number;
  unsubscribed: number;
  total: number;
}

export type CampaignStatus = "draft" | "sending" | "sent" | "failed";

export interface NewsletterCampaign {
  id: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdById: string | null;
  createdAt: string;
  sentAt: string | null;
}

export function fetchSubscribers(
  status?: NewsletterSubStatus,
  cursor?: string,
  signal?: AbortSignal,
): Promise<NewsletterSubscriberList> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return adminFetch<NewsletterSubscriberList>(
    `/admin/newsletter/subscribers${qs ? `?${qs}` : ""}`,
    { signal },
  );
}

export function fetchNewsletterStats(
  signal?: AbortSignal,
): Promise<NewsletterStats> {
  return adminFetch<NewsletterStats>("/admin/newsletter/subscribers/stats", {
    signal,
  });
}

export function fetchCampaigns(
  signal?: AbortSignal,
): Promise<NewsletterCampaign[]> {
  return adminFetch<NewsletterCampaign[]>("/admin/newsletter/campaigns", {
    signal,
  });
}

export function createCampaign(input: {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): Promise<NewsletterCampaign> {
  return adminFetch<NewsletterCampaign>("/admin/newsletter/campaigns", {
    method: "POST",
    body: input,
  });
}

export function deleteCampaign(id: string): Promise<void> {
  return adminFetch<void>(`/admin/newsletter/campaigns/${id}`, {
    method: "DELETE",
  });
}

export function sendTestCampaign(id: string, email: string): Promise<void> {
  return adminFetch<void>(`/admin/newsletter/campaigns/${id}/test`, {
    method: "POST",
    body: { email },
  });
}

export function sendCampaign(
  id: string,
): Promise<{ totalRecipients: number }> {
  return adminFetch<{ totalRecipients: number }>(
    `/admin/newsletter/campaigns/${id}/send`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Invitations / Settings (§5.3)
// ---------------------------------------------------------------------------

export type RegistrationMode = "open" | "invite_only" | "closed";

export interface AdminSettings {
  registrationMode: RegistrationMode;
  defaultInviteQuota: number;
  inviteExpiryDays: number;
}

export type InvitationKind = "single_use" | "reusable";

export interface RootInvite {
  code: string;
  url: string;
  /** Always null in v2 (invitations no longer expire). */
  expiresAt: string | null;
  kind?: InvitationKind;
}

export interface InviteMetrics {
  sent: number;
  accepted: number;
  pending: number;
  expired: number;
  revoked: number;
  conversionRate: number;
  kFactor: number;
  topInviters: Array<{ name: string; count: number }>;
}

export function fetchAdminSettings(signal?: AbortSignal): Promise<AdminSettings> {
  return adminFetch<AdminSettings>("/admin/settings", { signal });
}

export function patchAdminSettings(
  body: Partial<{
    registrationMode: RegistrationMode;
    defaultInviteQuota: number;
    inviteExpiryDays: number;
  }>,
): Promise<AdminSettings> {
  return adminFetch<AdminSettings>("/admin/settings", { method: "PATCH", body });
}

export function generateRootInvites(
  count: number,
  options?: { expiresInDays?: number; kind?: InvitationKind },
): Promise<RootInvite[]> {
  const payload: {
    count: number;
    expiresInDays?: number;
    kind?: InvitationKind;
  } = { count };
  if (options?.expiresInDays !== undefined)
    payload.expiresInDays = options.expiresInDays;
  if (options?.kind !== undefined) payload.kind = options.kind;
  return adminFetch<RootInvite[]>("/admin/invitations/root", {
    method: "POST",
    body: payload,
  });
}

export function fetchInviteMetrics(signal?: AbortSignal): Promise<InviteMetrics> {
  return adminFetch<InviteMetrics>("/admin/invitations/metrics", { signal });
}

// ---------------------------------------------------------------------------
// Referral network (v2)
// ---------------------------------------------------------------------------

/** User node in the referral tree returned by GET /admin/referrals. */
export interface ReferralNode {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  /** Parrain direct — null for root / uninvited accounts. */
  invitedBy: { id: string; displayName: string | null } | null;
  /** Via which invitation kind the account registered (null for root accounts). */
  via: { kind: "single_use" | "reusable" } | null;
  /** Number of accounts directly sponsored by this user. */
  inviteesCount: number;
}

export interface ReferralListResponse {
  items: ReferralNode[];
  nextCursor: string | null;
}

/**
 * GET /admin/referrals?cursor=&limit=
 * Paginated list of recent members with their parrain chain.
 */
export function listReferrals(
  cursor?: string,
  limit?: number,
  signal?: AbortSignal,
): Promise<ReferralListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  return adminFetch<ReferralListResponse>(
    `/admin/referrals${qs ? `?${qs}` : ""}`,
    { signal },
  );
}

/** PATCH /admin/users/:id/bulk-invite — grants or revokes the reusable-link right. */
export function setBulkInviteRight(
  userId: string,
  allowed: boolean,
): Promise<{ id: string; canBulkInvite: boolean }> {
  return adminFetch<{ id: string; canBulkInvite: boolean }>(
    `/admin/users/${userId}/bulk-invite`,
    { method: "PATCH", body: { allowed } },
  );
}
