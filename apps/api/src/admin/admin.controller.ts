import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { verifyAssociationSchema, type VerifyAssociationDto } from '../association/dto/association.dto';
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

const retentionSchema = z.object({
  // 4 semaines minimum pour qu'une courbe veuille dire quelque chose, 26 max
  // pour borner le balayage.
  weeks: z.coerce.number().int().min(4).max(26).default(12),
});
type RetentionDto = z.infer<typeof retentionSchema>;

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

// Le motif est obligatoire et substantiel : c'est la seule justification écrite
// d'une garde de protection des mineurs ouverte à la main.
const adultOverrideSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});
type AdultOverrideDto = z.infer<typeof adultOverrideSchema>;

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
    // Community-wide override: when on, EVERY member sees every profile (the
    // per-user privacyLevel gates are lifted; showOnMap and the per-post
    // visibility choice stay honoured). Off by default: the choice belongs to
    // each member, as today.
    globalFullVisibility: z.boolean().optional(),
    // Master kill-switch for the stories-video beta. Off by default (ships DARK);
    // the disk guard also forces it off — this is how an admin RE-ARMS it after
    // reclaiming disk.
    // Community policy: members living in Niger (or who never set a country)
    // cannot open contact with diaspora members — no friend request, no first
    // message. ON by default; this is how it is lifted without a deploy.
    diasporaContactRestriction: z.boolean().optional(),
    // Séparation des contenus : chaque camp ne voit que ses publications.
    // Indépendant du contact — l'un dit qui peut écrire, l'autre qui voit quoi.
    diasporaContentSplit: z.boolean().optional(),
    // Un membre sans pays renseigné compte-t-il comme résidant au Niger ?
    diasporaUnknownCountryRestricted: z.boolean().optional(),
    videoEnabled: z.boolean().optional(),
    // Master kill-switch for the weekly regional digest (E-DIGEST). Off by
    // default (ships DARK); this is how an admin RE-ARMS it without SQL.
    digestEnabled: z.boolean().optional(),
    // Master kill-switch for the one-shot "complète ton profil" email nudge.
    // Off by default (ships DARK); enable here without SQL.
    profileReminderEnabled: z.boolean().optional(),
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
  role: z.enum(['user', 'moderator', 'admin']).optional(),
  // Query-string booleans: only the literal 'true'/'false' are accepted (z.coerce
  // .boolean would turn 'false' into true).
  emailVerified: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  identityStatus: z.enum(['not_submitted', 'pending', 'approved', 'rejected']).optional(),
  ambassador: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  createdAfter: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
type ListUsersDto = z.infer<typeof listUsersSchema>;

const userStatusSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'banned']),
    // Motive shown back to the sanctioned user; required for a suspension/ban.
    reason: z.string().trim().min(1).max(500).optional(),
    // Optional auto-lift instant for a temporary suspension (omit = permanent).
    expiresAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.status !== 'active' && !d.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Un motif est requis pour suspendre ou bannir un compte.',
      });
    }
    if (d.expiresAt && d.expiresAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: "La date d'expiration doit être dans le futur.",
      });
    }
  });
type UserStatusDto = z.infer<typeof userStatusSchema>;

const userAuditSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type UserAuditDto = z.infer<typeof userAuditSchema>;

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
  // Recherche par email (parrain OU filleul), insensible à la casse. Filtre
  // serveur uniquement : l'email n'est jamais renvoyé par cette vue.
  q: z.string().trim().min(2).max(100).optional(),
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
  @Get('metrics/retention')
  retention(@Query(new ZodValidationPipe(retentionSchema)) dto: RetentionDto) {
    return this.admin.retention(dto.weeks);
  }

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

  /**
   * Dérogation de majorité pour un profil connu, quand la date de naissance est
   * définitivement perdue. Tracée au journal d'audit avec le motif. Admin-only.
   */
  @Roles('admin')
  @Patch('identity/:userId/adult-override')
  @HttpCode(HttpStatus.NO_CONTENT)
  async grantAdultOverride(
    @CurrentUser() admin: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(adultOverrideSchema)) dto: AdultOverrideDto,
  ): Promise<void> {
    await this.admin.grantAdultOverride(admin.sub, userId, dto.reason);
  }

  /** Retire la dérogation : retour au contrôle 18+ normal. Admin-only. */
  @Roles('admin')
  @Delete('identity/:userId/adult-override')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAdultOverride(
    @CurrentUser() admin: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.admin.revokeAdultOverride(admin.sub, userId);
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
   * GET /admin/users/:id/detail — full profile + sanction state + counters +
   * invitation stats + live sessions. Admin + moderator (moderation needs it).
   */
  @Get('users/:id/detail')
  userDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getUserDetail(id);
  }

  /**
   * GET /admin/users/:id/audit — sensitive-action audit trail for one user. Admin-only.
   */
  @Get('users/:id/audit')
  @Roles('admin')
  userAudit(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(userAuditSchema)) dto: UserAuditDto,
  ) {
    return this.admin.getUserAudit(id, dto.limit);
  }

  /**
   * PATCH /admin/users/:id/status — sanction (active|suspended|banned) with a
   * motive + optional expiry. Admin + moderator. Self-status and acting on staff
   * are refused in the service; reason is required (schema) for suspend/ban.
   */
  @Patch('users/:id/status')
  @HttpCode(HttpStatus.OK)
  setUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(userStatusSchema)) dto: UserStatusDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.admin.setUserStatus({ id: me.sub, role: me.role }, id, {
      status: dto.status,
      reason: dto.reason,
      expiresAt: dto.expiresAt,
    });
  }

  /**
   * POST /admin/users/:id/force-logout — revoke every live session/refresh token.
   * Admin-only.
   */
  @Post('users/:id/force-logout')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  forceLogout(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: JwtUserPayload) {
    return this.admin.forceLogout({ id: me.sub }, id);
  }

  /**
   * POST /admin/users/:id/reset-mfa — clear the user's TOTP enrollment so they can
   * re-enroll (lost authenticator). Admin-only.
   */
  @Post('users/:id/reset-mfa')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  resetMfa(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: JwtUserPayload) {
    return this.admin.resetMfa({ id: me.sub }, id);
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
    return this.admin.listReferrals(dto.limit, dto.cursor, dto.q);
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

  // ── A5 — association certification (traceable, admin-only) ─────────────

  /**
   * POST /admin/associations/:id/verify — grant the "Association vérifiée"
   * badge. Platform admin-only (moderators do routine content moderation, not
   * the stronger claim a certification badge makes).
   */
  @Post('associations/:id/verify')
  @Roles('admin')
  verifyAssociation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(verifyAssociationSchema)) dto: VerifyAssociationDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.admin.verifyAssociation({ id: me.sub }, id, dto.note);
  }

  /**
   * POST /admin/associations/:id/unverify — revoke it. Same guard, symmetric
   * endpoint (not a DELETE: we still record an optional reason).
   */
  @Post('associations/:id/unverify')
  @Roles('admin')
  unverifyAssociation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(verifyAssociationSchema)) dto: VerifyAssociationDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.admin.unverifyAssociation({ id: me.sub }, id, dto.note);
  }
}
