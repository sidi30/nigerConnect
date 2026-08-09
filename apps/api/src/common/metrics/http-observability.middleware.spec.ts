import express from 'express';
import request from 'supertest';
import { HttpObservabilityMiddleware } from './http-observability.middleware';
import { MetricsService } from './metrics.service';

/**
 * The access log is written from `res.on('finish')`. Nothing above that listener
 * catches a throw — it surfaces as an uncaughtException and Node exits — so the
 * middleware has to survive whatever a client puts in the request line.
 */
describe('HttpObservabilityMiddleware', () => {
  let metrics: MetricsService;
  let app: express.Express;
  let uncaught: jest.Mock;

  beforeEach(() => {
    metrics = new MetricsService();
    const middleware = new HttpObservabilityMiddleware(metrics);
    app = express();
    app.use((req, res, next) => middleware.use(req, res, next));
    app.get('/api/feed', (_req, res) => {
      res.json({ ok: true });
    });

    // Jest installs its own handler, so assert on ours rather than on a crash.
    uncaught = jest.fn();
    process.on('uncaughtException', uncaught);
  });

  afterEach(() => {
    process.off('uncaughtException', uncaught);
    jest.restoreAllMocks();
  });

  /** `finish` fires after the response; give the listener a tick to run. */
  const settle = () => new Promise((r) => setImmediate(r));

  it('serves a request whose query string has a malformed percent-escape', async () => {
    await request(app).get('/api/feed?%zz=1').expect(200);
    await settle();
    expect(uncaught).not.toHaveBeenCalled();
  });

  it('survives a bare "%" and a truncated UTF-8 escape', async () => {
    await request(app).get('/api/feed?%').expect(200);
    await request(app).get('/api/feed?%E0%A4%A=1').expect(200);
    await settle();
    expect(uncaught).not.toHaveBeenCalled();
  });

  it('records the route TEMPLATE, never the concrete URL', async () => {
    app.get('/api/profile/:id/photos', (_req, res) => {
      res.json({ ok: true });
    });
    await request(app).get('/api/profile/11111111-2222-3333-4444-555555555555/photos').expect(200);
    await settle();

    const scraped = await metrics.scrape();
    // A raw uuid in the label would blow Prometheus' cardinality up.
    expect(scraped).toContain('route="/api/profile/:id/photos"');
    expect(scraped).not.toContain('11111111-2222-3333-4444-555555555555');
  });

  it('collapses an unmatched path into a single label', async () => {
    await request(app).get('/api/does-not-exist-9f2c').expect(404);
    await settle();

    const scraped = await metrics.scrape();
    expect(scraped).toContain('route="unmatched"');
    expect(scraped).not.toContain('does-not-exist-9f2c');
  });

  it('replaces a client-supplied request id that is not inert', async () => {
    // The id is echoed into the log record and the response header; anything
    // outside [A-Za-z0-9._-] is dropped in favour of a fresh uuid.
    const res = await request(app)
      .get('/api/feed')
      .set('x-request-id', 'evil" {"level":"error"}')
      .expect(200);
    expect(res.headers['x-request-id']).not.toContain('"');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes an inert client-supplied request id', async () => {
    const res = await request(app).get('/api/feed').set('x-request-id', 'trace-abc.1').expect(200);
    expect(res.headers['x-request-id']).toBe('trace-abc.1');
  });
});

describe('IP coarsening', () => {
  // These lines live 30 days and every admin can filter them by userId. A full
  // address next to a user id is a movement log, not an access log.
  const logged = async (ip: string): Promise<string | undefined> => {
    const { coarsenIpForTest } = await import('./http-observability.middleware');
    return coarsenIpForTest(ip);
  };

  it('keeps IPv4 down to the /24 network', async () => {
    await expect(logged('41.79.217.123')).resolves.toBe('41.79.217.0/24');
  });

  it('unwraps the IPv4-mapped IPv6 form Express reports behind a proxy', async () => {
    await expect(logged('::ffff:41.79.217.123')).resolves.toBe('41.79.217.0/24');
  });

  it('keeps IPv6 down to the /48 site prefix', async () => {
    await expect(logged('2001:db8:1234:5678::1')).resolves.toBe('2001:db8:1234::/48');
  });

  it('drops an address it cannot coarsen rather than logging it whole', async () => {
    await expect(logged('not-an-ip')).resolves.toBeUndefined();
    await expect(logged('')).resolves.toBeUndefined();
  });
});
