import { scrubUrl } from './http-exception.filter';

/**
 * scrubUrl runs on EVERY request (HttpObservabilityMiddleware writes the access
 * log from a `res.on('finish')` listener, where a throw is an uncaught exception
 * that kills the process). These tests pin both halves of the contract: it never
 * throws, and it never lets a credential through to a 30-day log store.
 */
describe('scrubUrl', () => {
  it('leaves a URL without a query string untouched', () => {
    expect(scrubUrl('/api/feed')).toBe('/api/feed');
  });

  it('keeps the shape params readable — paging, tri, format', () => {
    // Liste BLANCHE : seules ces valeurs-la survivent dans le journal.
    expect(scrubUrl('/api/associations?limit=50&offset=100')).toBe(
      '/api/associations?limit=50&offset=100',
    );
  });

  it('caviarde tout ce qui decrit le SUJET de la requete, pas sa forme', () => {
    // Le coeur de F-01 : ces valeurs partaient en clair dans Loki, conservees
    // 30 jours a cote du userId — donc les deplacements et les recherches
    // horodates d'un membre nomme. La cle reste lisible, la valeur non.
    expect(scrubUrl('/api/geo/nearby?lat=13.51366&lon=2.1098')).toBe(
      '/api/geo/nearby?lat=REDACTED&lon=REDACTED',
    );
    expect(scrubUrl('/api/search?q=Ramzi')).toBe('/api/search?q=REDACTED');
    expect(scrubUrl('/api/feed?cursor=YWJjZA==')).toBe('/api/feed?cursor=REDACTED');
  });

  it('redacts the known credential-bearing params', () => {
    expect(scrubUrl('/api/auth/verify-email?token=deadbeef')).toBe(
      '/api/auth/verify-email?token=REDACTED',
    );
    expect(scrubUrl('/api/invitations/check?code=ABC123')).toBe(
      '/api/invitations/check?code=REDACTED',
    );
  });

  it('redacts on a key FRAGMENT, so a new param name is covered by default', () => {
    expect(scrubUrl('/x?reset_token=v')).toBe('/x?reset_token=REDACTED');
    expect(scrubUrl('/x?apiKey=v')).toBe('/x?apiKey=REDACTED');
    expect(scrubUrl('/x?X-Signature=v')).toBe('/x?X-Signature=REDACTED');
    expect(scrubUrl('/x?oauth_verifier=v')).toBe('/x?oauth_verifier=REDACTED');
  });

  it('caviarde une cle inconnue plutot que de la laisser passer', () => {
    // Fail-closed : un parametre ajoute demain est protege par defaut, il faut
    // un geste explicite pour exposer sa valeur.
    expect(scrubUrl('/api/geo/cities?country_code=NE')).toBe(
      '/api/geo/cities?country_code=REDACTED',
    );
  });

  it('ne tronque pas la cle quand la valeur contient "=" (padding base64)', () => {
    // L'ancien split('=', 2) mangeait tout apres le second '=' ; la cle doit
    // rester intacte et lisible meme quand sa valeur est caviardee.
    expect(scrubUrl('/api/feed?cursor=YWJjZA==')).toBe('/api/feed?cursor=REDACTED');
  });

  it('does NOT throw on a malformed percent-escape', () => {
    // `GET /api/feed?%zz=1` used to make decodeURIComponent throw inside the
    // access-log listener — an unauthenticated remote process kill.
    expect(() => scrubUrl('/api/feed?%zz=1')).not.toThrow();
    expect(() => scrubUrl('/api/feed?%=1')).not.toThrow();
    expect(() => scrubUrl('/api/feed?%E0%A4%A=1')).not.toThrow();
    expect(() => scrubUrl('/health?%')).not.toThrow();
  });

  it('still redacts when the sensitive key is percent-encoded', () => {
    // `%74oken` decodes to `token`.
    expect(scrubUrl('/x?%74oken=v')).toBe('/x?%74oken=REDACTED');
  });

  it('leaves a valueless param alone', () => {
    expect(scrubUrl('/api/feed?refresh')).toBe('/api/feed?refresh');
  });
});
