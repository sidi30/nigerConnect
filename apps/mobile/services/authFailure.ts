/**
 * Le serveur a-t-il REFUSÉ la session, ou n'a-t-il simplement pas répondu ?
 *
 * La distinction est tout le sujet. Jusqu'au 20/08/2026, `hydrate()` et
 * l'intercepteur effaçaient les jetons dans les deux cas : un simple délai
 * d'attente dépassé sur un réseau mobile déconnectait l'utilisatrice, qui
 * relançait l'application et retombait sur l'écran de connexion. Vu du
 * téléphone, l'application « se réinitialise » — et rien côté serveur ne le
 * montre, puisque la requête n'y arrive jamais.
 *
 * On n'efface donc que sur un refus explicite : 401 (jeton invalide ou expiré,
 * rafraîchissement compris) et 403 (session révoquée). Tout le reste — absence
 * de réponse, délai dépassé, coupure, 5xx, passerelle du fournisseur d'accès —
 * laisse la session en place. Au pire l'utilisatrice reste connectée avec des
 * jetons morts, et le premier appel qui aboutit la déconnecte proprement.
 *
 * Volontairement SANS importer axios : ce module doit rester testable, et
 * charger axios dans l'environnement de test d'Expo casse le lancement (son
 * adaptateur `fetch` touche aux streams). On reconnaît donc la forme d'une
 * erreur axios plutôt que son type — `response` absent signifie « aucune
 * réponse reçue », quelle que soit la bibliothèque.
 */
function responseStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return null;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function isSessionRejected(error: unknown): boolean {
  const status = responseStatus(error);
  return status === 401 || status === 403;
}

/** L'inverse, nommé pour que les appelants se lisent sans négation. */
export function isNetworkFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isAxiosError' in error &&
    responseStatus(error) === null
  );
}
