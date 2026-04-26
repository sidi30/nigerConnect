import { useEffect, useRef } from 'react';
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

export function useChatSocket(
  handlers?: {
    onMessage?: (payload: unknown) => void;
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
      socket = s;

      s.on('message:new', (payload) => handlersRef.current?.onMessage?.(payload));
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
      socket = null;
    };
  }, [isAuthenticated]);

  return socket;
}

export function getChatSocket(): Socket | null {
  return socket;
}
