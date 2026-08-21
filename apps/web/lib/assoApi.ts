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
/** Who is logged in. Kept next to the token so the UI can tell "my post" from
 *  "someone else's" without decoding the JWT — the API stays the only judge of
 *  what that identity is allowed to do. */
export const USER_KEY = "nc_asso_user";

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

export function setSession(token: string, userId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, userId);
}

export function getUserId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(USER_KEY);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
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

// ---------------------------------------------------------------------------
// Membres, demandes d'adhésion, bureau exécutif (B4)
// ---------------------------------------------------------------------------

/** The public shape of a person, as every association surface returns it. */
export interface MemberUser {
  id: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  city?: string | null;
  countryCode?: string | null;
}

export interface AssociationMember {
  associationId: string;
  userId: string;
  role: AssociationRole | "moderator";
  status: "pending" | "approved" | "rejected";
  joinedAt: string;
  user: MemberUser;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type OfficerTitle =
  | "president"
  | "vice_president"
  | "secretary"
  | "treasurer"
  | "spokesperson"
  | "other";

export interface AssociationOfficer {
  id: string;
  associationId: string;
  userId: string;
  title: OfficerTitle;
  customTitle?: string | null;
  sortOrder: number;
  acceptedAt: string | null;
  createdAt: string;
  user: MemberUser;
}

/** Roles an officer may hand out. `owner` is absent on purpose: it only moves
 *  through the ownership transfer flow, never by editing a role (A3). */
export const ASSIGNABLE_ROLES = ["admin", "moderator", "member"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const OFFICER_TITLES: ReadonlyArray<{ value: OfficerTitle; label: string }> = [
  { value: "president", label: "Président·e" },
  { value: "vice_president", label: "Vice-président·e" },
  { value: "secretary", label: "Secrétaire" },
  { value: "treasurer", label: "Trésorier·ère" },
  { value: "spokesperson", label: "Porte-parole" },
  { value: "other", label: "Autre (à préciser)" },
];

export function officerTitleLabel(officer: AssociationOfficer): string {
  if (officer.title === "other") return officer.customTitle ?? "Autre";
  return OFFICER_TITLES.find((t) => t.value === officer.title)?.label ?? officer.title;
}

/** Best display name available, without ever rendering an empty line. */
export function personName(user: MemberUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return user.displayName?.trim() || full || "Membre";
}

export function roleLabelOf(role: AssociationMember["role"]): string {
  if (role === "moderator") return "Modérateur";
  return roleLabel(role as AssociationRole);
}

export function listMembers(
  associationId: string,
  params: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<AssociationMember>> {
  return assoFetch<Page<AssociationMember>>(
    `/associations/${associationId}/members${query(params)}`,
    { signal },
  );
}

export function listPendingRequests(
  associationId: string,
  params: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<AssociationMember>> {
  return assoFetch<Page<AssociationMember>>(
    `/associations/${associationId}/pending${query(params)}`,
    { signal },
  );
}

export function approveRequest(associationId: string, userId: string): Promise<unknown> {
  return assoFetch(`/associations/${associationId}/members/${userId}/approve`, { method: "POST" });
}

export function rejectRequest(
  associationId: string,
  userId: string,
  reason?: string,
): Promise<unknown> {
  return assoFetch(`/associations/${associationId}/members/${userId}/reject`, {
    method: "POST",
    body: reason ? { reason } : {},
  });
}

export function changeRole(
  associationId: string,
  userId: string,
  role: AssignableRole,
): Promise<unknown> {
  return assoFetch(`/associations/${associationId}/members/${userId}/role`, {
    method: "PATCH",
    body: { role },
  });
}

export function listOfficers(
  associationId: string,
  signal?: AbortSignal,
): Promise<AssociationOfficer[]> {
  return assoFetch<AssociationOfficer[]>(`/associations/${associationId}/officers`, { signal });
}

export function designateOfficer(
  associationId: string,
  body: { userId: string; title: OfficerTitle; customTitle?: string; sortOrder?: number },
): Promise<unknown> {
  return assoFetch(`/associations/${associationId}/officers`, { method: "POST", body });
}

export function removeOfficer(associationId: string, userId: string): Promise<void> {
  return assoFetch<void>(`/associations/${associationId}/officers/${userId}`, {
    method: "DELETE",
  });
}

function query(params: { cursor?: string | null; limit?: number }): string {
  const parts: string[] = [];
  if (params.cursor) parts.push(`cursor=${encodeURIComponent(params.cursor)}`);
  if (params.limit) parts.push(`limit=${params.limit}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------------------
// Publications de l'association (B3)
// ---------------------------------------------------------------------------

export interface PostMedia {
  id?: string;
  mediaUrl: string;
  thumbnailUrl?: string | null;
  mediaType: "image" | "video";
  width?: number | null;
  height?: number | null;
  sortOrder?: number;
}

export interface AssociationPost {
  id: string;
  content: string | null;
  visibility: string;
  associationId: string | null;
  createdAt: string;
  likeCount?: number;
  commentCount?: number;
  media?: PostMedia[];
  author?: MemberUser;
}

/** What the API hands back for a signed upload. */
export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  bucket: string;
  visibility: string;
  expiresIn: number;
  sseRequired: boolean;
}

export const UPLOADABLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;
export type UploadableImageType = (typeof UPLOADABLE_IMAGE_TYPES)[number];

/** 15 Mo — the cap the API enforces at attach time (S3Service). Checking it
 *  here too turns a rejected upload into an immediate, explicit message. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function listAssociationPosts(
  associationId: string,
  params: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<AssociationPost>> {
  return assoFetch<Page<AssociationPost>>(
    `/associations/${associationId}/posts${query(params)}`,
    { signal },
  );
}

/** ADR-002 — signs an upload into `associations/{id}/`, role checked server-side. */
export function presignAssociationMedia(
  associationId: string,
  contentType: UploadableImageType,
): Promise<PresignedUpload> {
  return assoFetch<PresignedUpload>(`/associations/${associationId}/media/presign`, {
    method: "POST",
    body: { contentType },
  });
}

/**
 * Upload the bytes straight to the bucket with the signed PUT. The API never
 * relays the file — it only signs, then verifies at attach time.
 */
export async function uploadToSignedUrl(
  presigned: PresignedUpload,
  file: File,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": file.type };
  if (presigned.sseRequired) headers["x-amz-server-side-encryption"] = "AES256";

  let res: Response;
  try {
    res = await fetch(presigned.uploadUrl, { method: "PUT", headers, body: file });
  } catch {
    throw new AssoApiError(0, "Envoi du fichier impossible. Réessaie.");
  }
  if (!res.ok) {
    throw new AssoApiError(res.status, "Le fichier a été refusé par le stockage.");
  }
  return presigned.publicUrl;
}

export function createAssociationPost(
  associationId: string,
  body: { content?: string; media?: PostMedia[] },
): Promise<AssociationPost> {
  return assoFetch<AssociationPost>("/posts", {
    method: "POST",
    body: {
      ...body,
      visibility: "association",
      associationId,
    },
  });
}

export function deletePost(postId: string): Promise<void> {
  return assoFetch<void>(`/posts/${postId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Occupation disque (B5)
// ---------------------------------------------------------------------------

export interface AssociationStorage {
  usedBytes: number;
  quotaBytes: number;
}

/** Réservé aux dirigeants côté serveur : le niveau de remplissage en dit long
 *  sur l'activité d'une association, et seuls ceux qui peuvent libérer de la
 *  place ont besoin de le voir. */
export function getStorage(
  associationId: string,
  signal?: AbortSignal,
): Promise<AssociationStorage> {
  return assoFetch<AssociationStorage>(`/associations/${associationId}/storage`, { signal });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " Ko";
  return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
}
