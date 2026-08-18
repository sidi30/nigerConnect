import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AnimationService } from './animation.service';
import { AnimationChatService } from './animation-chat.service';
import { AnimationEngagementService } from './animation-engagement.service';
import {
  draftReplySchema,
  presignAvatarSchema,
  setAvatarSchema,
  enqueueSchema,
  listQueueSchema,
  reviewSchema,
  updateBotSchema,
  type DraftReplyDto,
  type PresignAvatarDto,
  type SetAvatarDto,
  type EnqueueDto,
  type ListQueueDto,
  type ReviewDto,
  type UpdateBotDto,
} from './dto/animation.dto';

/**
 * Console d'animation — réservée à l'administrateur, comme le compte officiel.
 *
 * C'est aussi l'API que l'atelier appelle depuis le poste du propriétaire : il
 * s'authentifie avec un compte admin, dépose ses brouillons, et n'a JAMAIS les
 * identifiants des 25 comptes — ceux-ci ne servent qu'au serveur.
 */
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/animation')
export class AnimationAdminController {
  constructor(
    private readonly animation: AnimationService,
    private readonly chat: AnimationChatService,
    private readonly engagement: AnimationEngagementService,
  ) {}

  /** Crée ou met à jour les 25 comptes du roster. Idempotent. */
  @Post('accounts')
  ensureAccounts() {
    return this.animation.ensureAccounts();
  }

  @Get('accounts')
  listAccounts() {
    return this.animation.listAccounts();
  }

  /** Dépôt d'une publication par l'atelier. */
  @Post('queue')
  enqueue(@Body(new ZodValidationPipe(enqueueSchema)) dto: EnqueueDto) {
    return this.animation.enqueue(dto);
  }

  @Get('queue')
  list(@Query(new ZodValidationPipe(listQueueSchema)) query: ListQueueDto) {
    return this.animation.list(query.status, query.limit);
  }

  @Get('stats')
  stats() {
    return this.animation.stats();
  }

  /** Signe le téléversement de l'avatar d'un compte (dossier users/{id}). */
  @Post('bots/:handle/avatar/presign')
  presignAvatar(
    @Param('handle') handle: string,
    @Body(new ZodValidationPipe(presignAvatarSchema)) dto: PresignAvatarDto,
  ) {
    return this.animation.presignAvatar(handle, dto.contentType);
  }

  /** Fixe l'avatar une fois le fichier téléversé. */
  @Patch('bots/:handle/avatar')
  setAvatar(
    @Param('handle') handle: string,
    @Body(new ZodValidationPipe(setAvatarSchema)) dto: SetAvatarDto,
  ) {
    return this.animation.setAvatar(handle, dto.avatarUrl);
  }

  // ── Pilotage des comptes ───────────────────────────────────

  /** Réglages de tous les comptes : cadence, fenêtre horaire, thèmes, on/off. */
  @Get('bots')
  listBots() {
    return this.animation.listBots();
  }

  /** Change la cadence d'un compte. Prend effet au balayage suivant, sans deploy. */
  @Patch('bots/:handle')
  updateBot(
    @Param('handle') handle: string,
    @Body(new ZodValidationPipe(updateBotSchema)) dto: UpdateBotDto,
  ) {
    return this.animation.updateBot(handle, dto);
  }

  // ── Conversations ──────────────────────────────────────────

  /** Toutes les conversations privées des comptes, pour contrôle. */
  @Get('conversations')
  listConversations(@Query('handle') handle?: string) {
    return this.animation.listConversations(handle);
  }

  /** Le fil complet d'une conversation, tel que le membre le voit. */
  @Get('conversations/:id')
  readConversation(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.animation.readConversation(id);
  }

  /**
   * Conversations remontées : un membre a demandé s'il parlait à une vraie
   * personne. Le compte s'y est tu — la réponse revient au propriétaire.
   */
  @Get('escalations')
  listEscalations() {
    return this.chat.listEscalated();
  }

  /** L'atelier dépose le texte d'une réponse en attente. */
  @Patch('replies/:id')
  draftReply(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(draftReplySchema)) dto: DraftReplyDto,
  ) {
    return this.animation.draftReply(id, dto.draft);
  }

  // ── Engagement ─────────────────────────────────────────────

  /**
   * Commentaires programmés qui attendent leur texte. C'est la liste de travail
   * de l'atelier : le serveur a choisi la cible et l'heure, il manque les mots.
   */
  @Get('actions/pending-comments')
  pendingComments() {
    return this.engagement.pendingComments();
  }

  /** L'atelier dépose le texte d'un commentaire programmé. */
  @Patch('actions/:id')
  draftComment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(draftReplySchema)) dto: DraftReplyDto,
  ) {
    return this.engagement.draftComment(id, dto.draft);
  }

  /** Valide ou refuse un brouillon — le seul chemin de sortie d'un `law`. */
  @Patch('queue/:id')
  review(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(reviewSchema)) dto: ReviewDto,
  ) {
    return this.animation.review(id, me.sub, dto);
  }
}
