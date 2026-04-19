import { readFileSync } from 'fs';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { PresenceService } from './presence.service';
import type { Env } from '../common/config/env.validation';
import type { JwtUserPayload } from '../common/decorators/current-user.decorator';

interface AuthedSocket extends Socket {
  userId: string;
  userJti: string;
}

@Injectable()
@WebSocketGateway({ namespace: '/chat', cors: { origin: true, credentials: true } })
export class ChatGateway implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly publicKey: string;

  @WebSocketServer() server!: Server;

  constructor(
    config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
    private readonly presence: PresenceService,
  ) {
    const pubPath = config.get('JWT_PUBLIC_KEY_PATH', { infer: true });
    if (!pubPath) throw new Error('JWT_PUBLIC_KEY_PATH required');
    this.publicKey = readFileSync(pubPath, 'utf8');
  }

  onModuleInit(): void {
    this.logger.log('Chat gateway ready on namespace /chat');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('No token');
      const payload = (await this.jwt.verifyAsync<JwtUserPayload>(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      })) as JwtUserPayload;
      const authed = client as AuthedSocket;
      authed.userId = payload.sub;
      authed.userJti = payload.jti;
      client.join(`user:${payload.sub}`);

      const memberRows = await this.chat.getMemberIds.bind(this.chat);
      // Subscribe to all conversation rooms the user belongs to
      const convos = await this.chat['prisma'].conversationMember.findMany({
        where: { userId: payload.sub },
        select: { conversationId: true },
      });
      for (const c of convos) client.join(`conv:${c.conversationId}`);

      await this.presence.markOnline(payload.sub);
      client.broadcast.emit('user:online', { userId: payload.sub });
      this.logger.debug(`${payload.sub} connected`);
    } catch (error) {
      this.logger.warn(`Rejecting socket: ${String(error)}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const authed = client as AuthedSocket;
    if (!authed.userId) return;
    await this.presence.markOfflineDelayed(authed.userId);
    client.broadcast.emit('user:offline', { userId: authed.userId });
  }

  @SubscribeMessage('heartbeat')
  async onHeartbeat(@ConnectedSocket() client: Socket): Promise<void> {
    const authed = client as AuthedSocket;
    if (authed.userId) await this.presence.heartbeat(authed.userId);
  }

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      content?: string;
      messageType?: 'text' | 'image' | 'file';
      mediaUrl?: string;
      replyToId?: string;
    },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const authed = client as AuthedSocket;
    if (!authed.userId) return { ok: false, error: 'unauthorized' };
    try {
      const { message, memberIds } = await this.chat.sendMessage(authed.userId, payload.conversationId, payload);
      this.broadcastNewMessage(payload.conversationId, message, memberIds);
      return { ok: true, messageId: message.id };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  @SubscribeMessage('message:read')
  async onRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; messageId?: string },
  ): Promise<void> {
    const authed = client as AuthedSocket;
    if (!authed.userId) return;
    await this.chat.markAsRead(authed.userId, payload.conversationId);
    this.server
      .to(`conv:${payload.conversationId}`)
      .emit('message:read', { conversationId: payload.conversationId, userId: authed.userId });
  }

  @SubscribeMessage('typing:start')
  onTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ): void {
    const authed = client as AuthedSocket;
    if (!authed.userId) return;
    client.to(`conv:${payload.conversationId}`).emit('typing:start', {
      conversationId: payload.conversationId,
      userId: authed.userId,
    });
  }

  @SubscribeMessage('typing:stop')
  onTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ): void {
    const authed = client as AuthedSocket;
    if (!authed.userId) return;
    client.to(`conv:${payload.conversationId}`).emit('typing:stop', {
      conversationId: payload.conversationId,
      userId: authed.userId,
    });
  }

  broadcastNewMessage(conversationId: string, message: unknown, memberIds: string[]): void {
    this.server.to(`conv:${conversationId}`).emit('message:new', message);
    // Also notify member user-rooms (so they can update conversation list even without opening convo)
    for (const id of memberIds) {
      this.server.to(`user:${id}`).emit('conversation:updated', { conversationId });
    }
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const queryToken = client.handshake.query.token;
    if (typeof queryToken === 'string') return queryToken;
    return null;
  }
}
