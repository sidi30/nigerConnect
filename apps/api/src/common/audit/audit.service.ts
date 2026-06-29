import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type AdminAuditAction = 'map_full_visibility' | 'profile_view_override';

// The map refetches on every pan, so we collapse god-mode map browsing to one
// audit row per admin per this window instead of one per request.
const MAP_DEBOUNCE_SECONDS = 300;

/**
 * Writes the audit trail for privileged "admin full visibility" accesses — when
 * an admin sees the god-mode map or opens a profile the override (not normal
 * permissions) revealed. Best-effort: a logging failure never breaks the read.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async log(adminId: string, action: AdminAuditAction, targetId?: string): Promise<void> {
    try {
      await this.prisma.adminAccessLog.create({
        data: { adminId, action, targetId: targetId ?? null },
      });
    } catch (e) {
      this.logger.warn(`admin audit log failed: ${String(e)}`);
    }
  }

  /** Debounced map-override log (≤ 1 row / admin / window). */
  async logMapOverride(adminId: string): Promise<void> {
    try {
      const first = await this.redis.client.set(
        `audit:mapfullvis:${adminId}`,
        '1',
        'EX',
        MAP_DEBOUNCE_SECONDS,
        'NX',
      );
      if (first === 'OK') await this.log(adminId, 'map_full_visibility');
    } catch {
      /* best-effort */
    }
  }

  /** Recent override accesses, newest first (admin console). */
  async recent(limit = 50) {
    return this.prisma.adminAccessLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
