import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminMapService } from './admin-map.service';

const listUsersSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  countryCode: z.string().trim().length(2).toUpperCase().optional(),
  city: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'suspended', 'banned']).optional(),
  identityStatus: z.enum(['not_submitted', 'pending', 'approved', 'rejected']).optional(),
  // Query-string booleans: only the literal 'true'/'false' are accepted (z.coerce
  // .boolean would turn 'false' into true).
  ambassador: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  privacyLevel: z.enum(['public', 'friends', 'private']).optional(),
  side: z.enum(['diaspora', 'niger']).optional(),
  activeWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  hasPosition: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().uuid().optional(),
});
type ListUsersDto = z.infer<typeof listUsersSchema>;

// Same filters, minus the pagination — the facets describe the whole result set.
const facetsSchema = listUsersSchema.omit({ limit: true, cursor: true });
type FacetsDto = z.infer<typeof facetsSchema>;

// Exported so the security spec can assert the motive stays mandatory — this is
// the schema the owner asked for by name, not an implementation detail.
export const unlockPreciseSchema = z
  .object({
    // 6 digits only: a recovery code is a login lifeline, not a key to a
    // surveillance capability — MfaService would accept one, we don't.
    code: z.string().trim().regex(/^\d{6}$/, 'Code à 6 chiffres attendu.'),
    // Mandatory and written down: no opening this without saying why.
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
type UnlockPreciseDto = z.infer<typeof unlockPreciseSchema>;

/**
 * Admin members map (§ console).
 *
 * Admin-only — deliberately narrower than AdminController, which moderators also
 * reach: this surface plots every member's position, private accounts included,
 * and it is the way in to the real GPS position. Moderation does not need that.
 */
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/map')
export class AdminMapController {
  constructor(private readonly map: AdminMapService) {}

  /** Is the caller's break-glass window open, and until when? */
  @Get('precise-location')
  preciseLocation(@CurrentUser() admin: JwtUserPayload) {
    return this.map.preciseWindow(admin.sub);
  }

  /**
   * Open the 30-minute GPS window for the CALLING admin (TOTP + written motive).
   * A bad code is a 401 and changes nothing.
   */
  @Post('precise-location')
  @HttpCode(HttpStatus.OK)
  unlockPreciseLocation(
    @CurrentUser() admin: JwtUserPayload,
    @Body(new ZodValidationPipe(unlockPreciseSchema)) dto: UnlockPreciseDto,
  ) {
    return this.map.unlockPreciseLocation(admin.sub, dto.code, dto.reason);
  }

  /** Close the window immediately (audited). */
  @Delete('precise-location')
  @HttpCode(HttpStatus.OK)
  revokePreciseLocation(@CurrentUser() admin: JwtUserPayload) {
    return this.map.revokePreciseLocation(admin.sub);
  }

  /** Filtered, cursor-paginated members with their map position. */
  @Get('users')
  listUsers(
    @CurrentUser() admin: JwtUserPayload,
    @Query(new ZodValidationPipe(listUsersSchema)) dto: ListUsersDto,
  ) {
    return this.map.listUsers(admin.sub, dto);
  }

  /**
   * Filter dropdown contents, counted from the database. Each facet ignores the
   * filter it drives, so a choice can always be undone. ISO country codes only —
   * the front names them with Intl.DisplayNames.
   */
  @Get('facets')
  facets(@Query(new ZodValidationPipe(facetsSchema)) dto: FacetsDto) {
    return this.map.facets(dto);
  }

  /** One member's map card, expanded (contact, parrainage, dernières sessions). */
  @Get('users/:id')
  getUser(@CurrentUser() admin: JwtUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.map.getUser(admin.sub, id);
  }
}
