import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminAuditService } from '../common/audit/audit.service';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ObservabilityService } from './observability.service';

/** Retention is 30 days on both backends — asking for more returns nothing. */
const MAX_MINUTES = 30 * 24 * 60;

const seriesSchema = z.object({
  minutes: z.coerce.number().int().min(5).max(MAX_MINUTES).default(180),
  // Bounded so a hand-crafted request can't ask Prometheus for 11k points.
  points: z.coerce.number().int().min(10).max(400).default(120),
});
type SeriesDto = z.infer<typeof seriesSchema>;

const logsSchema = z.object({
  minutes: z.coerce.number().int().min(1).max(MAX_MINUTES).default(60),
  // Only our own containers — the VPS hosts ~12 unrelated projects.
  container: z
    .string()
    .trim()
    .regex(/^nigerconnect-[a-z0-9][a-z0-9_.-]{0,48}$/, 'Conteneur inconnu')
    .optional(),
  level: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  statusClass: z.enum(['2xx', '3xx', '4xx', '5xx']).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  userId: z.string().uuid().optional(),
  // Confort d'enquête : l'admin a l'email du membre qui signale, pas son UUID.
  // Résolu en UUID côté serveur — Loki n'indexe que l'UUID.
  userEmail: z.string().trim().toLowerCase().email().max(200).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
type LogsDto = z.infer<typeof logsSchema>;

/**
 * Admin observability console (§ supervision).
 *
 * Prometheus and Loki are never exposed to the browser: these routes are the
 * only path in, they run on the private Docker network, and they are gated to
 * the admin role — logs carry userIds, IPs and stack traces, which is more than
 * a moderator needs. Queries are built server-side from validated filters.
 */
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/observability')
export class ObservabilityController {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Whether Prometheus/Loki are configured and answering. */
  @Get('status')
  status() {
    return this.observability.status();
  }

  /** Host + app KPIs and per-container CPU/RAM. */
  @Get('overview')
  overview() {
    return this.observability.overview();
  }

  /** Error-rate and throughput series for the trend chart. */
  @Get('error-rate')
  errorRate(@Query(new ZodValidationPipe(seriesSchema)) dto: SeriesDto) {
    return this.observability.errorRateSeries(dto.minutes, dto.points);
  }

  /** Container names Loki has logs for — populates the filter dropdown. */
  @Get('containers')
  containers() {
    return this.observability.containers();
  }

  /** Filtered log search (level, HTTP status, userId, container, text). */
  @Get('logs')
  async logs(
    @CurrentUser() admin: JwtUserPayload,
    @Query(new ZodValidationPipe(logsSchema)) dto: LogsDto,
  ) {
    const { userEmail, ...filters } = dto;
    let userId = filters.userId;
    if (!userId && userEmail) {
      const resolved = await this.observability.userIdForEmail(userEmail);
      // Email inconnu : renvoyer un résultat vide, surtout pas la totalité des
      // logs — un filtre qui s'évapore silencieusement est un piège.
      if (!resolved) {
        return { available: true, query: '', entries: [], reason: 'Aucun compte pour cet email.' };
      }
      userId = resolved;
    }

    // Retracer 30 jours d'activité d'un membre nommé est un accès privilégié :
    // il laisse une trace, comme la carte god-mode ou l'ouverture d'un profil
    // privé. Une recherche non ciblée (par niveau, statut, texte) n'en laisse
    // pas — c'est de l'exploitation, pas de la surveillance individuelle.
    if (userId) await this.audit.log(admin.sub, 'log_search_by_user', userId);
    return this.observability.logs({ ...filters, userId });
  }
}
