/**
 * Turns whatever a failed API call threw into a sentence worth showing.
 *
 * Order matters: the server's own message is the most specific thing we have
 * (Nest sends `{ message }`, and Zod failures send an array of them), so it
 * wins. Everything below is a fallback for the cases where there is no body at
 * all — offline, timeout, 5xx.
 *
 * `notFound` lets a screen name the thing that was missing ("Association
 * introuvable") instead of the generic wording.
 */
export function describeError(err: unknown, notFound = 'Introuvable.'): string {
  const e = err as {
    message?: string;
    response?: { status?: number; data?: { message?: string | string[] } };
  } | null;

  const apiMsg = e?.response?.data?.message;
  const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
  if (msg) return msg;

  const status = e?.response?.status;
  if (status === 404) return notFound;
  if (status === 429) return 'Trop de tentatives. Patiente un instant.';
  if (status && status >= 500) return 'Le serveur ne répond pas. Réessaie dans un instant.';
  if (/network/i.test(e?.message ?? '')) return 'Pas de connexion. Vérifie ton réseau.';
  return e?.message ?? 'Une erreur est survenue.';
}
