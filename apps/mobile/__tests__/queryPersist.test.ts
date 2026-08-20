import type { PersistedClient } from '@tanstack/react-query-persist-client';
import { serializeBounded } from '../services/queryPersist';

/**
 * Le cache React Query était persisté sans aucune borne : `gcTime` à 24 h,
 * aucun filtre, et `JSON.stringify` du tout sur le thread JS à chaque écriture.
 * Une journée de défilement suffit à le faire grossir jusqu'à geler le
 * démarrage sur un téléphone d'entrée de gamme — jusqu'à la boîte système
 * « l'application ne répond pas ».
 */
const query = (family: string, sizeChars: number) => ({
  queryKey: [family, 'x'],
  queryHash: `["${family}","x"]`,
  state: { data: 'a'.repeat(sizeChars) },
});

const client = (queries: unknown[]): PersistedClient =>
  ({
    timestamp: 1,
    buster: 'v1',
    clientState: { mutations: [], queries },
  }) as unknown as PersistedClient;

const parse = (raw: string) =>
  JSON.parse(raw) as { clientState: { queries: { queryKey: string[] }[] } };

const families = (raw: string) => parse(raw).clientState.queries.map((q) => q.queryKey[0]);

describe('serializeBounded', () => {
  it('laisse passer un cache de taille normale sans rien toucher', () => {
    const c = client([query('profile', 100), query('feed', 100)]);
    expect(serializeBounded(c)).toBe(JSON.stringify(c));
  });

  it('sacrifie les familles lourdes avant les autres', () => {
    // Le fil pèse à lui seul plus que la limite ; le profil est minuscule.
    const c = client([query('profile', 50), query('feed', 3_000_000)]);
    expect(families(serializeBounded(c))).toEqual(['profile']);
  });

  it('vide tout si le dégraissage ne suffit pas', () => {
    // Ce qui reste après le dégraissage dépasse encore la limite : un cache
    // vide vaut mieux qu'une lecture de plusieurs mégaoctets au démarrage.
    const c = client([query('conversations', 3_000_000)]);
    expect(families(serializeBounded(c))).toEqual([]);
  });

  it('garde toujours un JSON valide et la structure attendue', () => {
    const c = client([query('geo', 3_000_000)]);
    const out = parse(serializeBounded(c));
    expect(out.clientState.queries).toEqual([]);
    expect((out as unknown as PersistedClient).buster).toBe('v1');
  });

  it('ne jette pas une requête dont la clé n’est pas exploitable', () => {
    // Clé vide ou non textuelle : on ne sait pas ce que c'est, donc on garde.
    const c = client([
      { queryKey: [], queryHash: '[]', state: { data: 'x' } },
      query('feed', 3_000_000),
    ]);
    expect(parse(serializeBounded(c)).clientState.queries).toHaveLength(1);
  });
});
