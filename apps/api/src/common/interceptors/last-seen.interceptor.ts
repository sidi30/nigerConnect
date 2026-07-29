import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { JwtUserPayload } from '../decorators/current-user.decorator';

/**
 * Minimum delay between two `lastSeenAt` writes for the same member. Retention
 * is read in whole days, so an hourly resolution is plenty — and it caps the
 * write amplification at 1 UPDATE per member per hour instead of one per request.
 */
const WRITE_THROTTLE_SECONDS = 3_600;

/**
 * Stamps `User.lastSeenAt` on authenticated traffic so active-member counts
 * (DAU / WAU / MAU, retention) can be computed at all — nothing else in the
 * schema records that a member came back.
 *
 * Deliberately cheap and non-blocking: a Redis `SET NX` acts as the throttle,
 * the UPDATE is fire-and-forget, and any failure is swallowed. A missed stamp
 * costs an approximation in a dashboard; it must never fail a user's request.
 */
@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: JwtUserPayload }>();

    return next.handle().pipe(
      tap({
        // Only on success: a rejected request (revoked token, 403) is not a visit.
        next: () => {
          const userId = req.user?.sub;
          if (userId) void this.stamp(userId);
        },
      }),
    );
  }

  private async stamp(userId: string): Promise<void> {
    try {
      // NX = first writer within the window wins; everyone else is a no-op.
      const acquired = await this.redis.client.set(
        `lastseen:${userId}`,
        '1',
        'EX',
        WRITE_THROTTLE_SECONDS,
        'NX',
      );
      if (acquired !== 'OK') return;
      // Raw UPDATE on purpose: `prisma.user.update` would also bump the
      // `@updatedAt` column, and `updatedAt` is exposed in profile payloads
      // where it must keep meaning "the profile changed", not "the member
      // opened the app".
      await this.prisma.$executeRaw`UPDATE users SET last_seen_at = NOW() WHERE id = ${userId}::uuid`;
    } catch {
      // Presence telemetry is best-effort — never surface it to the caller.
    }
  }
}
