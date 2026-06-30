import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

const listMissingDobSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
type ListMissingDobDto = z.infer<typeof listMissingDobSchema>;

const setDobSchema = z.object({
  dateOfBirth: z
    .string()
    .date()
    .refine((d) => Date.parse(d) <= Date.now(), 'dateOfBirth cannot be in the future'),
});
type SetDobDto = z.infer<typeof setDobSchema>;

// ── Invitation admin schemas ───────────────────────────────────────────────

const patchSettingsSchema = z
  .object({
    registrationMode: z.enum(['open', 'invite_only', 'closed']).optional(),
    defaultInviteQuota: z.coerce.number().int().min(1).max(1000).optional(),
    inviteExpiryDays: z.coerce.number().int().min(1).max(365).optional(),
    // Once on, staff (admin/moderator) without TOTP enrolled cannot log in.
    adminMfaRequired: z.boolean().optional(),
    // Support override: when on, an admin sees every member on the map + can open
    // any (even private) profile. Privacy-sensitive — off by default.
    adminFullVisibility: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });
type PatchSettingsDto = z.infer<typeof patchSettingsSchema>;

const generateRootInvitesSchema = z.object({
  count: z.coerce.number().int().min(1).max(200),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
  // 'reusable' = un seul lien racine partageable en masse (bootstrap waitlist).
  kind: z.enum(['single_use', 'reusable']).optional(),
});
type GenerateRootInvitesDto = z.infer<typeof generateRootInvitesSchema>;

const bulkInviteSchema = z.object({ allowed: z.boolean() }).strict();
type BulkInviteDto = z.infer<typeof bulkInviteSchema>;

const searchUsersSchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
type SearchUsersDto = z.infer<typeof searchUsersSchema>;

const ambassadorSchema = z.object({ value: z.boolean() }).strict();
type AmbassadorDto = z.infer<typeof ambassadorSchema>;

const listUsersSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'suspended', 'banned']).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
type ListUsersDto = z.infer<typeof listUsersSchema>;

const userStatusSchema = z
  .object({ status: z.enum(['active', 'suspended', 'banned']) })
  .strict();
type UserStatusDto = z.infer<typeof userStatusSchema>;

const updateUserSchema = z
  .object({
    displayName: z.string().trim().max(100).nullable().optional(),
    firstName: z.string().trim().max(100).nullable().optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    countryCode: z.string().trim().length(2).toUpperCase().nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
    role: z.enum(['user', 'moderator', 'admin']).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });
type UpdateUserDto = z.infer<typeof updateUserSchema>;

const listReferralsSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
type ListReferralsDto = z.infer<typeof listReferralsSchema>;

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

  /** Backfill queue: approved users missing a DOB (proximity 18+ gate). Admin-only. */
  @Roles('admin')
  @Get('identity/missing-dob')
  identityMissingDob(@Query(new ZodValidationPipe(listMissingDobSchema)) dto: ListMissingDobDto) {
    return this.admin.listApprovedMissingDob(dto.limit, dto.cursor);
  }

  /** Record the DOB on an already-approved user's document (backfill). Admin-only. */
  @Roles('admin')
  @Patch('identity/:userId/dob')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setIdentityDob(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(setDobSchema)) dto: SetDobDto,
  ): Promise<void> {
    await this.admin.setApprovedDob(userId, dto.dateOfBirth);
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
    return this.admin.generateRootInvites(dto.count, dto.expiresInDays, user.sub, dto.kind ?? 'single_use');
  }

  /**
   * PATCH /admin/users/:id/bulk-invite
   * Accorde/retire le droit de générer des liens d'invitation en masse. Admin-only.
   */
  @Patch('users/:id/bulk-invite')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  setBulkInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(bulkInviteSchema)) dto: BulkInviteDto,
  ) {
    return this.admin.setBulkInviteRight(id, dto.allowed);
  }

  /**
   * GET /admin/users/search?q=&limit=
   * Recherche d'utilisateurs (nom / email) pour la gestion des badges ambassadeur.
   * Admin-only : l'attribution du badge est une distinction curatée.
   */
  @Get('users/search')
  @Roles('admin')
  searchUsers(@Query(new ZodValidationPipe(searchUsersSchema)) dto: SearchUsersDto) {
    return this.admin.searchUsers(dto.q, dto.limit);
  }

  /**
   * PATCH /admin/users/:id/ambassador
   * Active/désactive le badge ambassadeur (indépendant de la vérification
   * d'identité). Admin-only. Idempotent.
   */
  @Patch('users/:id/ambassador')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  setAmbassador(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ambassadorSchema)) dto: AmbassadorDto,
  ) {
    return this.admin.setAmbassador(id, dto.value);
  }

  /**
   * GET /admin/audit/full-visibility — recent accesses made under the "full
   * visibility" support override (god-mode map browsing + private-profile opens).
   * Admin-only.
   */
  @Get('audit/full-visibility')
  @Roles('admin')
  fullVisibilityLog(@Query('limit') limit?: string) {
    const lim = limit ? Math.min(200, Math.max(1, Number(limit) || 50)) : 50;
    return this.admin.fullVisibilityLog(lim);
  }

  // ── User management (§ admin console) ───────────────────────────────────────

  /**
   * GET /admin/users — paginated list of registered users (name/email search +
   * status filter). Admin + moderator (the moderation queue needs to see users).
   */
  @Get('users')
  listUsers(@Query(new ZodValidationPipe(listUsersSchema)) dto: ListUsersDto) {
    return this.admin.listUsers(dto);
  }

  /**
   * PATCH /admin/users/:id/status — block/unblock (active|suspended|banned).
   * Admin + moderator. Self-status and acting on staff are refused in the service.
   */
  @Patch('users/:id/status')
  @HttpCode(HttpStatus.OK)
  setUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userStatusSchema)) dto: UserStatusDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.admin.setUserStatus({ id: me.sub, role: me.role }, id, dto.status);
  }

  /**
   * PATCH /admin/users/:id — edit profile fields and/or role. Admin-only.
   */
  @Patch('users/:id')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.admin.updateUser({ id: me.sub, role: me.role }, id, dto);
  }

  /**
   * DELETE /admin/users/:id — permanently delete a user (cascade + S3). Admin-only.
   */
  @Delete('users/:id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: JwtUserPayload) {
    return this.admin.deleteUser({ id: me.sub }, id);
  }

  /**
   * GET /admin/referrals
   * Arbre de parrainage (vue plate paginée) : qui a invité qui. Admin + moderator.
   */
  @Get('referrals')
  referrals(@Query(new ZodValidationPipe(listReferralsSchema)) dto: ListReferralsDto) {
    return this.admin.listReferrals(dto.limit, dto.cursor);
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
