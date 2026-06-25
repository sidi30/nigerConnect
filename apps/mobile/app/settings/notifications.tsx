import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@nigerconnect/shared-types';
import { notificationApi } from '@/services/notificationApi';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { Loader } from '@/components/ui/Loader';
import { relativeTime } from '@/constants/lookups';

/**
 * Map a notification to the in-app screen it should open when tapped. Mirrors
 * the push deep-link logic in app/_layout.tsx (NotificationDeepLink), reading
 * the same `data` payload the backend sets on each notification. Returns null
 * when there's no meaningful destination (e.g. identity_*, system).
 */
function routeForNotification(n: Notification): string | null {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  switch (n.type) {
    case 'message': {
      const c = str('conversationId');
      return c ? `/chat/${c}` : null;
    }
    case 'friend_request':
    case 'friend_accepted':
      return '/friends';
    case 'like':
    case 'comment':
    case 'poll_new': {
      const p = str('postId');
      return p ? `/post/${p}` : null;
    }
    case 'association_invite':
    case 'association_join_request':
    case 'association_join_approved':
    case 'association_join_rejected': {
      const a = str('associationId');
      return a ? `/associations/${a}` : null;
    }
    case 'page_follow': {
      const p = str('pageId');
      return p ? `/pages/${p}` : null;
    }
    case 'review_received': {
      const t = str('targetId');
      return t ? (d.reviewTargetType === 'page' ? `/pages/${t}` : `/user/${t}`) : null;
    }
    case 'service_response': {
      const r = str('requestId');
      return r ? `/services/${r}` : null;
    }
    case 'proximity': {
      const u = str('userId');
      return u ? `/user/${u}` : null;
    }
    case 'invite_accepted': {
      // The backend sets actorId = the newly-joined member.
      const actor = str('actorId');
      return actor ? `/user/${actor}` : '/(tabs)/invite';
    }
    default:
      return null;
  }
}

const TYPE_LABELS: Record<string, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  friend_request: { icon: 'user-plus', color: Colors.orange },
  friend_accepted: { icon: 'user-check', color: Colors.green },
  like: { icon: 'heart', color: Colors.danger },
  comment: { icon: 'message-circle', color: Colors.info },
  message: { icon: 'mail', color: Colors.orange },
  service_response: { icon: 'briefcase', color: Colors.orange },
  association_invite: { icon: 'home', color: Colors.info },
  association_join_request: { icon: 'home', color: Colors.info },
  association_join_approved: { icon: 'check-circle', color: Colors.green },
  association_join_rejected: { icon: 'x-circle', color: Colors.danger },
  identity_approved: { icon: 'check-circle', color: Colors.green },
  identity_rejected: { icon: 'x-circle', color: Colors.danger },
  proximity: { icon: 'map-pin', color: Colors.info },
  page_follow: { icon: 'star', color: Colors.orange },
  poll_new: { icon: 'bar-chart-2', color: Colors.info },
  review_received: { icon: 'star', color: Colors.orange },
  invite_accepted: { icon: 'gift', color: Colors.green },
  system: { icon: 'volume-2', color: Colors.tan500 },
};

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationApi.list(),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
  };
  const markAllMut = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: invalidate,
  });
  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => notificationApi.remove(id),
    onSuccess: invalidate,
  });
  const clearAllMut = useMutation({
    mutationFn: () => notificationApi.clearAll(),
    onSuccess: invalidate,
  });

  function confirmClearAll() {
    Alert.alert('Tout effacer ?', 'Tout ton historique de notifications sera supprimé.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Tout effacer', style: 'destructive', onPress: () => clearAllMut.mutate() },
    ]);
  }

  if (isLoading) {
    return <Loader />;
  }

  const notifs = data?.items ?? [];
  const unreadCount = notifs.filter((n) => !n.read).length;

  return (
    <View style={{ flex: 1 }}>
      {notifs.length > 0 && (
        <View style={styles.toolbar}>
          {unreadCount > 0 ? (
            <Pressable onPress={() => markAllMut.mutate()} hitSlop={8}>
              <Text style={styles.toolbarAction}>Tout marquer lu ({unreadCount})</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Pressable onPress={confirmClearAll} hitSlop={8}>
            <Text style={[styles.toolbarAction, { color: Colors.danger }]}>Tout effacer</Text>
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.scroll}>
        {notifs.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="bell" size={44} color={Colors.tan400} style={styles.emptyEmoji} />
            <Text style={styles.emptyTitle}>Aucune notification</Text>
            <Text style={styles.emptyText}>Les nouvelles activités apparaîtront ici.</Text>
          </View>
        ) : (
          notifs.map((n) => {
            const t = TYPE_LABELS[n.type] ?? TYPE_LABELS['system']!;
            return (
              <Pressable
                key={n.id}
                onPress={() => {
                  if (!n.read) markReadMut.mutate(n.id);
                  const route = routeForNotification(n);
                  if (route) router.push(route as never);
                }}
                style={[styles.item, !n.read && styles.itemUnread]}
              >
                <View style={[styles.iconCircle, { backgroundColor: t.color + '22' }]}>
                  <Feather name={t.icon} size={18} color={t.color} />
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
                <Pressable
                  onPress={() => removeMut.mutate(n.id)}
                  hitSlop={10}
                  style={styles.deleteBtn}
                  accessibilityLabel="Supprimer la notification"
                >
                  <Feather name="x" size={14} color={Colors.tan600} />
                </Pressable>
              </Pressable>
            );
          })
        )}
        {notifs.length > 0 && (
          <Text style={styles.ttlNote}>
            Les notifications sont conservées 24 h, puis supprimées automatiquement.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    backgroundColor: Colors.peach50,
  },
  toolbarAction: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  scroll: { padding: Spacing.md, gap: 8 },
  deleteBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.tan100,
    marginLeft: 4,
  },
  ttlNote: {
    textAlign: 'center',
    color: Colors.tan400,
    fontSize: Typography.sizes.xxs,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  empty: { padding: Spacing.xxxl, alignItems: 'center' },
  emptyEmoji: { marginBottom: Spacing.md },
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
  title: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  body: { fontSize: Typography.sizes.xs + 1, color: Colors.tan600, marginTop: 2 },
  time: { fontSize: Typography.sizes.xxs, color: Colors.tan400, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange },
});
