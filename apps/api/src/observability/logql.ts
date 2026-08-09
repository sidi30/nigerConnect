/**
 * LogQL builder for the admin log explorer.
 *
 * The browser NEVER sends a query: it sends validated filters and this module
 * assembles the expression. Accepting a raw LogQL string would hand any admin
 * (or anyone who steals an admin session) arbitrary read access to every log
 * stream on the host, including the neighbouring projects' containers.
 *
 * Every value interpolated here is either whitelisted upstream by the Zod
 * schema (level, status, uuid, container name) or escaped by `escapeLogQL`.
 */

export type LogLevelFilter = 'error' | 'warn' | 'info' | 'debug';
export type StatusClassFilter = '2xx' | '3xx' | '4xx' | '5xx';

export interface LogFilters {
  container?: string;
  level?: LogLevelFilter;
  statusClass?: StatusClassFilter;
  status?: number;
  userId?: string;
  search?: string;
}

/** Only NigerConnect containers — the VPS hosts ~12 unrelated projects. */
export const CONTAINER_SELECTOR = 'nigerconnect-.+';

/**
 * Escapes a value for a double-quoted LogQL string literal: backslash and quote
 * get escaped, control characters are replaced (they would break the
 * single-line expression).
 */
export function escapeLogQL(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += ' ';
      continue;
    }
    if (ch === '\\' || ch === '"') out += '\\';
    out += ch;
  }
  return out;
}

export function buildLogQuery(filters: LogFilters): string {
  const selector = filters.container
    ? `{container="${escapeLogQL(filters.container)}"}`
    : `{container=~"${CONTAINER_SELECTOR}"}`;

  const stages: string[] = [];

  // Line filter first: it runs before parsing, so it is by far the cheapest way
  // to shrink the stream Loki has to decode.
  if (filters.search) {
    stages.push(`|= "${escapeLogQL(filters.search)}"`);
  }

  // The JSON parser is only added when a structured field is actually filtered:
  // Postgres/Redis/MinIO write plain text, and parsing would silently drop them.
  const structured =
    filters.level !== undefined ||
    filters.status !== undefined ||
    filters.statusClass !== undefined ||
    filters.userId !== undefined;

  if (structured) {
    stages.push('| json');
    if (filters.level) stages.push(`| level="${filters.level}"`);
    if (filters.status !== undefined) stages.push(`| status="${filters.status}"`);
    else if (filters.statusClass) stages.push(`| status=~"${filters.statusClass.charAt(0)}.."`);
    if (filters.userId) stages.push(`| userId="${escapeLogQL(filters.userId)}"`);
  }

  return [selector, ...stages].join(' ');
}
