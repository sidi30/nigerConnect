import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { JwtUserPayload } from '../decorators/current-user.decorator';
import { scrubUrl } from '../filters/http-exception.filter';
import { writeLog } from '../logger/json-logger';
import { MetricsService } from './metrics.service';

export const REQUEST_ID_HEADER = 'x-request-id';

/** A client-supplied correlation id is echoed into logs — keep it inert. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Probe traffic: counted in metrics but not written to Loki (pure noise, 30d). */
const SILENT_PATHS = new Set(['/health', '/health/live', '/health/ready']);

/**
 * Per-request metrics + access log.
 *
 * Deliberately a MIDDLEWARE and not an interceptor: interceptors run *after*
 * the guards, so a request rejected by JwtAuthGuard/RolesGuard would produce
 * neither a metric nor a log line — and 401/403 spikes are exactly what the
 * admin console needs to surface. Middleware sees every request, and the
 * `finish` event reports the real final status even when the exception filter
 * rewrote it.
 */
@Injectable()
export class HttpObservabilityMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // `req.path` is relative to the middleware's mount point (Nest mounts this
    // on a wildcard, which eats the prefix) — originalUrl is the only reliable
    // source for the real pathname here.
    const pathname = (req.originalUrl || req.url).split('?', 1)[0] ?? '/';

    // The scrape endpoint measuring itself would only add noise to its own numbers.
    if (pathname === '/metrics') {
      next();
      return;
    }

    const started = process.hrtime.bigint();
    const incoming = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId =
      candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();

    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      // Nothing sits above a `finish` listener to catch a throw: it surfaces as
      // an uncaughtException and takes the process down. Observability must not
      // be able to kill the API, so the whole body is guarded — losing one
      // access-log line is always the better outcome.
      try {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const status = res.statusCode;
        // `req.route` only exists once Express matched a handler; everything else
        // (404s, malformed paths) collapses into one label to bound cardinality.
        const routePath = (req as Request & { route?: { path?: string } }).route?.path;
        const route = routePath ? `${req.baseUrl}${routePath}` : 'unmatched';

        this.metrics.observeHttp(req.method, route, status, seconds);

        if (SILENT_PATHS.has(pathname)) return;

        const userId = (req as Request & { user?: JwtUserPayload }).user?.sub;
        const url = scrubUrl(req.originalUrl);
        writeLog(
          status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
          'HTTP',
          `${req.method} ${url} ${status}`,
          {
            requestId,
            method: req.method,
            // Scrubbed: password-reset tokens and OAuth codes must never reach Loki.
            url,
            route,
            status,
            durationMs: Math.round(seconds * 1000),
            ...(userId ? { userId } : {}),
            ip: req.ip,
          },
        );
      } catch {
        // Deliberately silent: the only reporting channel available here is the
        // one that just failed.
      }
    });

    next();
  }
}
