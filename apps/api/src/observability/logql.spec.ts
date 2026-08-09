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

  /**
   * The threat is an admin (or a stolen admin session) widening the selector to
   * read the ~12 unrelated projects that share this VPS. Every one of these must
   * leave exactly one stream selector, still pinned to nigerconnect-*.
   */
  describe('injection attempts', () => {
    const PREFIX = '{container=~"nigerconnect-.+"} |= "';

    const payloads: Array<[string, string]> = [
      ['selector break-out', '"} or {container=~".+"} #'],
      ['second selector', '"} | json | line_format "{{.}}"'],
      // LogQL also accepts backtick-quoted strings; a backtick is NOT an escape
      // character inside a double-quoted literal, so it must pass through as-is
      // (escaping it would produce an invalid Go string and break the query).
      ['backtick string', '`} or {job=~".+"} |= `'],
      ['pipeline operators', 'a |= "b" |~ "c" != "d"'],
      ['label filter', '" | container="cs-platform-api'],
      ['regex line filter', '" |~ ".*'],
      ['trailing backslash', 'C:\\'],
      ['newline injection', 'a\n} or {container=~".+"'],
      ['unwrap / drop stages', '" | unwrap duration | drop __error__'],
    ];

    it.each(payloads)('search: %s stays inside the line filter', (_name, payload) => {
      const query = buildLogQuery({ search: payload });

      // The selector is untouched and the payload is the LAST thing in the
      // expression — nothing was appended after the closing quote.
      expect(query.startsWith(PREFIX)).toBe(true);
      expect(query.endsWith('"')).toBe(true);

      // Round-trip: scanning the emitted literal as a quoted string consumes it
      // whole and gives the payload back. If any quote inside were unescaped the
      // literal would terminate early and this would throw or come back short —
      // which is exactly what a successful break-out looks like.
      const literal = query.slice(PREFIX.length, -1);
      // Same neutralisation escapeLogQL applies to control characters.
      const inert = [...payload]
        .map((c) => {
          const code = c.codePointAt(0) ?? 0;
          return code < 0x20 || code === 0x7f ? ' ' : c;
        })
        .join('');
      expect(JSON.parse(`"${literal}"`)).toBe(inert);
    });

    it('a backtick is left alone — escaping it would be invalid LogQL', () => {
      expect(escapeLogQL('a`b')).toBe('a`b');
    });

    it('a lone backslash is doubled so the literal never ends on an escape', () => {
      expect(escapeLogQL('\\')).toBe('\\\\');
      expect(buildLogQuery({ search: '\\' })).toBe('{container=~"nigerconnect-.+"} |= "\\\\"');
    });

    it('search is a substring filter, so a regex bomb is inert', () => {
      // `|=` is a plain substring match — Loki never compiles this as a regex,
      // so there is no ReDoS surface here.
      const query = buildLogQuery({ search: '(a+)+$' });
      expect(query).toBe('{container=~"nigerconnect-.+"} |= "(a+)+$"');
      expect(query).not.toContain('|~');
    });
  });
});
