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

  it('keeps innocent params readable', () => {
    expect(scrubUrl('/api/associations?limit=50&cursor=abc')).toBe(
      '/api/associations?limit=50&cursor=abc',
    );
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

  it('does not redact a param that merely CONTAINS a short sensitive word', () => {
    // `code` is exact-match only — `country_code=NE` stays diagnosable.
    expect(scrubUrl('/api/geo/cities?country_code=NE')).toBe('/api/geo/cities?country_code=NE');
  });

  it('keeps the whole value when it contains "=" (base64 padding)', () => {
    // The old split('=', 2) reassembly silently truncated everything after the
    // second '=', mangling cursors and base64 values in the log.
    expect(scrubUrl('/api/feed?cursor=YWJjZA==')).toBe('/api/feed?cursor=YWJjZA==');
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
