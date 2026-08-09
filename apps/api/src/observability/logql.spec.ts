import { buildLogQuery, escapeLogQL } from './logql';

describe('escapeLogQL', () => {
  it('escapes quotes and backslashes', () => {
    expect(escapeLogQL('a"b\\c')).toBe('a\\"b\\\\c');
  });

  it('neutralises control characters', () => {
    expect(escapeLogQL('a\nb\tc')).toBe('a b c');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLogQL('timeout après 30s')).toBe('timeout après 30s');
  });
});

describe('buildLogQuery', () => {
  it('scopes to nigerconnect containers by default', () => {
    // The VPS hosts ~12 unrelated projects — a missing selector would leak them.
    expect(buildLogQuery({})).toBe('{container=~"nigerconnect-.+"}');
  });

  it('pins a single container when asked', () => {
    expect(buildLogQuery({ container: 'nigerconnect-api' })).toBe(
      '{container="nigerconnect-api"}',
    );
  });

  it('adds the json parser only when a structured field is filtered', () => {
    expect(buildLogQuery({ search: 'boom' })).toBe(
      '{container=~"nigerconnect-.+"} |= "boom"',
    );
    expect(buildLogQuery({ level: 'error' })).toBe(
      '{container=~"nigerconnect-.+"} | json | level="error"',
    );
  });

  it('filters by exact status, and by class when no exact status is given', () => {
    expect(buildLogQuery({ status: 404 })).toContain('| status="404"');
    expect(buildLogQuery({ statusClass: '5xx' })).toContain('| status=~"5.."');
    // An exact status wins — asking for both must not emit two status filters.
    const both = buildLogQuery({ status: 503, statusClass: '4xx' });
    expect(both).toContain('| status="503"');
    expect(both).not.toContain('status=~');
  });

  it('combines every filter in one expression', () => {
    expect(
      buildLogQuery({
        container: 'nigerconnect-api',
        search: 'prisma',
        level: 'error',
        statusClass: '5xx',
        userId: '11111111-2222-3333-4444-555555555555',
      }),
    ).toBe(
      '{container="nigerconnect-api"} |= "prisma" | json | level="error" ' +
        '| status=~"5.." | userId="11111111-2222-3333-4444-555555555555"',
    );
  });

  it('cannot be escaped out of by a crafted search term', () => {
    // A raw `"} | ...` would otherwise close the selector and start a new stage.
    const query = buildLogQuery({ search: '"} |= "' });
    expect(query).toBe('{container=~"nigerconnect-.+"} |= "\\"} |= \\""');
  });
});
