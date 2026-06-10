import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { tokenStore } from '@/services/secureStore';
import { useAuthStore } from '@/stores/authStore';

const resolvedSocket =
  (Constants.expoConfig?.extra?.socketUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_SOCKET_URL;
const SOCKET_URL = resolvedSocket ?? (__DEV__ ? 'http://localhost:3000' : undefined);
if (!SOCKET_URL) {
  throw new Error(
    'EXPO_PUBLIC_SOCKET_URL / extra.socketUrl is required in production builds. Configure it in eas.json (production profile) or app.json > extra.socketUrl.',
  );
}

let socket: Socket | null = null;

// Subscribers notified whenever the singleton socket instance is swapped
// (created on auth/connect, cleared on teardown). Screens that bind their own
// listeners to the singleton use this to re-bind onto the fresh instance after a
// reconnect instead of holding a dead reference. See useChatSocketInstance.
const socketSubscribers = new Set<() => void>();

function setSocket(next: Socket | null): void {
  socket = next;
  for (const cb of socketSubscribers) cb();
}

/**
 * Shape of the `message:read` event emitted by the gateway.
 * `lastReadAt` is the ISO-8601 timestamp the server wrote to ConversationMember
 * at the moment of marking — the chat screen uses it to upgrade messages whose
 * createdAt <= lastReadAt from ✓ (sent) to ✓✓ (read).
 */
export interface MessageReadPayload {
  conversationId: string;
  userId: string;
  lastReadAt: string;   // ISO-8601
}

export function useChatSocket(
  handlers?: {
    onMessage?: (payload: unknown) => void;
    onMessageRead?: (payload: MessageReadPayload) => void;
    onTypingStart?: (payload: { conversationId: string; userId: string }) => void;
    onTypingStop?: (payload: { conversationId: string; userId: string }) => void;
    onUserOnline?: (payload: { userId: string }) => void;
    onUserOffline?: (payload: { userId: string }) => void;
    onConversationUpdated?: (payload: { conversationId: string }) => void;
  },
): Socket | null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    let s: Socket | null = null;

    (async () => {
      const token = await tokenStore.getAccess();
      if (!active || !token) return;
      s = io(`${SOCKET_URL}/chat`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
      });
      setSocket(s);

      s.on('message:new', (payload) => handlersRef.current?.onMessage?.(payload));
      // message:read fires when ANY member of a conversation marks it read.
      // The payload now includes `lastReadAt` so senders can derive ✓✓ state.
      s.on('message:read', (payload: MessageReadPayload) =>
        handlersRef.current?.onMessageRead?.(payload),
      );
      s.on('typing:start', (payload) => handlersRef.current?.onTypingStart?.(payload));
      s.on('typing:stop', (payload) => handlersRef.current?.onTypingStop?.(payload));
      s.on('user:online', (payload) => handlersRef.current?.onUserOnline?.(payload));
      s.on('user:offline', (payload) => handlersRef.current?.onUserOffline?.(payload));
      s.on('conversation:updated', (payload) =>
        handlersRef.current?.onConversationUpdated?.(payload),
      );

      const heartbeat = setInterval(() => s?.emit('heartbeat'), 30_000);
      s.on('disconnect', () => clearInterval(heartbeat));
    })();

    return () => {
      active = false;
      s?.disconnect();
      setSocket(null);
    };
  }, [isAuthenticated]);

  return socket;
}

export function getChatSocket(): Socket | null {
  return socket;
}

/**
 * Reactive accessor for the singleton chat socket. Re-renders the caller
 * whenever the underlying instance is swapped (e.g. after the connection is
 * torn down and re-created), so effects that bind listeners onto the socket can
 * depend on the returned value and re-subscribe onto the live instance instead
 * of a stale one.
 */
export function useChatSocketInstance(): Socket | null {
  const [current, setCurrent] = useState<Socket | null>(socket);
  useEffect(() => {
    const cb = () => setCurrent(socket);
    socketSubscribers.add(cb);
    // Sync once in case the instance changed between render and subscribe.
    cb();
    return () => {
      socketSubscribers.delete(cb);
    };
  }, []);
  return current;
}
