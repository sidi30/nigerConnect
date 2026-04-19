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
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { NotificationService } from './notification.service';

const registerDeviceSchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(['ios', 'android', 'web']),
});

const deleteDeviceSchema = z.object({
  token: z.string().min(1),
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

  @Post('register-device')
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerDevice(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(registerDeviceSchema)) dto: z.infer<typeof registerDeviceSchema>,
  ): Promise<void> {
    await this.notifications.registerPushToken(me.sub, dto.token, dto.platform);
  }

  @Delete('device')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDevice(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(deleteDeviceSchema)) dto: z.infer<typeof deleteDeviceSchema>,
  ): Promise<void> {
    await this.notifications.deletePushToken(me.sub, dto.token);
  }
}
