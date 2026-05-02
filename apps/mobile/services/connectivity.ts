import { BASE_URL } from './api';

export type Reachability =
  | { ok: true; baseUrl: string; latencyMs: number; checks: { db: string; redis: string } }
  | { ok: false; baseUrl: string; reason: string };

// `BASE_URL` is typed as `string | undefined` because the source guards it
// with a runtime `throw` rather than a type narrowing. The throw fires at
// import time, so by the time this module runs we already know it's a string.
const baseUrl = BASE_URL ?? '';

/**
 * One-shot "can the mobile app actually reach the API the way it's configured?"
 * probe. Cheap (single GET to /health), times out fast, returns a structured
 * result the UI can render so users see "API non joignable: timeout vs DNS vs
 * 503" instead of a generic "Network Error".
 */
export async function probeApi(timeoutMs = 5000): Promise<Reachability> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { ok: false, baseUrl, reason: `HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => null)) as
      | { status: string; checks?: { db: string; redis: string } }
      | null;
    if (!body) {
      return { ok: false, baseUrl, reason: 'Réponse non-JSON' };
    }
    return {
      ok: true,
      baseUrl,
      latencyMs,
      checks: body.checks ?? { db: '?', redis: '?' },
    };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    let reason = e.message ?? 'Erreur inconnue';
    if (e.name === 'AbortError') reason = `Timeout > ${timeoutMs}ms`;
    return { ok: false, baseUrl, reason };
  } finally {
    clearTimeout(t);
  }
}
