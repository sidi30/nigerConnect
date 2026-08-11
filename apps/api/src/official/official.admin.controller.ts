import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  broadcastNotificationSchema,
  officialDirectMessageSchema,
  officialMessageSchema,
  officialMessagesQuerySchema,
  officialPostSchema,
  officialStorySchema,
  officialThreadsQuerySchema,
  officialUploadSchema,
  updateOfficialSchema,
  type BroadcastNotificationDto,
  type OfficialDirectMessageDto,
  type OfficialMessageDto,
  type OfficialMessagesQueryDto,
  type OfficialPostDto,
  type OfficialStoryDto,
  type OfficialThreadsQueryDto,
  type OfficialUploadDto,
  type UpdateOfficialDto,
} from './dto/official.dto';
import { OfficialService } from './official.service';

/**
 * Console du compte officiel NigerConnect. Admin STRICT (pas modérateur) :
 * parler au nom de la plateforme à toute la communauté n'est pas un acte de
 * modération, et le badge ne vaut que si la liste de ceux qui peuvent
 * l'utiliser est courte. Les gardes JWT + email vérifié s'appliquent déjà.
 *
 * Les envois sont throttlés : une diffusion part vers TOUS les membres, un
 * double-clic ou une session compromise ne doit pas pouvoir en lancer dix.
 */
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/official')
export class OfficialAdminController {
  constructor(private readonly official: OfficialService) {}

  // ── Le compte ───────────────────────────────────────────────────────────

  /** Profil + compteurs. Crée le compte au premier appel. */
  @Get()
  account() {
    return this.official.account();
  }

  @Patch()
  @HttpCode(200)
  updateAccount(@Body(new ZodValidationPipe(updateOfficialSchema)) dto: UpdateOfficialDto) {
    return this.official.updateAccount(dto);
  }

  @Throttle({ short: { limit: 20, ttl: 60_000 }, long: { limit: 200, ttl: 3_600_000 } })
  @Post('upload')
  @HttpCode(200)
  upload(@Body(new ZodValidationPipe(officialUploadSchema)) dto: OfficialUploadDto) {
    return this.official.presignUpload(dto);
  }

  // ── Publier ─────────────────────────────────────────────────────────────

  @Throttle({ short: { limit: 10, ttl: 60_000 }, long: { limit: 100, ttl: 3_600_000 } })
  @Post('posts')
  @HttpCode(201)
  publishPost(
    @Body(new ZodValidationPipe(officialPostSchema)) dto: OfficialPostDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.official.publishPost(dto, me.sub);
  }

  @Throttle({ short: { limit: 10, ttl: 60_000 }, long: { limit: 100, ttl: 3_600_000 } })
  @Post('stories')
  @HttpCode(201)
  publishStory(
    @Body(new ZodValidationPipe(officialStorySchema)) dto: OfficialStoryDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.official.publishStory(dto, me.sub);
  }

  @Get('content')
  content() {
    return this.official.listContent();
  }

  @Delete('content/:id')
  @HttpCode(204)
  deleteContent(@Param('id', ParseUUIDPipe) id: string) {
    return this.official.deleteContent(id);
  }

  // ── Diffuser ────────────────────────────────────────────────────────────

  /** Notification à toute la communauté. 202 : l'envoi continue en tâche de fond. */
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 20, ttl: 3_600_000 } })
  @Post('broadcasts/notification')
  @HttpCode(202)
  broadcastNotification(
    @Body(new ZodValidationPipe(broadcastNotificationSchema)) dto: BroadcastNotificationDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.official.broadcastNotification(dto, me.sub);
  }

  /** Message direct à toute la communauté (reçu comme un message, pas une annonce). */
  @Throttle({ short: { limit: 3, ttl: 60_000 }, long: { limit: 20, ttl: 3_600_000 } })
  @Post('broadcasts/message')
  @HttpCode(202)
  broadcastMessage(
    @Body(new ZodValidationPipe(officialMessageSchema)) dto: OfficialMessageDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.official.broadcastMessage(dto, me.sub);
  }

  @Get('broadcasts')
  broadcasts() {
    return this.official.listBroadcasts();
  }

  // ── Conversations ───────────────────────────────────────────────────────

  /** Écrire à une personne précise. */
  @Throttle({ short: { limit: 30, ttl: 60_000 }, long: { limit: 300, ttl: 3_600_000 } })
  @Post('messages')
  @HttpCode(201)
  sendDirect(
    @Body(new ZodValidationPipe(officialDirectMessageSchema)) dto: OfficialDirectMessageDto,
    @CurrentUser() me: JwtUserPayload,
  ) {
    return this.official.sendDirectMessage(dto, me.sub);
  }

  @Get('threads')
  threads(
    @Query(new ZodValidationPipe(officialThreadsQuerySchema)) dto: OfficialThreadsQueryDto,
  ) {
    return this.official.listThreads(dto.limit, dto.cursor);
  }

  @Get('threads/:id')
  thread(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(officialMessagesQuerySchema)) dto: OfficialMessagesQueryDto,
  ) {
    return this.official.listThreadMessages(id, dto.limit, dto.cursor);
  }

  @Throttle({ short: { limit: 30, ttl: 60_000 }, long: { limit: 300, ttl: 3_600_000 } })
  @Post('threads/:id/reply')
  @HttpCode(201)
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(officialMessageSchema)) dto: OfficialMessageDto,
  ) {
    return this.official.replyInThread(id, dto);
  }
}
