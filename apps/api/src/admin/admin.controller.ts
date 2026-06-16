import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminService } from './admin.service';

const listIdentitySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
type ListIdentityDto = z.infer<typeof listIdentitySchema>;

const timeseriesSchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});
type TimeseriesDto = z.infer<typeof timeseriesSchema>;

// ── Invitation admin schemas ───────────────────────────────────────────────

const patchSettingsSchema = z
  .object({
    registrationMode: z.enum(['open', 'invite_only', 'closed']).optional(),
    defaultInviteQuota: z.coerce.number().int().min(1).max(1000).optional(),
    inviteExpiryDays: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });
type PatchSettingsDto = z.infer<typeof patchSettingsSchema>;

const generateRootInvitesSchema = z.object({
  count: z.coerce.number().int().min(1).max(200),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});
type GenerateRootInvitesDto = z.infer<typeof generateRootInvitesSchema>;

/**
 * Internal admin/moderator console API. Every route is role-gated by RolesGuard;
 * the global JWT + email-verified guards already apply. Identity-document view
 * URLs are short-lived presigned GETs (see AdminService) — the private bucket
 * is never exposed.
 */
@UseGuards(RolesGuard)
@Roles('admin', 'moderator')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  /** Per-day time-series for signups / content / reports. Query: ?days=30 (7..90). */
  @Get('metrics/timeseries')
  timeseries(@Query(new ZodValidationPipe(timeseriesSchema)) dto: TimeseriesDto) {
    return this.admin.timeseries(dto.days);
  }

  /** Distribution breakdowns for pie/bar charts (countries, statuses, funnel, etc.). */
  @Get('metrics/breakdowns')
  breakdowns() {
    return this.admin.breakdowns();
  }

  @Get('identity')
  identity(@Query(new ZodValidationPipe(listIdentitySchema)) dto: ListIdentityDto) {
    return this.admin.listIdentityDocuments(dto.status, dto.limit, dto.cursor);
  }

  // ── Invitation / Settings endpoints (§5.3) ──────────────────────────────

  /**
   * GET /admin/settings
   * Returns current runtime settings for registrationMode, defaultInviteQuota,
   * inviteExpiryDays. Accessible by both admin and moderator.
   */
  @Get('settings')
  getSettings() {
    return this.admin.getSettings();
  }

  /**
   * PATCH /admin/settings
   * Update one or more runtime settings (write-through Redis cache — immediate
   * effect, no redeploy). Restricted to admin role only.
   */
  @Patch('settings')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  patchSettings(
    @Body(new ZodValidationPipe(patchSettingsSchema)) dto: PatchSettingsDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.admin.patchSettings(dto, user.sub);
  }

  /**
   * POST /admin/invitations/root
   * Generate N root invitations (inviterId = null) for bootstrapping waitlist
   * members. Returns [{ code, url, expiresAt }]. Admin-only.
   */
  @Post('invitations/root')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  generateRootInvites(
    @Body(new ZodValidationPipe(generateRootInvitesSchema)) dto: GenerateRootInvitesDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.admin.generateRootInvites(dto.count, dto.expiresInDays, user.sub);
  }

  /**
   * GET /admin/invitations/metrics
   * Invitation funnel metrics: sent/accepted/pending/expired counts,
   * conversion rate, K-factor, top 10 inviters. Accessible by admin + moderator.
   */
  @Get('invitations/metrics')
  inviteMetrics() {
    return this.admin.inviteMetrics();
  }
}
