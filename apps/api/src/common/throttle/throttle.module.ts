import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Global rate limiting — applied to every HTTP route.
 *
 *   - `short`   :   10 req /  1s  — per IP  (spam protection)
 *   - `medium`  :  100 req / 60s  — per IP  (abuse protection)
 *   - `long`    : 1000 req / 3600s — per IP (bulk protection)
 *
 * Individual routes may tighten further with `@Throttle({ default: { limit, ttl } })`.
 * Public routes are NOT exempt — brute-force needs limits.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 100 },
      { name: 'long', ttl: 3_600_000, limit: 1_000 },
    ]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppThrottleModule {}
