import { ObservabilityService } from './observability.service';

/**
 * The monitoring stack is deployed independently of the API (two-phase rollout),
 * so the API must be perfectly happy without it: no boot-time I/O, no throw, no
 * 500 — just `available: false` and a reason the console can display.
 */
const makeConfig = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as never;

describe('ObservabilityService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('when no monitoring backend is configured', () => {
    const service = new ObservabilityService(makeConfig({}));

    it('performs no network call at construction time', () => {
      const spy = jest.fn();
      global.fetch = spy as never;
      // Constructing must be inert — the constructor runs during Nest bootstrap.
      new ObservabilityService(makeConfig({ PROMETHEUS_URL: 'http://x:9090' }));
      expect(spy).not.toHaveBeenCalled();
    });

    it('reports both backends as unconfigured', async () => {
      await expect(service.status()).resolves.toEqual({
        prometheus: { configured: false, reachable: false },
        loki: { configured: false, reachable: false },
      });
    });

    it('returns an unavailable overview instead of throwing', async () => {
      const overview = await service.overview();
      expect(overview.available).toBe(false);
      expect(overview.reason).toContain('PROMETHEUS_URL');
      expect(overview.host.cpuPercent).toBeNull();
      expect(overview.containers).toEqual([]);
    });

    it('returns an unavailable log search, but still exposes the query it would run', async () => {
      const res = await service.logs({ minutes: 60, limit: 100, level: 'error' });
      expect(res.available).toBe(false);
      expect(res.reason).toContain('LOKI_URL');
      expect(res.entries).toEqual([]);
      expect(res.query).toBe('{container=~"nigerconnect-.+"} | json | level="error"');
    });

    it('returns no containers rather than failing the dropdown', async () => {
      await expect(service.containers()).resolves.toEqual([]);
    });
  });

  describe('when the backend is configured but unreachable', () => {
    const service = new ObservabilityService(
      makeConfig({
        PROMETHEUS_URL: 'http://nigerconnect-prometheus:9090',
        LOKI_URL: 'http://nigerconnect-loki:3100',
      }),
    );

    beforeEach(() => {
      global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as never;
    });

    it('degrades the overview instead of propagating the error', async () => {
      const overview = await service.overview();
      expect(overview.available).toBe(false);
      expect(overview.reason).toContain('injoignable');
    });

    it('degrades the log search instead of propagating the error', async () => {
      const res = await service.logs({ minutes: 60, limit: 100 });
      expect(res.available).toBe(false);
      expect(res.entries).toEqual([]);
    });

    it('reports unreachable rather than hanging the status endpoint', async () => {
      await expect(service.status()).resolves.toEqual({
        prometheus: { configured: true, reachable: false },
        loki: { configured: true, reachable: false },
      });
    });
  });

  describe('when Loki answers', () => {
    const service = new ObservabilityService(
      makeConfig({ LOKI_URL: 'http://nigerconnect-loki:3100' }),
    );

    it('lifts the fields of our JSON lines and leaves plain-text lines readable', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                result: [
                  {
                    stream: { container: 'nigerconnect-api', stream: 'stderr' },
                    values: [
                      [
                        '1700000002000000000',
                        JSON.stringify({
                          level: 'error',
                          status: 500,
                          userId: 'u-1',
                          requestId: 'r-1',
                          msg: 'GET /api/feed 500',
                        }),
                      ],
                    ],
                  },
                  {
                    stream: { container: 'nigerconnect-postgres', stream: 'stdout' },
                    values: [['1700000001000000000', 'LOG:  database system is ready']],
                  },
                ],
              },
            }),
        }),
      ) as never;

      const res = await service.logs({ minutes: 60, limit: 100 });
      expect(res.available).toBe(true);
      // Streams arrive sorted per-stream; the merged view must be newest-first.
      expect(res.entries.map((e) => e.container)).toEqual([
        'nigerconnect-api',
        'nigerconnect-postgres',
      ]);

      const [apiLine, pgLine] = res.entries;
      expect(apiLine).toMatchObject({
        level: 'error',
        status: 500,
        userId: 'u-1',
        requestId: 'r-1',
        message: 'GET /api/feed 500',
        ts: 1_700_000_002_000,
      });
      // Non-JSON stays intact — Postgres doesn't speak our log format.
      expect(pgLine).toMatchObject({
        level: null,
        status: null,
        message: 'LOG:  database system is ready',
      });
    });

    it('keeps only nigerconnect containers in the dropdown', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: ['nigerconnect-api', 'sahabi-web', 'nigerconnect-postgres', 'cs-redis'],
            }),
        }),
      ) as never;

      await expect(service.containers()).resolves.toEqual([
        'nigerconnect-api',
        'nigerconnect-postgres',
      ]);
    });
  });
});
