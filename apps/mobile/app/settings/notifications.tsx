import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '@/services/notificationApi';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { Loader } from '@/components/ui/Loader';
import { relativeTime } from '@/constants/lookups';

const TYPE_LABELS: Record<string, { emoji: string; color: string }> = {
  friend_request: { emoji: '👋', color: Colors.orange },
  friend_accepted: { emoji: '🤝', color: Colors.green },
  like: { emoji: '❤️', color: Colors.danger },
  comment: { emoji: '💬', color: Colors.info },
  message: { emoji: '✉️', color: Colors.orange },
  service_response: { emoji: '🤝', color: Colors.orange },
  association_invite: { emoji: '🏛️', color: Colors.info },
  identity_approved: { emoji: '✓', color: Colors.green },
  identity_rejected: { emoji: '✕', color: Colors.danger },
  system: { emoji: '📢', color: Colors.tan500 },
};

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationApi.list(),
  });
  const markAllMut = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (isLoading) {
    return <Loader />;
  }

  const notifs = data?.items ?? [];
  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <View style={{ flex: 1 }}>
      {unreadCount > 0 && (
        <Pressable onPress={() => markAllMut.mutate()} style={styles.markAll}>
          <Text style={styles.markAllLabel}>Tout marquer comme lu ({unreadCount})</Text>
        </Pressable>
      )}
      <ScrollView contentContainerStyle={styles.scroll}>
        {notifs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔔</Text>
            <Text style={styles.emptyTitle}>Aucune notification</Text>
            <Text style={styles.emptyText}>Les nouvelles activités apparaîtront ici.</Text>
          </View>
        ) : (
          notifs.map((n) => {
            const t = TYPE_LABELS[n.type] ?? TYPE_LABELS['system']!;
            return (
              <Pressable
                key={n.id}
                onPress={() => !n.read && markReadMut.mutate(n.id)}
                style={[styles.item, !n.read && styles.itemUnread]}
              >
                <View style={[styles.iconCircle, { backgroundColor: t.color + '22' }]}>
                  <Text style={styles.icon}>{t.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {n.title}
                  </Text>
                  {n.body ? (
                    <Text style={styles.body} numberOfLines={2}>
                      {n.body}
                    </Text>
                  ) : null}
                  <Text style={styles.time}>{relativeTime(n.createdAt)}</Text>
                </View>
                {!n.read && <View style={styles.unreadDot} />}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  markAll: {
    padding: Spacing.md,
    backgroundColor: Colors.peach50,
    alignItems: 'center',
  },
  markAllLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  scroll: { padding: Spacing.md, gap: 8 },
  empty: { padding: Spacing.xxxl, alignItems: 'center' },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.md },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: { fontSize: Typography.sizes.sm, color: Colors.tan500, marginTop: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  itemUnread: { backgroundColor: Colors.peach50, borderColor: Colors.peach100 },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 18 },
  title: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  body: { fontSize: Typography.sizes.xs + 1, color: Colors.tan600, marginTop: 2 },
  time: { fontSize: Typography.sizes.xxs, color: Colors.tan400, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange },
});
