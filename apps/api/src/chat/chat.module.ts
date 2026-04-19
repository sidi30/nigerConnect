import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, PresenceService],
  exports: [ChatService, ChatGateway, PresenceService],
})
export class ChatModule {}
