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
} from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import {
  createConversationSchema,
  sendMessageSchema,
  type CreateConversationDto,
  type SendMessageDto,
} from './dto/chat.dto';

@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get('conversations')
  list(
    @CurrentUser() me: JwtUserPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 30;
    return this.chat.listConversations(me.sub, cursor, lim);
  }

  @Post('conversations')
  create(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createConversationSchema)) dto: CreateConversationDto,
  ) {
    return this.chat.createConversation(me.sub, dto.participantIds, dto.name);
  }

  @Get('conversations/:id')
  getOne(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.chat.getConversation(me.sub, id);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 50;
    return this.chat.listMessages(me.sub, id, cursor, lim);
  }

  @Post('conversations/:id/messages')
  async send(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) dto: SendMessageDto,
  ) {
    const { message, memberIds } = await this.chat.sendMessage(me.sub, id, dto);
    this.gateway.broadcastNewMessage(id, message, memberIds);
    return message;
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.chat.markAsRead(me.sub, id);
  }

  @Delete('messages/:id')
  async deleteMessage(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.chat.softDeleteMessage(me.sub, id);
  }
}
