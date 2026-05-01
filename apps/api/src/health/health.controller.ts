import { Controller, Get, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

/**
 * Health endpoints follow the Kubernetes-style split:
 *   - /health/live   : the process is up. Cheap, no I/O. Used by Docker/Traefik
 *                      to decide whether to restart the container.
 *   - /health/ready  : the process is ready to serve traffic — DB AND Redis are
 *                      reachable. Used by uptime monitors and ops dashboards.
 *   - /health        : alias for /ready (keeps the legacy contract working).
 *
 * Liveness must not 5xx on a transient DB hiccup, otherwise the orchestrator
 * loops on restarts. Readiness can 503 — load balancers just stop routing.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly bootedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'nigerconnect-api',
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - this.bootedAt) / 1000),
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    return this.checkDeps();
  }

  @Public()
  @Get()
  async legacy() {
    return this.checkDeps();
  }

  private async checkDeps() {
    const checks = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
    ]);

    const dbOk = checks[0].status === 'fulfilled';
    const redisOk = checks[1].status === 'fulfilled';

    const payload = {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      service: 'nigerconnect-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: { db: dbOk ? 'ok' : 'down', redis: redisOk ? 'ok' : 'down' },
    };

    if (!dbOk) {
      this.logger.error('Health check: DB down', (checks[0] as PromiseRejectedResult).reason);
    }
    if (!redisOk) {
      this.logger.error('Health check: Redis down', (checks[1] as PromiseRejectedResult).reason);
    }

    if (!dbOk || !redisOk) {
      throw new HttpException(payload, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return payload;
  }
}
