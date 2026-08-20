import type { PersistedClient } from '@tanstack/react-query-persist-client';

/**
 * Taille maximale du cache écrit sur le disque, en caractères JSON.
 *
 * Deux mégaoctets environ. Ce n'est pas la place sur le disque qui est en jeu,
 * c'est le THREAD JS : `JSON.stringify` du cache entier tourne dessus à chaque
 * écriture, et `JSON.parse` au démarrage. Sur un téléphone d'entrée de gamme,
 * un cache de plusieurs mégaoctets se traduit par des centaines de
 * millisecondes de gel à chaque fois — puis par la boîte « l'application ne
 * répond pas » que le système finit par afficher.
 *
 * Rien ne bornait ce cache : `gcTime` à 24 h et aucun filtre, donc chaque page
 * de fil parcourue s'y ajoutait pour la journée.
 */
const MAX_CHARS = 2_000_000;

/**
 * Familles de requêtes sacrifiées en premier quand le cache déborde.
 *
 * Ce sont les plus grosses et les moins utiles au redémarrage : le fil se
 * recharge en une seconde, les marqueurs de carte sont refaits à chaque
 * déplacement, les stories expirent en 24 h. Ce qui reste — profil,
 * conversations, notifications — est petit et fait vraiment gagner l'ouverture.
 */
const HEAVY_FAMILIES: readonly string[] = ['feed', 'geo', 'stories', 'polls', 'community-prices'];

function familyOf(queryKey: unknown): string | null {
  if (!Array.isArray(queryKey)) return null;
  const first = queryKey[0];
  return typeof first === 'string' ? first : null;
}

/**
 * Sérialise le cache, en le dégraissant s'il dépasse la limite.
 *
 * Trois paliers, du moins au plus brutal : tout, puis sans les familles
 * lourdes, puis rien. Le dernier palier n'est pas un échec — un cache absent
 * fait juste recharger depuis le réseau, ce que l'application sait faire.
 */
export function serializeBounded(client: PersistedClient): string {
  const full = JSON.stringify(client);
  if (full.length <= MAX_CHARS) return full;

  const trimmed: PersistedClient = {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.filter((q) => {
        const family = familyOf(q.queryKey);
        return family === null || !HEAVY_FAMILIES.includes(family);
      }),
    },
  };
  const lighter = JSON.stringify(trimmed);
  if (lighter.length <= MAX_CHARS) return lighter;

  // Toujours trop gros : on repart d'un cache vide plutôt que de faire payer
  // au démarrage suivant une lecture de plusieurs mégaoctets.
  return JSON.stringify({
    ...client,
    clientState: { ...client.clientState, queries: [], mutations: [] },
  } satisfies PersistedClient);
}
