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
  /** Real usage, from `lastSeenAt`. `users.active7d` counts logins, not visits. */
  activity: {
    dau: number;
    wau: number;
    mau: number;
    /** DAU/MAU as a whole percent. */
    stickiness: number;
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

/** Login may resolve to a TOTP challenge instead of a session. */
export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaToken: string;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse | MfaChallengeResponse> {
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
  return (await res.json()) as LoginResponse | MfaChallengeResponse;
}

/** Second login step — exchange the MFA challenge + a TOTP/recovery code for a session. */
export async function verifyMfa(mfaToken: string, code: string): Promise<LoginResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ mfaToken, code }),
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
// MFA / TOTP management (authenticated)
// ---------------------------------------------------------------------------

/** Begin TOTP enrollment — returns the secret + otpauth URL to render as a QR. */
export function mfaEnroll(): Promise<{ secret: string; otpauthUrl: string }> {
  return adminFetch<{ secret: string; otpauthUrl: string }>("/auth/mfa/enroll", { method: "POST" });
}

/** Confirm enrollment with a live code → enables MFA, returns one-time recovery codes. */
export function mfaConfirm(code: string): Promise<{ recoveryCodes: string[] }> {
  return adminFetch<{ recoveryCodes: string[] }>("/auth/mfa/confirm", {
    method: "POST",
    body: { code },
  });
}

/** Disable MFA — requires a valid TOTP or recovery code. */
export function mfaDisable(code: string): Promise<void> {
  return adminFetch<void>("/auth/mfa/disable", { method: "POST", body: { code } });
}

/** Whether the current session's user has MFA enabled. */
export function mfaStatus(): Promise<{ mfaEnabled: boolean }> {
  return adminFetch<{ mfaEnabled: boolean }>("/auth/mfa/status");
}

// ---------------------------------------------------------------------------
// Typed admin endpoints.
// ---------------------------------------------------------------------------

export function fetchMetrics(signal?: AbortSignal): Promise<AdminMetrics> {
  return adminFetch<AdminMetrics>("/admin/metrics", { signal });
}

/**
 * Survie d'une cohorte hebdomadaire. `null` = fenêtre non échue pour cette
 * cohorte (surtout pas 0 : une cohorte de trois jours n'a pas « perdu » ses
 * membres à 30 jours, elle n'y est pas encore).
 */
export interface RetentionCohort {
  week: string;
  size: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export interface AdminRetention {
  weeks: number;
  cohorts: RetentionCohort[];
  overall: { size: number; d1: number | null; d7: number | null; d30: number | null };
}

/** GET /admin/metrics/retention — survie par cohorte d'inscription. */
export function fetchRetention(
  weeks: number,
  signal?: AbortSignal,
): Promise<AdminRetention> {
  return adminFetch<AdminRetention>(`/admin/metrics/retention?weeks=${weeks}`, {
    signal,
  });
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

export interface MissingDobItem {
  id: string;
  userId: string;
  documentType: string;
  status: string;
  createdAt: string;
  viewUrl: string | null;
  user: IdentityUser;
}
export interface MissingDobResponse {
  items: MissingDobItem[];
  nextCursor: string | null;
}

/** Approved users missing a DOB — the proximity 18+ backfill queue. */
export function fetchMissingDob(signal?: AbortSignal): Promise<MissingDobResponse> {
  return adminFetch<MissingDobResponse>("/admin/identity/missing-dob", { signal });
}

/** Record a DOB on an already-approved user's document (backfill). */
export function setIdentityDob(userId: string, dateOfBirth: string): Promise<void> {
  return adminFetch<void>(`/admin/identity/${userId}/dob`, {
    method: "PATCH",
    body: { dateOfBirth },
  });
}

export function reviewIdentity(
  userId: string,
  decision: IdentityDecision,
  reason?: string,
  dateOfBirth?: string,
): Promise<void> {
  const body: {
    userId: string;
    decision: IdentityDecision;
    reason?: string;
    dateOfBirth?: string;
  } = {
    userId,
    decision,
  };
  if (decision === "rejected" && reason) body.reason = reason;
  // DOB is mandatory server-side to approve (18+ gate for proximity).
  if (decision === "approved" && dateOfBirth) body.dateOfBirth = dateOfBirth;
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
/**
 * 'subscribers' = public email list; 'app_users' = every registered account
 * (notif+push+email); 'segment' = registered accounts filtered by criteria;
 * 'custom' = only the hand-picked include list.
 */
export type CampaignAudience =
  | "subscribers"
  | "app_users"
  | "segment"
  | "custom";

/** Segment filters (registered accounts). All optional, AND-combined. */
export interface CampaignSegment {
  countryCode?: string;
  city?: string;
  verifiedOnly?: boolean;
  ambassadorOnly?: boolean;
  optInOnly?: boolean;
  activeSince?: string; // ISO datetime
}

/** An email attachment uploaded to our own bucket. */
export interface CampaignAttachment {
  url: string;
  filename: string;
  contentType: string;
}

export interface NewsletterCampaign {
  id: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  audience: CampaignAudience;
  critical: boolean;
  segment: CampaignSegment | null;
  includeEmails: string[];
  excludeEmails: string[];
  attachments: CampaignAttachment[] | null;
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
  audience: CampaignAudience;
  critical: boolean;
  segment?: CampaignSegment;
  includeEmails?: string[];
  excludeEmails?: string[];
  attachments?: CampaignAttachment[];
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
  /** When true, staff (admin/moderator) without TOTP enrolled cannot log in. */
  adminMfaRequired: boolean;
  /** Support override: when true, an admin sees everyone on the map + every profile. */
  adminFullVisibility: boolean;
  /** ISO time the override auto-expires (null when off). */
  adminFullVisibilityUntil: string | null;
  /** Community-wide override: when true, every member sees every profile (privacyLevel ignored). */
  globalFullVisibility: boolean;
  /** Règle diaspora — trois interrupteurs indépendants, actifs par défaut. */
  diasporaContactRestriction: boolean;
  diasporaContentSplit: boolean;
  diasporaUnknownCountryRestricted: boolean;
  /**
   * Plafond hebdomadaire des publications d'animation, tous comptes confondus.
   * Le quota par compte ne descend pas sous 1/semaine : c'est le seul réglage
   * qui passe sous ce plancher. 0 = plus aucune publication d'animation.
   */
  animationPostsPerWeekCap: number;
}

export interface AdminAccessLogRow {
  id: string;
  adminId: string;
  action: "map_full_visibility" | "profile_view_override" | string;
  targetId: string | null;
  createdAt: string;
}

/** GET /admin/audit/full-visibility — recent accesses made under the support override. */
export function fetchFullVisibilityLog(
  limit = 50,
  signal?: AbortSignal,
): Promise<AdminAccessLogRow[]> {
  return adminFetch<AdminAccessLogRow[]>(`/admin/audit/full-visibility?limit=${limit}`, { signal });
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
    adminMfaRequired: boolean;
    adminFullVisibility: boolean;
    globalFullVisibility: boolean;
    diasporaContactRestriction: boolean;
    diasporaContentSplit: boolean;
    diasporaUnknownCountryRestricted: boolean;
    animationPostsPerWeekCap: number;
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
 * GET /admin/referrals?cursor=&limit=&q=
 * Paginated list of recent members with their parrain chain. `q` (>= 2 chars)
 * filters rows whose sponsor OR invitee email matches (server-side only — the
 * email itself is never returned by this view).
 */
export function listReferrals(
  cursor?: string,
  limit?: number,
  signal?: AbortSignal,
  q?: string,
): Promise<ReferralListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  if (q) params.set("q", q);
  const qs = params.toString();
  return adminFetch<ReferralListResponse>(
    `/admin/referrals${qs ? `?${qs}` : ""}`,
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Ambassador badge management (admin-only)
// ---------------------------------------------------------------------------

export interface AdminUserSummary {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  identityStatus: IdentityDistStatus;
  isAmbassador: boolean;
  /** Date de nomination du badge. `null` pour les badges posés avant son suivi. */
  ambassadorSince: string | null;
  createdAt: string;
}

/** GET /admin/users/search?q= — search members by name/email for badge management. */
export function searchAdminUsers(
  q: string,
  limit?: number,
  signal?: AbortSignal,
): Promise<{ items: AdminUserSummary[] }> {
  const params = new URLSearchParams({ q });
  if (limit !== undefined) params.set("limit", String(limit));
  return adminFetch<{ items: AdminUserSummary[] }>(
    `/admin/users/search?${params.toString()}`,
    { signal },
  );
}

/** PATCH /admin/users/:id/ambassador — grants or revokes the ambassador badge. */
export function setAmbassador(
  userId: string,
  value: boolean,
): Promise<{ id: string; isAmbassador: boolean }> {
  return adminFetch<{ id: string; isAmbassador: boolean }>(
    `/admin/users/${userId}/ambassador`,
    { method: "PATCH", body: { value } },
  );
}

// ---------------------------------------------------------------------------
// User management (list / block / edit / delete)
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  role: UserRole;
  status: UserStatus;
  statusReason: string | null;
  statusExpiresAt: string | null;
  emailVerified: boolean;
  identityStatus: IdentityDistStatus;
  isAmbassador: boolean;
  /** Date de nomination du badge. `null` pour les badges posés avant son suivi. */
  ambassadorSince: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserList {
  items: AdminUser[];
  nextCursor: string | null;
}

/** Advanced filters for GET /admin/users (all optional). */
export interface AdminUserFilters {
  q?: string;
  status?: UserStatus;
  role?: UserRole;
  emailVerified?: boolean;
  countryCode?: string;
  identityStatus?: IdentityDistStatus;
  ambassador?: boolean;
  /** ISO date/datetime — members created at/after this instant. */
  createdAfter?: string;
  cursor?: string;
  limit?: number;
}

/** GET /admin/users — paginated list with name/email search + advanced filters. */
export function listAdminUsers(
  params: AdminUserFilters = {},
  signal?: AbortSignal,
): Promise<AdminUserList> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.status) qs.set("status", params.status);
  if (params.role) qs.set("role", params.role);
  if (params.emailVerified !== undefined) qs.set("emailVerified", String(params.emailVerified));
  if (params.countryCode) qs.set("countryCode", params.countryCode);
  if (params.identityStatus) qs.set("identityStatus", params.identityStatus);
  if (params.ambassador !== undefined) qs.set("ambassador", String(params.ambassador));
  if (params.createdAfter) qs.set("createdAfter", params.createdAfter);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const s = qs.toString();
  return adminFetch<AdminUserList>(`/admin/users${s ? `?${s}` : ""}`, { signal });
}

/**
 * PATCH /admin/users/:id/status — sanction (active|suspended|banned) with an
 * optional motive + expiry. `reason` is required server-side for suspend/ban;
 * `expiresAt` (ISO) sets a temporary suspension that auto-lifts.
 */
export function setUserStatus(
  userId: string,
  status: UserStatus,
  opts?: { reason?: string; expiresAt?: string },
): Promise<{
  id: string;
  status: UserStatus;
  statusReason: string | null;
  statusExpiresAt: string | null;
}> {
  const body: { status: UserStatus; reason?: string; expiresAt?: string } = { status };
  if (opts?.reason) body.reason = opts.reason;
  if (opts?.expiresAt) body.expiresAt = opts.expiresAt;
  return adminFetch(`/admin/users/${userId}/status`, { method: "PATCH", body });
}

/** PATCH /admin/users/:id — edit profile fields and/or role (admin-only). */
export function updateAdminUser(
  userId: string,
  patch: Partial<{
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    city: string | null;
    countryCode: string | null;
    bio: string | null;
    role: UserRole;
  }>,
): Promise<AdminUser> {
  return adminFetch<AdminUser>(`/admin/users/${userId}`, { method: "PATCH", body: patch });
}

/** DELETE /admin/users/:id — permanently delete a user (admin-only). */
export function deleteAdminUser(userId: string): Promise<void> {
  return adminFetch<void>(`/admin/users/${userId}`, { method: "DELETE" });
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

// ── Newsletter rich/targeting ──────────────────────────────────────────────
// Rich content (image upload) + recipient targeting for the campaign composer.
// Kept in a trailing block to minimise merge collisions with the sections above.

export interface NewsletterUploadResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  contentType: string;
  sseRequired: boolean;
  expiresIn: number;
}

/**
 * POST /admin/newsletter/upload — presign an image PUT under `newsletter/…`.
 * Returns the CDN URL to embed in the body / attach. Images only, admin-only.
 */
export function presignNewsletterUpload(
  contentType: string,
  filename?: string,
): Promise<NewsletterUploadResult> {
  return adminFetch<NewsletterUploadResult>("/admin/newsletter/upload", {
    method: "POST",
    body: filename ? { contentType, filename } : { contentType },
  });
}

/**
 * Upload a File: presign, PUT the bytes to MinIO/CDN, return the public URL.
 * Echoes the SSE header only when the presign asks for it (parity with S3Service).
 */
export async function uploadNewsletterImage(file: File): Promise<string> {
  const presigned = await presignNewsletterUpload(file.type, file.name);
  const headers: Record<string, string> = { "Content-Type": file.type };
  if (presigned.sseRequired) {
    headers["x-amz-server-side-encryption"] = "AES256";
  }
  const put = await fetch(presigned.uploadUrl, {
    method: "PUT",
    headers,
    body: file,
  });
  if (!put.ok) {
    throw new AdminApiError(put.status, "Échec de l'envoi du fichier.");
  }
  return presigned.publicUrl;
}

/**
 * POST /admin/newsletter/recipients/preview — estimate the recipient count for
 * an unsaved targeting draft (audience + segment + include/exclude lists).
 */
export function previewNewsletterRecipients(input: {
  audience: CampaignAudience;
  critical?: boolean;
  segment?: CampaignSegment;
  includeEmails?: string[];
  excludeEmails?: string[];
  signal?: AbortSignal;
}): Promise<{ totalRecipients: number }> {
  const { signal, ...body } = input;
  return adminFetch<{ totalRecipients: number }>(
    "/admin/newsletter/recipients/preview",
    { method: "POST", body, signal },
  );
}

// ── Manual identity verification ──
// Admin-only: verify (or revoke) a member's identity WITHOUT an uploaded piece.
// Distinct from reviewIdentity (which acts on a pending upload). Both PATCH /auth.

/**
 * PATCH /auth/identity/manual-approve — mark a member verified without a document.
 * DOB is mandatory (18+ proximity gate) and reason is recorded for audit.
 */
export function manualApproveIdentity(
  userId: string,
  dateOfBirth: string,
  reason: string,
): Promise<{ status: "approved" }> {
  return adminFetch<{ status: "approved" }>("/auth/identity/manual-approve", {
    method: "PATCH",
    body: { userId, dateOfBirth, reason },
  });
}

/** PATCH /auth/identity/revoke — revoke a member's identity verification. */
export function revokeIdentityVerification(
  userId: string,
  reason: string,
): Promise<{ status: "revoked" }> {
  return adminFetch<{ status: "revoked" }>("/auth/identity/revoke", {
    method: "PATCH",
    body: { userId, reason },
  });
}

// ── User mgmt: sanctions + detail ──────────────────────────────────────────────

/** One live session/device (non-revoked, non-expired refresh token). */
export interface AdminUserSession {
  id: string;
  deviceName: string | null;
  createdAt: string;
  usedAt: string | null;
  expiresAt: string;
}

/** GET /admin/users/:id/detail — full account view for the admin drawer. */
export interface AdminUserDetail {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  city: string | null;
  countryCode: string | null;
  role: UserRole;
  status: UserStatus;
  statusReason: string | null;
  statusExpiresAt: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  identityStatus: IdentityDistStatus;
  isAmbassador: boolean;
  mfaEnabled: boolean;
  canBulkInvite: boolean;
  privacyLevel: string;
  showOnMap: boolean;
  proximityAlerts: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  updatedAt: string;
  invitedBy: { id: string; displayName: string | null } | null;
  counts: {
    posts: number;
    comments: number;
    reportsReceived: number;
    reportsMade: number;
  };
  invitations: { sent: number; accepted: number };
  sessions: AdminUserSession[];
}

/** One row of the sensitive-action audit trail for a user. */
export interface AdminUserAuditRow {
  id: string;
  actorId: string;
  action: string;
  targetUserId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** GET /admin/users/:id/detail — profile + counters + sessions. Admin + moderator. */
export function fetchUserDetail(
  userId: string,
  signal?: AbortSignal,
): Promise<AdminUserDetail> {
  return adminFetch<AdminUserDetail>(`/admin/users/${userId}/detail`, { signal });
}

/** GET /admin/users/:id/audit — sensitive-action trail (newest first). Admin-only. */
export function fetchUserAudit(
  userId: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<AdminUserAuditRow[]> {
  return adminFetch<AdminUserAuditRow[]>(
    `/admin/users/${userId}/audit?limit=${limit}`,
    { signal },
  );
}

/** POST /admin/users/:id/force-logout — revoke every live session. Admin-only. */
export function forceLogoutUser(userId: string): Promise<{ revoked: number }> {
  return adminFetch<{ revoked: number }>(`/admin/users/${userId}/force-logout`, {
    method: "POST",
  });
}

/** POST /admin/users/:id/reset-mfa — clear the user's TOTP enrollment. Admin-only. */
export function resetUserMfa(userId: string): Promise<{ id: string; mfaEnabled: false }> {
  return adminFetch<{ id: string; mfaEnabled: false }>(`/admin/users/${userId}/reset-mfa`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Observability — infra + site metrics and centralised logs (admin-only).
//
// The browser never talks to Prometheus/Loki: both run on a private Docker
// network and the API proxies them. Filters are sent as plain query params and
// the LogQL/PromQL is built server-side — see apps/api/src/observability/.
// ---------------------------------------------------------------------------

export interface ObservabilityStatus {
  prometheus: { configured: boolean; reachable: boolean };
  loki: { configured: boolean; reachable: boolean };
}

export interface ContainerUsage {
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
}

export interface ObservabilityOverview {
  available: boolean;
  /** Why the stack is unavailable — shown verbatim in the banner. */
  reason?: string;
  host: {
    cpuPercent: number | null;
    memoryPercent: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    diskPercent: number | null;
    /** All containers on the shared VPS, not just ours. */
    containersTotal: number | null;
  };
  app: {
    containers: number | null;
    requestsPerSecond: number | null;
    latencyP95Seconds: number | null;
    errorRatePercent: number | null;
    errorRate4xxPercent: number | null;
  };
  containers: ContainerUsage[];
}

export interface ErrorRatePoint {
  /** Milliseconds since epoch. */
  t: number;
  errorRate: number;
  requestsPerSecond: number;
}

export interface ErrorRateSeries {
  available: boolean;
  reason?: string;
  series: ErrorRatePoint[];
}

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogStatusClass = "2xx" | "3xx" | "4xx" | "5xx";

export interface LogEntry {
  ts: number;
  container: string;
  stream: string;
  level: string | null;
  status: number | null;
  userId: string | null;
  /** Résolu par l'API à l'affichage — jamais stocké dans Loki. */
  userEmail: string | null;
  requestId: string | null;
  message: string;
  raw: string;
}

export interface LogSearchResult {
  available: boolean;
  reason?: string;
  /** The LogQL the server built — surfaced so a filter can be debugged. */
  query: string;
  entries: LogEntry[];
}

export interface LogFilters {
  minutes?: number;
  container?: string;
  level?: LogLevel;
  statusClass?: LogStatusClass;
  status?: number;
  userId?: string;
  /** Alternative à `userId` : l'API résout l'email en UUID avant d'interroger Loki. */
  userEmail?: string;
  search?: string;
  limit?: number;
}

/** GET /admin/observability/status — are Prometheus/Loki configured + reachable. */
export function fetchObservabilityStatus(
  signal?: AbortSignal,
): Promise<ObservabilityStatus> {
  return adminFetch<ObservabilityStatus>("/admin/observability/status", { signal });
}

/** GET /admin/observability/overview — host + app KPIs and per-container usage. */
export function fetchObservabilityOverview(
  signal?: AbortSignal,
): Promise<ObservabilityOverview> {
  return adminFetch<ObservabilityOverview>("/admin/observability/overview", { signal });
}

/** GET /admin/observability/error-rate — 5xx share + throughput over time. */
export function fetchErrorRateSeries(
  minutes: number,
  signal?: AbortSignal,
): Promise<ErrorRateSeries> {
  return adminFetch<ErrorRateSeries>(
    `/admin/observability/error-rate?minutes=${minutes}`,
    { signal },
  );
}

/** GET /admin/observability/containers — container names Loki has logs for. */
export function fetchLogContainers(signal?: AbortSignal): Promise<string[]> {
  return adminFetch<string[]>("/admin/observability/containers", { signal });
}

/** GET /admin/observability/logs — filtered log search. */
export function fetchLogs(
  filters: LogFilters = {},
  signal?: AbortSignal,
): Promise<LogSearchResult> {
  const qs = new URLSearchParams();
  if (filters.minutes !== undefined) qs.set("minutes", String(filters.minutes));
  if (filters.container) qs.set("container", filters.container);
  if (filters.level) qs.set("level", filters.level);
  if (filters.statusClass) qs.set("statusClass", filters.statusClass);
  if (filters.status !== undefined) qs.set("status", String(filters.status));
  if (filters.userId) qs.set("userId", filters.userId);
  if (filters.search) qs.set("search", filters.search);
  if (filters.limit !== undefined) qs.set("limit", String(filters.limit));
  const s = qs.toString();
  return adminFetch<LogSearchResult>(
    `/admin/observability/logs${s ? `?${s}` : ""}`,
    { signal },
  );
}

// ---------------------------------------------------------------------------
// Carte des membres (admin) — /admin/map/*
//
// Les coordonnées renvoyées par défaut sont APPROXIMATIVES : centroïde de la
// ville déclarée + décalage aléatoire (precision 'city'). La position GPS réelle
// n'est exposée que pendant une fenêtre de « bris de glace » ouverte à la main
// (code TOTP + motif, 30 minutes, tracée) — les points passent alors en
// precision 'gps'. Un membre sans coordonnées connues sort de la carte : c'est
// `withoutPosition` qui le compte, il ne doit jamais disparaître en silence.
// ---------------------------------------------------------------------------

/** De quel côté de la diaspora vit le membre (déduit de son pays). */
export type MapSide = "diaspora" | "niger";

/** D'où vient la position affichée. `null` = aucune position connue. */
export type MapPrecision = "city" | "gps";

/**
 * Combien vaut le point, indépendamment de `precision` :
 *   'stored'  — coordonnée portée par le compte (pin de ville à l'inscription,
 *               ou ping GPS pendant le bris de glace) ;
 *   'city'    — centroïde de la ville déclarée ;
 *   'country' — centroïde du PAYS : large comme une nation, à ne jamais lire
 *               comme « ce membre est à Niamey ».
 * Axe DISTINCT de `precision` : `precision` dit à quel point le point est
 * précis (ville vs GPS du bris de glace), `positionSource` dit d'où il sort.
 */
export type MapPositionSource = "stored" | "city" | "country";

export interface MapUser {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  precision: MapPrecision | null;
  positionSource: MapPositionSource | null;
  positionUpdatedAt: string | null;
  status: string;
  identityStatus: string;
  isAmbassador: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  privacyLevel: string;
  side: MapSide;
  lastSeenAt: string | null;
  createdAt: string;
  counts: { posts: number; friends: number };
}

/** GET /admin/map/users/:id — la fiche marqueur, enrichie des champs sensibles. */
export interface MapUserDetail extends MapUser {
  email: string | null;
  phone: string | null;
  bio: string | null;
  languages: string[] | null;
  invitedBy: { id: string; displayName: string | null } | null;
  inviteesCount: number;
  lastLoginAt: string | null;
}

export interface MapUserList {
  items: MapUser[];
  nextCursor: string | null;
  /** Nombre total de membres correspondant aux filtres, page comprise. */
  total: number;
  /** Parmi ce total, ceux sans coordonnées — absents de la carte. */
  withoutPosition: number;
}

/** Filtres de GET /admin/map/users. Tous optionnels, combinés en ET. */
export interface MapUserFilters {
  q?: string;
  countryCode?: string;
  city?: string;
  status?: UserStatus;
  identityStatus?: IdentityDistStatus;
  ambassador?: boolean;
  privacyLevel?: string;
  side?: MapSide;
  /** Vus au moins une fois dans les N derniers jours (1 à 365). */
  activeWithinDays?: number;
  hasPosition?: boolean;
  /** 1 à 500, 200 par défaut côté API. */
  limit?: number;
  cursor?: string;
}

/** GET /admin/map/users — membres géolocalisables, paginés par curseur. */
export function fetchMapUsers(
  filters: MapUserFilters = {},
  signal?: AbortSignal,
): Promise<MapUserList> {
  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.countryCode) qs.set("countryCode", filters.countryCode);
  if (filters.city) qs.set("city", filters.city);
  if (filters.status) qs.set("status", filters.status);
  if (filters.identityStatus) qs.set("identityStatus", filters.identityStatus);
  if (filters.ambassador !== undefined)
    qs.set("ambassador", String(filters.ambassador));
  if (filters.privacyLevel) qs.set("privacyLevel", filters.privacyLevel);
  if (filters.side) qs.set("side", filters.side);
  if (filters.activeWithinDays !== undefined)
    qs.set("activeWithinDays", String(filters.activeWithinDays));
  if (filters.hasPosition !== undefined)
    qs.set("hasPosition", String(filters.hasPosition));
  if (filters.limit !== undefined) qs.set("limit", String(filters.limit));
  if (filters.cursor) qs.set("cursor", filters.cursor);
  const s = qs.toString();
  return adminFetch<MapUserList>(`/admin/map/users${s ? `?${s}` : ""}`, {
    signal,
  });
}

/** GET /admin/map/users/:id — fiche détaillée du marqueur sélectionné. */
export function fetchMapUser(
  userId: string,
  signal?: AbortSignal,
): Promise<MapUserDetail> {
  return adminFetch<MapUserDetail>(`/admin/map/users/${userId}`, { signal });
}

/**
 * GET /admin/map/facets — ce que les listes déroulantes doivent réellement
 * proposer, compté en base plutôt que figé dans le code.
 *
 * Chaque facette est calculée avec tous les filtres actifs SAUF celui qu'elle
 * pilote : choisir « France » ne réduit donc pas la liste des pays à la France.
 * Les noms de pays sont volontairement absents — le code ISO suffit, le
 * navigateur le traduit avec Intl.DisplayNames (voir map/countryNames.ts).
 */
export interface MapFacets {
  countries: Array<{ code: string; count: number }>;
  cities: Array<{ city: string; countryCode: string | null; count: number }>;
  statuses: Array<{ value: UserStatus; count: number }>;
}

/** GET /admin/map/facets — mêmes filtres que la liste, sans la pagination. */
export function fetchMapFacets(
  filters: MapUserFilters = {},
  signal?: AbortSignal,
): Promise<MapFacets> {
  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.countryCode) qs.set("countryCode", filters.countryCode);
  if (filters.city) qs.set("city", filters.city);
  if (filters.status) qs.set("status", filters.status);
  if (filters.identityStatus) qs.set("identityStatus", filters.identityStatus);
  if (filters.ambassador !== undefined)
    qs.set("ambassador", String(filters.ambassador));
  if (filters.privacyLevel) qs.set("privacyLevel", filters.privacyLevel);
  if (filters.side) qs.set("side", filters.side);
  if (filters.activeWithinDays !== undefined)
    qs.set("activeWithinDays", String(filters.activeWithinDays));
  if (filters.hasPosition !== undefined)
    qs.set("hasPosition", String(filters.hasPosition));
  const s = qs.toString();
  return adminFetch<MapFacets>(`/admin/map/facets${s ? `?${s}` : ""}`, {
    signal,
  });
}

/** État de la fenêtre de bris de glace « position précise » de l'admin courant. */
export interface PreciseLocationWindow {
  active: boolean;
  /** ISO d'expiration — null quand la fenêtre est fermée. */
  until: string | null;
}

/** GET /admin/map/precise-location — la fenêtre est-elle ouverte, et jusqu'à quand. */
export function fetchPreciseLocationWindow(
  signal?: AbortSignal,
): Promise<PreciseLocationWindow> {
  return adminFetch<PreciseLocationWindow>("/admin/map/precise-location", {
    signal,
  });
}

/**
 * POST /admin/map/precise-location — ouvre la fenêtre GPS (30 min, tracée).
 *
 * N'utilise PAS `adminFetch` volontairement : ici un 401 signifie « code
 * authenticator faux », pas « session expirée ». Passer par le helper commun
 * déconnecterait l'admin à la première faute de frappe. Même origine, même
 * en-tête Bearer, seul le traitement du 401 change.
 */
export async function openPreciseLocationWindow(
  code: string,
  reason: string,
): Promise<{ active: true; until: string }> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/map/precise-location`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code, reason }),
      cache: "no-store",
    });
  } catch {
    throw new AdminApiError(0, "Impossible de joindre le serveur. Réessaie.");
  }
  if (!res.ok) {
    throw new AdminApiError(res.status, await extractError(res));
  }
  return (await res.json()) as { active: true; until: string };
}

/** DELETE /admin/map/precise-location — referme la fenêtre immédiatement. */
export function closePreciseLocationWindow(): Promise<void> {
  return adminFetch<void>("/admin/map/precise-location", { method: "DELETE" });
}

// ── Contact / partenariat ────────────────────────────────────────────────────
// Messages envoyés depuis l'app (« Nous contacter »). La boîte de réception vit
// dans la console ; un mail de notification part en parallèle vers contact@.

export type ContactTopic = "partnership" | "info" | "problem" | "other";
export type ContactStatus = "new" | "read" | "handled";

export interface ContactMessage {
  id: string;
  topic: ContactTopic;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  status: ContactStatus;
  createdAt: string;
  handledAt: string | null;
  user: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    avatarUrl: string | null;
  } | null;
}

export interface ContactListResponse {
  items: ContactMessage[];
  nextCursor: string | null;
  /** Messages jamais ouverts — alimente la pastille de la sidebar. */
  newCount: number;
}

export function fetchContactMessages(
  status: ContactStatus | "all",
  signal?: AbortSignal,
): Promise<ContactListResponse> {
  return adminFetch<ContactListResponse>(`/admin/contact?status=${status}`, { signal });
}

export function setContactStatus(
  id: string,
  status: ContactStatus,
): Promise<ContactMessage> {
  return adminFetch<ContactMessage>(`/admin/contact/${id}`, {
    method: "PATCH",
    body: { status },
  });
}

// ── Compte officiel NigerConnect ──
// La voix de la plateforme : un compte qui n'est pas un membre (absent de la
// recherche, des suggestions, de la carte) mais qui parle à tout le monde.
// Toutes les routes sont admin-only côté API.

export interface OfficialAccount {
  id: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  isOfficial: boolean;
  officialSince: string | null;
  createdAt: string;
}

export interface OfficialOverview {
  account: OfficialAccount;
  stats: {
    postsCount: number;
    storiesCount: number;
    threads: number;
    unreadThreads: number;
  };
  lastBroadcast: {
    id: string;
    kind: OfficialBroadcastKind;
    title: string;
    createdAt: string;
    status: OfficialBroadcastStatus;
  } | null;
  /** Membres joignables aujourd'hui (opt-out « annonces » respecté). */
  reach: number;
  /** Membres actifs, opt-out ignoré — ce que vaudrait une diffusion critique. */
  reachCritical: number;
}

export type OfficialBroadcastKind = "notification" | "message";
export type OfficialBroadcastStatus = "sending" | "sent" | "failed";

export interface OfficialBroadcast {
  id: string;
  kind: OfficialBroadcastKind;
  status: OfficialBroadcastStatus;
  title: string;
  body: string;
  audience: string;
  targetId: string | null;
  linkPath: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  finishedAt: string | null;
  createdBy: { id: string; displayName: string | null; firstName: string | null } | null;
}

export interface OfficialMediaRef {
  mediaUrl: string;
  mediaType: "image" | "video";
}

export interface OfficialPost {
  id: string;
  content: string | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  media: OfficialMediaRef[];
}

export interface OfficialStory {
  id: string;
  content: string | null;
  createdAt: string;
  storyExpiresAt: string | null;
  media: OfficialMediaRef[];
}

export interface OfficialThread {
  conversationId: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  peer: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    city: string | null;
    countryCode: string | null;
  } | null;
}

export interface OfficialThreadMessage {
  id: string;
  content: string | null;
  mediaUrl: string | null;
  messageType: string;
  createdAt: string;
  deletedAt: string | null;
  sender: { id: string; displayName: string | null; firstName: string | null } | null;
}

export function fetchOfficialAccount(signal?: AbortSignal): Promise<OfficialOverview> {
  return adminFetch<OfficialOverview>("/admin/official", { signal });
}

export function updateOfficialAccount(body: {
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
}): Promise<OfficialAccount> {
  return adminFetch<OfficialAccount>("/admin/official", { method: "PATCH", body });
}

/** Presign + PUT d'une image du compte officiel. Renvoie l'URL CDN à persister. */
export async function uploadOfficialImage(file: File): Promise<string> {
  const presigned = await adminFetch<NewsletterUploadResult>("/admin/official/upload", {
    method: "POST",
    body: { contentType: file.type },
  });
  const headers: Record<string, string> = { "Content-Type": file.type };
  if (presigned.sseRequired) headers["x-amz-server-side-encryption"] = "AES256";
  const put = await fetch(presigned.uploadUrl, { method: "PUT", headers, body: file });
  if (!put.ok) throw new AdminApiError(put.status, "Échec de l'envoi du fichier.");
  return presigned.publicUrl;
}

export function publishOfficialPost(body: {
  content: string;
  media?: { mediaUrl: string; mediaType: "image"; width?: number; height?: number }[];
  announce?: boolean;
  announceTitle?: string;
}): Promise<{ id: string }> {
  return adminFetch<{ id: string }>("/admin/official/posts", { method: "POST", body });
}

export function publishOfficialStory(body: {
  content?: string;
  media: { mediaUrl: string; mediaType: "image"; width?: number; height?: number };
  announce?: boolean;
}): Promise<{ id: string }> {
  return adminFetch<{ id: string }>("/admin/official/stories", { method: "POST", body });
}

export function fetchOfficialContent(
  signal?: AbortSignal,
): Promise<{ posts: OfficialPost[]; stories: OfficialStory[] }> {
  return adminFetch("/admin/official/content", { signal });
}

export function deleteOfficialContent(id: string): Promise<void> {
  return adminFetch<void>(`/admin/official/content/${id}`, { method: "DELETE" });
}

/** Notification à toute la communauté. 202 : l'envoi continue en tâche de fond. */
export function broadcastOfficialNotification(body: {
  title: string;
  body: string;
  linkPath?: string;
}): Promise<OfficialBroadcast> {
  return adminFetch<OfficialBroadcast>("/admin/official/broadcasts/notification", {
    method: "POST",
    body,
  });
}

/** Message direct à toute la communauté (reçu comme un message, pas une annonce). */
export function broadcastOfficialMessage(body: {
  content: string;
  imageUrl?: string;
}): Promise<OfficialBroadcast> {
  return adminFetch<OfficialBroadcast>("/admin/official/broadcasts/message", {
    method: "POST",
    body,
  });
}

export function fetchOfficialBroadcasts(signal?: AbortSignal): Promise<OfficialBroadcast[]> {
  return adminFetch<OfficialBroadcast[]>("/admin/official/broadcasts", { signal });
}

export function sendOfficialDirectMessage(body: {
  userId: string;
  content: string;
  imageUrl?: string;
}): Promise<{ conversationId: string }> {
  return adminFetch<{ conversationId: string }>("/admin/official/messages", {
    method: "POST",
    body,
  });
}

export function fetchOfficialThreads(
  signal?: AbortSignal,
): Promise<{ items: OfficialThread[]; nextCursor: string | null }> {
  return adminFetch("/admin/official/threads", { signal });
}

export function fetchOfficialThread(
  conversationId: string,
  signal?: AbortSignal,
): Promise<{ items: OfficialThreadMessage[]; nextCursor: string | null }> {
  return adminFetch(`/admin/official/threads/${conversationId}`, { signal });
}

export function replyOfficialThread(
  conversationId: string,
  content: string,
): Promise<OfficialThreadMessage> {
  return adminFetch<OfficialThreadMessage>(
    `/admin/official/threads/${conversationId}/reply`,
    { method: "POST", body: { content } },
  );
}

// ── Associations — certification (A5, admin-only) ──────────────────────────
// GET /associations is the same public/authenticated endpoint the mobile app
// and the admin console both hit — it is intentionally NOT admin-scoped and
// has no dedicated admin listing, so this reuses it. Its projection
// (ASSOCIATION_PUBLIC_SELECT in association.service.ts) never includes
// `verificationNote`/`verifiedById`/`pendingOwnerId`/`deletedAt`/
// `normalizedName` — those stay internal even from this console. `verifiedAt`
// alone is public ("Vérifiée le …").
//
// There is no free-text search param on this endpoint (only `category`/
// `country`), so AssociationsSection paginates it into a local pool and
// filters client-side — see the component for that logic.

export type AssociationCategory =
  | "generaliste"
  | "etudiants"
  | "femmes"
  | "jeunesse"
  | "culture"
  | "business"
  | "sport"
  | "religieux";

export interface AdminAssociation {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  category: AssociationCategory;
  countryCode: string | null;
  city: string | null;
  website: string | null;
  contactEmail: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  requiresApproval: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAssociationList {
  items: AdminAssociation[];
  nextCursor: string | null;
}

export interface AdminAssociationFilters {
  category?: AssociationCategory;
  country?: string;
  cursor?: string;
  limit?: number;
}

/** GET /associations — paginated, public projection (see note above). */
export function listAssociations(
  params: AdminAssociationFilters = {},
  signal?: AbortSignal,
): Promise<AdminAssociationList> {
  const qs = new URLSearchParams();
  if (params.category) qs.set("category", params.category);
  if (params.country) qs.set("country", params.country);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const s = qs.toString();
  return adminFetch<AdminAssociationList>(`/associations${s ? `?${s}` : ""}`, { signal });
}

/**
 * The raw row `admin.service.ts#verifyAssociation/unverifyAssociation`
 * returns — unlike `listAssociations`, it is NOT run through
 * ASSOCIATION_PUBLIC_SELECT, so `verifiedById`/`verificationNote` come back
 * here. Kept as its own type (not `AdminAssociation`) so nobody accidentally
 * expects those two fields out of the list endpoint above.
 */
export interface AdminAssociationVerification {
  id: string;
  isVerified: boolean;
  verifiedAt: string | null;
  verifiedById: string | null;
  verificationNote: string | null;
}

/**
 * POST /admin/associations/:id/verify — grant the "Association vérifiée"
 * badge. `note` is an internal moderation note (never shown to the
 * association or on any public page). Admin-only.
 */
export function verifyAssociation(
  id: string,
  note?: string,
): Promise<AdminAssociationVerification> {
  return adminFetch<AdminAssociationVerification>(`/admin/associations/${id}/verify`, {
    method: "POST",
    body: note ? { note } : {},
  });
}

/** POST /admin/associations/:id/unverify — revoke it. Same shape, admin-only. */
export function unverifyAssociation(
  id: string,
  note?: string,
): Promise<AdminAssociationVerification> {
  return adminFetch<AdminAssociationVerification>(`/admin/associations/${id}/unverify`, {
    method: "POST",
    body: note ? { note } : {},
  });
}
