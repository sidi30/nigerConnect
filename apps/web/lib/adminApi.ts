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
  };
  identity: {
    pending: number;
    approved: number;
    rejected: number;
  };
  content: {
    posts: number;
    messages24h: number;
    comments: number;
  };
  moderation: {
    reportsPending: number;
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
