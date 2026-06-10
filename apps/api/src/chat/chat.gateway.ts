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
import { z } from 'zod';
import type { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { PresenceService } from './presence.service';
import { RedisService } from '../common/redis/redis.service';
import { sendMessageSchema } from './dto/chat.dto';
import type { Env } from '../common/config/env.validation';
import type { JwtUserPayload } from '../common/decorators/current-user.decorator';

/**
 * Per-user ceiling on `message:send`. 30 messages per 60 s is ~well above
 * a normal human's typing rate but low enough to make bot-driven flooding
 * visible in logs and painful in wall-clock time. Window is a sliding
 * 60 s Redis counter keyed by user (not socket) so attackers can't sidestep
 * it by reconnecting.
 */
const MESSAGE_RATE_LIMIT = 30;
const MESSAGE_RATE_WINDOW_SECONDS = 60;

// Socket-side equivalent of the REST validation: the body fields validated by
// sendMessageSchema PLUS the conversationId that REST takes from the URL param.
const socketSendMessageSchema = sendMessageSchema.and(
  z.object({ conversationId: z.string().uuid() }),
);

interface AuthedSocket extends Socket {
  userId: string;
  userJti: string;
}

// Resolved at module load — CORS_ORIGINS env is already validated at startup (env.validation.ts).
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

@Injectable()
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: corsOrigins.length ? corsOrigins : false,
    credentials: true,
  },
})
export class ChatGateway implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly publicKeys: string[];
  private readonly issuer: string;
  private readonly audience: string;

  @WebSocketServer() server!: Server;

  constructor(
    config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
    private readonly presence: PresenceService,
    private readonly redis: RedisService,
  ) {
    const pubPath = config.get('JWT_PUBLIC_KEY_PATH', { infer: true });
    if (!pubPath) throw new Error('JWT_PUBLIC_KEY_PATH required');
    this.publicKeys = [readFileSync(pubPath, 'utf8')];
    const prevPath = config.get('JWT_PREVIOUS_PUBLIC_KEY_PATH', { infer: true });
    if (prevPath) this.publicKeys.push(readFileSync(prevPath, 'utf8'));
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.audience = config.get('JWT_AUDIENCE', { infer: true });
  }

  onModuleInit(): void {
    this.logger.log('Chat gateway ready on namespace /chat');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('No token');
      const payload = await this.verifyToken(token);
      const authed = client as AuthedSocket;
      authed.userId = payload.sub;
      authed.userJti = payload.jti;
      client.join(`user:${payload.sub}`);

      // Subscribe to all conversation rooms the user belongs to
      const convos = await this.chat['prisma'].conversationMember.findMany({
        where: { userId: payload.sub },
        select: { conversationId: true },
      });
      for (const c of convos) client.join(`conv:${c.conversationId}`);

      await this.presence.markOnline(payload.sub);
      // Presence has to be scoped to people who can plausibly already see
      // this user's online status — i.e. members of conversations they
      // share. `client.broadcast.emit(...)` would have leaked presence to
      // every connected socket in the namespace, including total strangers.
      this.emitPresence(client, payload.sub, 'user:online', convos.map((c) => c.conversationId));
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
    // Same scoping as 'user:online' — only conv co-members get notified.
    // We can read the rooms the socket was in directly off the socket; by
    // the time disconnect fires they're still attached.
    const convRooms = Array.from(client.rooms).filter((r) => r.startsWith('conv:'));
    this.emitPresence(
      client,
      authed.userId,
      'user:offline',
      convRooms.map((r) => r.slice('conv:'.length)),
    );
  }

  private emitPresence(
    client: Socket,
    userId: string,
    event: 'user:online' | 'user:offline',
    conversationIds: string[],
  ): void {
    if (conversationIds.length === 0) return;
    const rooms = conversationIds.map((id) => `conv:${id}`);
    // `client.to(rooms).emit(...)` excludes the sender's own socket, which
    // is the right semantic — we don't echo presence back to the owner.
    client.to(rooms).emit(event, { userId });
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
    // Per-user rate limit, enforced in Redis so it holds across sockets.
    const count = await this.redis.incrementCounter(
      `ratelimit:chat:send:${authed.userId}`,
      MESSAGE_RATE_WINDOW_SECONDS,
    );
    if (count > MESSAGE_RATE_LIMIT) {
      this.logger.warn(`Chat rate-limit hit for user ${authed.userId} (count=${count})`);
      return { ok: false, error: 'rate_limited' };
    }
    // The REST path runs the body through ZodValidationPipe(sendMessageSchema)
    // and the conversation id through ParseUUIDPipe. The socket path bypassed
    // both, so validate the same shape here. `conversationId` lives in the
    // payload over WS (it's a URL param in REST), hence the extra uuid field.
    let parsed: { conversationId: string } & z.infer<typeof sendMessageSchema>;
    try {
      parsed = socketSendMessageSchema.parse(payload);
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: 'invalid' };
      throw error;
    }
    try {
      const { message, memberIds } = await this.chat.sendMessage(authed.userId, parsed.conversationId, parsed);
      this.broadcastNewMessage(parsed.conversationId, message, memberIds);
      return { ok: true, messageId: message.id };
    } catch (error) {
      // Don't leak internal details to the peer — log server-side, emit a
      // stable code.
      const isClient = error instanceof Error && /Forbidden|BadRequest|NotFound/i.test(error.constructor.name);
      this.logger.warn(`message:send rejected for ${authed.userId}: ${String(error)}`);
      return { ok: false, error: isClient ? error.message : 'internal_error' };
    }
  }

  @SubscribeMessage('message:read')
  async onRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; messageId?: string },
  ): Promise<void> {
    const authed = client as AuthedSocket;
    if (!authed.userId) return;
    // markAsRead asserts membership and can throw (Forbidden / not found); mirror
    // onSend and swallow so a bad/forged id can't crash the handler.
    let lastReadAt: Date;
    try {
      lastReadAt = await this.chat.markAsRead(authed.userId, payload.conversationId);
    } catch (error) {
      this.logger.warn(`message:read rejected for ${authed.userId}: ${String(error)}`);
      return;
    }
    // Broadcast to all conversation members (including the reader themselves
    // so they can sync across multiple devices). The `lastReadAt` ISO string
    // allows the recipient's sender-side to compute ✓✓ by comparing it against
    // each message's createdAt — no per-message read flag needed in the DB.
    this.server
      .to(`conv:${payload.conversationId}`)
      .emit('message:read', {
        conversationId: payload.conversationId,
        userId: authed.userId,
        lastReadAt: lastReadAt.toISOString(),
      });
  }

  @SubscribeMessage('typing:start')
  onTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ): void {
    const authed = client as AuthedSocket;
    if (!authed.userId) return;
    // Only members get a conv: room on connect, so room membership is a cheap
    // stand-in for the DB membership check — stops non-members spoofing typing.
    if (!client.rooms.has(`conv:${payload.conversationId}`)) return;
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
    if (!client.rooms.has(`conv:${payload.conversationId}`)) return;
    client.to(`conv:${payload.conversationId}`).emit('typing:stop', {
      conversationId: payload.conversationId,
      userId: authed.userId,
    });
  }

  broadcastNewMessage(conversationId: string, message: unknown, memberIds: string[]): void {
    // Make sure every member who's currently connected is in the conv: room
    // before we emit. `handleConnection` only joins rooms for conversations
    // that already existed at connect time — without this, a member who's
    // online and just got added to a fresh conversation would miss every
    // `message:new` until they reconnect. `socketsJoin` is idempotent: if the
    // socket is already in the room it's a no-op.
    for (const userId of memberIds) {
      this.server.in(`user:${userId}`).socketsJoin(`conv:${conversationId}`);
    }
    this.server.to(`conv:${conversationId}`).emit('message:new', message);
    // Also notify member user-rooms (so they can update conversation list even without opening convo)
    for (const id of memberIds) {
      this.server.to(`user:${id}`).emit('conversation:updated', { conversationId });
    }
  }

  /**
   * Broadcast an edited message to the conversation room so every connected
   * member swaps the old bubble for the new content + "modifié" badge live.
   */
  broadcastMessageUpdated(conversationId: string, message: unknown, memberIds: string[]): void {
    this.server.to(`conv:${conversationId}`).emit('message:updated', message);
    for (const id of memberIds) {
      this.server.to(`user:${id}`).emit('conversation:updated', { conversationId });
    }
  }

  /**
   * Broadcast a "delete for everyone": clients replace the bubble with a
   * tombstone. We only ship the id (content is already gone server-side).
   */
  broadcastMessageDeleted(conversationId: string, messageId: string, memberIds: string[]): void {
    this.server
      .to(`conv:${conversationId}`)
      .emit('message:deleted', { conversationId, messageId });
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

  /**
   * Verify against each configured public key (current + optional previous during
   * rotation). Also enforces `iss` and `aud` claims, matching JwtStrategy.
   */
  private async verifyToken(token: string): Promise<JwtUserPayload> {
    let lastErr: unknown;
    for (const publicKey of this.publicKeys) {
      try {
        return (await this.jwt.verifyAsync<JwtUserPayload>(token, {
          publicKey,
          algorithms: ['RS256'],
          issuer: this.issuer,
          audience: this.audience,
        })) as JwtUserPayload;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('Invalid token');
  }
}
