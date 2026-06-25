import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InvitationsService } from './invitations.service';
import {
  checkInvitationSchema,
  createInvitationSchema,
  listInvitationsSchema,
} from './invitations.schemas';
import type {
  CheckInvitationDto,
  CreateInvitationDto,
  ListInvitationsDto,
} from './invitations.schemas';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /**
   * POST /invitations
   * Create an invitation for the authenticated, email-verified user.
   * EmailVerifiedGuard (global) enforces email verification.
   * Service-level checks handle quota + abuse-flag freeze.
   *
   * Optional body field: email (string) — when provided, the platform sends an
   * invitation email to that address and stores it as targetEmail for email-match
   * registration (data-minimized: purged once the invitation leaves 'pending').
   *
   * Dedicated throttle: the per-user invite quota only bounds *concurrent*
   * pending invites — a verified user can otherwise loop create → revoke
   * (refunds the slot) → create to fire an unbounded stream of invitation
   * emails to arbitrary addresses, turning the platform into a spam/mailbomb
   * relay (each create sends one email). The quota does NOT cap total sends, so
   * we add an explicit per-IP throttle on top: ~10/min and 40/day is plenty for
   * a genuine user inviting friends, while stopping bulk abuse from the DKIM-
   * signed sender domain (reputation protection).
   */
  @Post()
  @Throttle({ short: { limit: 10, ttl: 60_000 }, long: { limit: 40, ttl: 86_400_000 } })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(createInvitationSchema)) dto: CreateInvitationDto,
  ) {
    const result = await this.invitations.createInvitation(user.sub, dto);
    return result;
  }

  /**
   * GET /invitations
   * List current user's invitations plus quota summary.
   * Must come before /:id routes so Express doesn't match 'check' as a UUID.
   * Cursor-paginated (params optionnels) — la réponse reste rétro-compatible
   * (canBulkInvite + invites inchangés, ajout d'un nextCursor optionnel).
   */
  @Get()
  async list(
    @CurrentUser() user: JwtUserPayload,
    @Query(new ZodValidationPipe(listInvitationsSchema)) dto: ListInvitationsDto,
  ) {
    return this.invitations.listInvitations(user.sub, dto.limit, dto.cursor);
  }

  /**
   * GET /invitations/check?code=…
   * Public pre-validation endpoint. Strong throttle to prevent code enumeration.
   * 2 req/s (short) and 30/hr (long) — tight enough to be secure.
   */
  @Public()
  @Throttle({ short: { limit: 2, ttl: 1_000 }, long: { limit: 30, ttl: 3_600_000 } })
  @Get('check')
  async check(
    @Query(new ZodValidationPipe(checkInvitationSchema)) dto: CheckInvitationDto,
  ) {
    return this.invitations.checkInvitation(dto.code);
  }

  /**
   * POST /invitations/:id/revoke
   * Revoke a pending invitation owned by the current user.
   * Returns 204 on success; service throws 404/409 on wrong owner or non-pending status.
   */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() user: JwtUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.invitations.revokeInvitation(user.sub, id);
  }
}
