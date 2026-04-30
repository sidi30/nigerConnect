import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors, Radii, Typography } from '@/constants/theme';
import { chatApi } from '@/services/chatApi';
import { useChatSocket } from '@/hooks/useSocket';

function TabIcon({
  emoji,
  focused,
  badge,
}: {
  emoji: string;
  focused: boolean;
  badge?: number;
}) {
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.emoji, !focused && { opacity: 0.45 }]}>{emoji}</Text>
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const TAB_BAR_CONTENT_HEIGHT = 60;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
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
    onMessage: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onConversationUpdated: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Bottom padding sits above the device's reserved area (home indicator on
  // iPhone, gesture nav bar on Android). Fall back to 8px so older devices
  // without insets still get visual breathing room.
  const bottomInset = Math.max(insets.bottom, 8);

  return (
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
          tabBarIcon: ({ focused }) => <TabIcon emoji="🌍" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Fil',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="services"
        options={{
          title: 'Services',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🤝" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="💬" focused={focused} badge={unreadTotal} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: { position: 'relative' },
  emoji: { fontSize: 22 },
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
