import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RolesGuard } from '../auth/guards/roles.guard';
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
  constructor(private readonly observability: ObservabilityService) {}

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
  logs(@Query(new ZodValidationPipe(logsSchema)) dto: LogsDto) {
    return this.observability.logs(dto);
  }
}
