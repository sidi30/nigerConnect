import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type AdminAuditAction =
  | 'map_full_visibility'
  | 'profile_view_override'
  // Reading a reported item in the moderation console. That read deliberately
  // bypasses privacy (a moderator must see private posts and DM content to
  // decide) — so it must leave a trace, exactly like the map/profile overrides.
  | 'report_target_view'
  // Filtrer 30 jours de logs sur un userId : reconstitue le parcours horodaté
  // d'un membre nommé. Plus intrusif que les accès déjà tracés ci-dessus.
  | 'log_search_by_user'
  // Bascule de la visibilité communautaire globale : annule le « privé » de
  // chaque membre d'un coup. `updatedById` sur le réglage en gardait déjà la
  // trace, mais pas dans le journal où l'on cherche les accès privilégiés.
  // Deux actions distinctes plutôt qu'un targetId 'on'/'off' : la colonne
  // target_id est un uuid, elle aurait rejeté la valeur.
  | 'global_full_visibility_on'
  | 'global_full_visibility_off';

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
