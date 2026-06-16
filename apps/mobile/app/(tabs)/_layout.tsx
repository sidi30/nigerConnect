import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Colors, Radii, Typography } from '@/constants/theme';
import { chatApi } from '@/services/chatApi';
import { useChatSocket } from '@/hooks/useSocket';
import { useProximityAlerts } from '@/hooks/useProximityAlerts';
import { InAppNotification } from '@/components/ui/InAppNotification';
import { useInAppNotificationStore } from '@/stores/inAppNotificationStore';
import { useAuthStore } from '@/stores/authStore';
import type { Message } from '@nigerconnect/shared-types';

function TabIcon({
  name,
  color,
  focused,
  badge,
}: {
  name: keyof typeof Feather.glyphMap;
  color: string;
  focused: boolean;
  badge?: number;
}) {
  return (
    <View style={styles.iconWrap}>
      <Feather name={name} size={23} color={color} style={!focused && { opacity: 0.9 }} />
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const TAB_BAR_CONTENT_HEIGHT = 60;

/**
 * Returns the conversationId of the conversation the user is currently viewing,
 * or null if they are not on a chat screen.  Used to suppress in-app banners
 * when the user already sees the conversation that triggered the notification.
 *
 * We use `usePathname()` (returns e.g. "/chat/abc-123") rather than
 * `useSegments()` to avoid fighting expo-router's typed tuple which is narrowed
 * to the tabs subtree and doesn't let us index [1].
 */
function useCurrentConversationId(): string | null {
  const pathname = usePathname();
  // pathname: e.g. "/chat/abc-123-def-456" or "/(tabs)/messages"
  const match = /^\/chat\/([^/]+)$/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const showNotification = useInAppNotificationStore((s) => s.show);
  const currentConversationId = useCurrentConversationId();
  // Keep a ref for use inside stable socket/push callbacks that are set up once.
  const currentConvIdRef = useRef(currentConversationId);
  currentConvIdRef.current = currentConversationId;
  // Same for our own user id: the socket callback is created once, so read `me`
  // through a ref to keep it stable while always seeing the latest value.
  const myId = useAuthStore((s) => s.user?.id);
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  const { data: convos } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => chatApi.listConversations(),
    refetchInterval: 30_000,
  });
  const unreadTotal = convos?.items.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0) ?? 0;

  // Global chat socket — opened once for the entire authenticated session.
  // Keeps the conversations list, individual chat screens, and the unread
  // badge in sync without waiting for the 30s poll. The chat screen used to
  // mount this hook itself; now it just relies on this global mount so we
  // don't end up with two competing connections.
  useChatSocket({
    onMessage: (payload) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });

      // Show in-app banner when a new message arrives for a conversation the
      // user is NOT currently viewing.  We cast loosely — the server always
      // sends a full Message object here but the generic handler types it as
      // `unknown` to keep the hook surface minimal.
      const msg = payload as (Message & { sender?: { id?: string; displayName?: string | null; firstName?: string | null } }) | null | undefined;
      if (!msg?.conversationId) return;
      // `message:new` echoes back to the sender too — never banner our own
      // outgoing messages.
      if (msg.sender?.id && msg.sender.id === myIdRef.current) return;
      if (msg.conversationId === currentConvIdRef.current) return;  // already viewing it

      const senderName =
        msg.sender?.displayName ??
        msg.sender?.firstName ??
        'Nouveau message';
      const preview =
        msg.content?.slice(0, 80) ??
        (msg.messageType === 'image' ? '📷 Photo' : '📎 Pièce jointe');

      showNotification({
        id: msg.id,
        title: senderName,
        body: preview,
        route: `/chat/${msg.conversationId}`,
        conversationId: msg.conversationId,
      });
    },
    onConversationUpdated: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Foreground Expo push notifications: when the app is open and a push arrives
  // (e.g. the user received a message on a different device, or a non-chat notif),
  // show the same in-app banner instead of the system overlay.
  // Navigation on *tap* is already handled by NotificationDeepLink in _layout.tsx
  // via addNotificationResponseReceivedListener — we only need to handle the
  // foreground *received* event here to surface the banner.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : undefined;

      // Suppress if the user is already viewing this conversation.
      if (conversationId && conversationId === currentConvIdRef.current) return;

      const title = notification.request.content.title ?? 'NigerConnect';
      const body = notification.request.content.body ?? '';

      showNotification({
        id: notification.request.identifier,
        title,
        body,
        route: conversationId ? `/chat/${conversationId}` : undefined,
        conversationId,
      });
    });

    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // stable: showNotification is from Zustand (stable ref), currentConvIdRef is a ref

  // Foreground-only proximity alerts. No-op unless the user has opted in; runs
  // a location watch + periodic backend ping while the app is foregrounded and
  // tears itself down on background. Mounted here (inside the authed tabs) so it
  // never runs before the user is loaded. No background location.
  useProximityAlerts();

  // Bottom padding sits above the device's reserved area (home indicator on
  // iPhone, gesture nav bar on Android). Fall back to 8px so older devices
  // without insets still get visual breathing room.
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.orange,
          tabBarInactiveTintColor: Colors.tan500,
          tabBarStyle: {
            backgroundColor: 'rgba(255,255,255,0.97)',
            borderTopColor: Colors.tan200,
            borderTopWidth: 1,
            height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
            paddingTop: 8,
            paddingBottom: bottomInset,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="map"
          options={{
            title: 'Carte',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name="map" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: 'Fil',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name="home" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="services"
          options={{
            title: 'Services',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name="briefcase" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Messages',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name="message-circle" color={color} focused={focused} badge={unreadTotal} />
            ),
          }}
        />
        <Tabs.Screen
          name="invite"
          options={{
            title: 'Inviter',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name="gift" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarIcon: ({ focused, color }) => (
              <TabIcon name="user" color={color} focused={focused} />
            ),
          }}
        />
      </Tabs>
      {/* In-app notification banner — rendered above the Tabs tree via
          absolute positioning so it floats over all tab screens without
          disrupting the layout flow. */}
      <InAppNotification />
    </>
  );
}

const styles = StyleSheet.create({
  iconWrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: Radii.full,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: Colors.white,
    fontSize: Typography.sizes.xxs - 1,
    fontWeight: '800',
  },
});
