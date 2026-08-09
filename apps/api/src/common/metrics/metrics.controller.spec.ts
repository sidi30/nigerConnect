import {
  Controller,
  Get,
  Global,
  INestApplication,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsModule } from './metrics.module';

/** Exercises the middleware: a real route so `req.route.path` is populated. */
@Controller('demo')
class DemoController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Get('boom')
  boom() {
    throw new NotFoundException();
  }
}

let token: string | undefined;

/** Stands in for AppConfigModule, which is @Global() in the real app. */
@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: { get: () => token } }],
  exports: [ConfigService],
})
class FakeConfigModule {}

describe('MetricsController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    token = undefined;
    const moduleRef = await Test.createTestingModule({
      imports: [FakeConfigModule, MetricsModule],
      controllers: [DemoController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes the Prometheus registry in text format', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_requests_total');
    // Default metrics come along for free — heap, event loop, GC.
    expect(res.text).toContain('process_cpu_seconds_total');
  });

  it('does not count its own scrapes', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(200);
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).not.toContain('route="/metrics"');
  });

  it('counts requests by route template, not by concrete URL', async () => {
    await request(app.getHttpServer()).get('/demo/ok').expect(200);
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toMatch(
      /http_requests_total\{[^}]*method="GET"[^}]*route="\/demo\/ok"[^}]*status="200"[^}]*\} 1/,
    );
    expect(res.text).toContain('http_request_duration_seconds_bucket');
  });

  it('records 4xx returned by a handler as an error', async () => {
    await request(app.getHttpServer()).get('/demo/boom').expect(404);
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toMatch(/http_errors_total\{[^}]*class="4xx"[^}]*\} 1/);
  });

  it('collapses unmatched paths into a single label to bound cardinality', async () => {
    await request(app.getHttpServer()).get('/does/not/exist').expect(404);
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('route="unmatched"');
  });

  it('echoes a request id, and refuses a client-supplied one that is not inert', async () => {
    const clean = await request(app.getHttpServer())
      .get('/demo/ok')
      .set('x-request-id', 'trace-abc_123');
    expect(clean.headers['x-request-id']).toBe('trace-abc_123');

    const dirty = await request(app.getHttpServer())
      .get('/demo/ok')
      .set('x-request-id', 'evil";drop');
    expect(dirty.headers['x-request-id']).not.toBe('evil";drop');
    expect(dirty.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers 404 (not 401) when METRICS_TOKEN is set and the bearer is wrong', async () => {
    token = 'a-very-long-metrics-token';
    await request(app.getHttpServer()).get('/metrics').expect(404);
    await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', 'Bearer wrong-token')
      .expect(404);
    await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
