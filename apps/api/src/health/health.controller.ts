import { Controller, Get, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
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
      this.logger.error(
        'Health check: Redis down',
        (checks[1] as PromiseRejectedResult).reason,
      );
    }

    if (!dbOk || !redisOk) {
      throw new HttpException(payload, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return payload;
  }
}
