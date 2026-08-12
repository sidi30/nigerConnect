import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { NotificationService } from './notification.service';

const registerDeviceSchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(['ios', 'android', 'web']),
});

const deleteDeviceSchema = z.object({
  // Même borne qu'à l'enregistrement (et que la colonne) : inutile d'accepter
  // en suppression une chaîne qui n'a jamais pu être stockée.
  token: z.string().min(1).max(500),
});

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(
    @CurrentUser() me: JwtUserPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 30;
    return this.notifications.list(me.sub, cursor, lim);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() me: JwtUserPayload) {
    return { count: await this.notifications.unreadCount(me.sub) };
  }

  @Patch(':id/read')
  markRead(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.markRead(me.sub, id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() me: JwtUserPayload) {
    return this.notifications.markAllRead(me.sub);
  }

  @Delete('clear-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearAll(@CurrentUser() me: JwtUserPayload): Promise<void> {
    await this.notifications.clearAll(me.sub);
  }

  /**
   * The app registers its push token once, at startup. A member who hasn't
   * verified their email yet was answered 403 here and the app never asked
   * again for that session — so their device stayed unreachable until the next
   * cold start. Storing a token grants nothing (the fan-out still only fires on
   * notifications the member is entitled to), so let it through.
   */
  @AllowUnverified()
  @Post('register-device')
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerDevice(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(registerDeviceSchema)) dto: z.infer<typeof registerDeviceSchema>,
  ): Promise<void> {
    await this.notifications.registerPushToken(me.sub, dto.token, dto.platform);
  }

  /**
   * Symétrique de l'enregistrement : ouvrir l'attache aux comptes non vérifiés
   * sans ouvrir le détachement laissait un appareil attaché à un compte qu'on
   * ne peut plus quitter — la déconnexion prenait 403 et le téléphone gardait
   * les notifications d'un compte dont on est parti.
   */
  @AllowUnverified()
  @Delete('device')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDevice(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(deleteDeviceSchema)) dto: z.infer<typeof deleteDeviceSchema>,
  ): Promise<void> {
    await this.notifications.deletePushToken(me.sub, dto.token);
  }

  // Declared last so the literal DELETE routes above (device, clear-all) win.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.notifications.remove(me.sub, id);
  }
}
