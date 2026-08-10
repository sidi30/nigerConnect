import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ContactService } from './contact.service';
import { createContactSchema, listContactSchema, patchContactSchema } from './contact.schemas';
import type { CreateContactDto, ListContactDto, PatchContactDto } from './contact.schemas';

/**
 * « Nous contacter » — partenariat, demande d'info, problème.
 *
 * Le message est stocké pour la console admin ET notifié par email. Route
 * authentifiée : elle sert l'écran mobile, et un compte derrière chaque message
 * suffit à décourager le spam (le throttle couvre le reste).
 */
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * POST /contact
   *
   * Throttle serré : chaque message déclenche un envoi SMTP depuis le domaine
   * signé DKIM. Un membre légitime écrit une fois, pas trois fois par minute —
   * au-delà c'est du bruit qui abîme la réputation du domaine.
   */
  @Post()
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 20, ttl: 86_400_000 } })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtUserPayload,
    @Body(new ZodValidationPipe(createContactSchema)) dto: CreateContactDto,
  ) {
    return this.contact.create(user.sub, dto);
  }
}

/**
 * Boîte de réception de la console admin. Role-gated par RolesGuard, comme le
 * reste de /admin — un membre ne doit jamais lire les messages des autres.
 */
@Controller('admin/contact')
@UseGuards(RolesGuard)
@Roles('admin', 'moderator')
export class AdminContactController {
  constructor(private readonly contact: ContactService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(listContactSchema)) dto: ListContactDto) {
    return this.contact.list(dto);
  }

  @Patch(':id')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: JwtUserPayload,
    @Body(new ZodValidationPipe(patchContactSchema)) dto: PatchContactDto,
  ) {
    return this.contact.setStatus(id, admin.sub, dto);
  }
}
