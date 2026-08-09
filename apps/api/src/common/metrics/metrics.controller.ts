import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { Public } from '../decorators/public.decorator';
import type { Env } from '../config/env.validation';
import { MetricsService } from './metrics.service';

/**
 * GET /metrics — Prometheus scrape endpoint.
 *
 * Excluded from the `/api` global prefix (main.ts) so the scrape URL stays the
 * conventional `http://nigerconnect-api:3000/metrics`.
 *
 * Exposure is layered:
 *   1. Traefik denies `/metrics` at the edge (ipallowlist router in
 *      docker-compose.prod.yml) — the endpoint is reachable only from inside
 *      the Docker networks.
 *   2. When `METRICS_TOKEN` is set, a matching `Authorization: Bearer` is also
 *      required. Unset (the default) leaves layer 1 as the only control.
 *
 * A rejected request answers 404, not 401: an unauthenticated caller learns
 * nothing about whether the endpoint exists.
 */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  async scrape(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<string> {
    const expected = this.config.get('METRICS_TOKEN', { infer: true });
    if (expected && !bearerMatches(req.headers.authorization, expected)) {
      throw new NotFoundException();
    }
    res.type(this.metrics.contentType);
    return this.metrics.scrape();
  }
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length));
  const reference = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch — compare lengths first, which
  // leaks only the token length (not its content).
  return provided.length === reference.length && timingSafeEqual(provided, reference);
}
