// Fetch helper + typed client for the ASSOCIATION back-office (/asso).
//
// Deliberately separate from `adminApi.ts` even though both talk to the same
// NestJS API with a Bearer JWT. The two consoles are two different populations:
// /admin is the platform team, /asso is the officers of an association. Sharing
// a token key would mean that logging into one silently authenticates the
// other — a privilege confusion we do not want, and a session an officer could
// not end without also ending the team's.
//
// Auth model (decision Q2, 2026-08-21): a personal NigerConnect account plus a
// role inside the association. There is NO shared "association account" — the
// A3 audit trail must always name a person, and a departing officer must be
// revocable on their own.
//
// The role checks below are for RENDERING ONLY. Every association mutation is
// authorized server-side by `assertRole` — the browser is never believed.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export const TOKEN_KEY = "nc_asso_token";

export type AssociationRole = "member" | "admin" | "owner";

/** The two roles that may administer an association (mirrors the API). */
export const OFFICER_ROLES: readonly AssociationRole[] = ["admin", "owner"];

export function isOfficer(role: AssociationRole): boolean {
  return OFFICER_ROLES.includes(role);
}

/** Human label for a role. `owner` is deliberately not called "propriétaire":
 *  an association belongs to its members, not to the person who holds the
 *  non-demotable seat (A3). */
export function roleLabel(role: AssociationRole): string {
  if (role === "owner") return "Responsable principal";
  if (role === "admin") return "Administrateur";
  return "Membre";
}

// ---------------------------------------------------------------------------
// Session (localStorage). Guarded for SSR safety.
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  window.location.href = "/asso/login";
}

// ---------------------------------------------------------------------------
// Core fetch.
// ---------------------------------------------------------------------------

export class AssoApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AssoApiError";
    this.status = status;
  }
}

interface AssoFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Fetch against the API with the officer's Bearer token attached.
 *
 * Unlike `adminFetch`, a 403 does NOT bounce to the login page. Here a 403 is
 * an ordinary, meaningful answer — "you are not an officer of THIS
 * association" — and ending the session over it would log out an officer who
 * simply opened the wrong association. Only a 401 (no/expired token) ends the
 * session.
 */
export async function assoFetch<T>(path: string, options: AssoFetchOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      cache: "no-store",
    });
  } catch {
    throw new AssoApiError(0, "Impossible de joindre le serveur. Réessaie.");
  }

  if (res.status === 401) {
    clearSession();
    redirectToLogin();
    throw new AssoApiError(401, "Session expirée. Reconnecte-toi.");
  }

  if (!res.ok) {
    throw new AssoApiError(res.status, await extractError(res));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function extractError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (typeof body.message === "string") return body.message;
  } catch {
    // fall through
  }
  return `Erreur serveur (${res.status}).`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MyAssociation {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  category: string;
  city?: string | null;
  countryCode?: string | null;
  memberCount: number;
  isVerified: boolean;
  verifiedAt?: string | null;
  createdAt: string;
  role: AssociationRole;
  joinedAt: string;
}

export interface LoginResponse {
  user: { id: string; email: string; displayName?: string };
  tokens: { accessToken: string; refreshToken: string };
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaToken: string;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** Every association I belong to, with MY role in it. Filtering to the ones I
 *  may administer is a rendering concern — the server still gates each action. */
export function listMyAssociations(signal?: AbortSignal): Promise<MyAssociation[]> {
  return assoFetch<MyAssociation[]>("/associations/mine", { signal });
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse | MfaChallengeResponse> {
  return publicPost<LoginResponse | MfaChallengeResponse>("/auth/login", { email, password });
}

/** Second login step for an account with TOTP enabled. */
export async function verifyMfa(mfaToken: string, code: string): Promise<LoginResponse> {
  return publicPost<LoginResponse>("/auth/mfa/verify", { mfaToken, code });
}

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new AssoApiError(0, "Impossible de joindre le serveur. Réessaie.");
  }
  if (!res.ok) throw new AssoApiError(res.status, await extractError(res));
  return (await res.json()) as T;
}
