import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId, relativeTime } from '@/constants/lookups';
import { chatApi } from '@/services/chatApi';
import { friendsApi } from '@/services/friendsApi';
import { useAuthStore } from '@/stores/authStore';

export default function MessagesTab() {
  const router = useRouter();
  const me = useAuthStore((s) => s.user);

  const convoQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => chatApi.listConversations(),
  });
  const friendsQuery = useQuery({
    queryKey: ['friends', 'list'],
    queryFn: () => friendsApi.list(),
  });

  const conversations = convoQuery.data?.items ?? [];
  const friends = friendsQuery.data?.items ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>💬 Messages</Text>
        <Pressable style={styles.composeBtn} hitSlop={8}>
          <Text style={styles.composeIcon}>✏️</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: Spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={convoQuery.isRefetching}
            onRefresh={() => {
              void convoQuery.refetch();
              void friendsQuery.refetch();
            }}
            tintColor={Colors.orange}
          />
        }
      >
        {friends.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.onlineStrip}
            contentContainerStyle={styles.onlineStripContent}
          >
            {friends.slice(0, 12).map((f) => (
              <Pressable
                key={f.id}
                onPress={() => router.push(`/user/${f.id}`)}
                style={styles.onlineItem}
              >
                <Avatar
                  uri={f.avatarUrl}
                  name={f.displayName ?? f.firstName ?? 'N'}
                  size={48}
                  borderColor={colorForId(f.id)}
                />
                <Text style={styles.onlineName} numberOfLines={1}>
                  {(f.displayName ?? f.firstName ?? '').split(' ')[0]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {convoQuery.isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={Colors.orange} />
          </View>
        ) : conversations.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyTitle}>Aucune conversation</Text>
            <Text style={styles.emptyText}>
              Ouvre le profil d&apos;un ami et envoie-lui le premier message.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {conversations.map((c) => {
              const peer = c.members.find((m) => m.id !== me?.id) ?? c.members[0];
              if (!peer) return null;
              const title =
                c.name ??
                peer.displayName ??
                `${peer.firstName ?? ''} ${peer.lastName ?? ''}`.trim() ??
                'Conversation';
              const avatar = c.avatarUrl ?? peer.avatarUrl ?? null;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/chat/${c.id}`)}
                  style={styles.row}
                  android_ripple={{ color: Colors.tan100 }}
                >
                  <Avatar uri={avatar} name={title} size={50} borderColor={colorForId(peer.id)} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.rowTop}>
                      <View style={styles.nameRow}>
                        <Text
                          style={[styles.name, c.unreadCount > 0 && { fontWeight: '800' }]}
                          numberOfLines={1}
                        >
                          {title}
                        </Text>
                        {peer.identityStatus === 'approved' && <VerifiedBadge size={12} />}
                      </View>
                      <Text
                        style={[
                          styles.time,
                          c.unreadCount > 0 && { color: Colors.orange, fontWeight: '700' },
                        ]}
                      >
                        {relativeTime(c.lastMessageAt)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.preview,
                        c.unreadCount > 0 && { color: Colors.brown, fontWeight: '600' },
                      ]}
                      numberOfLines={1}
                    >
                      {c.lastMessagePreview ?? 'Pas encore de message'}
                    </Text>
                  </View>
                  {c.unreadCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{c.unreadCount}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
    backgroundColor: 'rgba(253,251,247,0.96)',
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
  },
  composeBtn: {
    width: 34,
    height: 34,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeIcon: { fontSize: 15 },
  onlineStrip: { borderBottomWidth: 1, borderBottomColor: Colors.tan200 },
  onlineStripContent: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.lg,
  },
  onlineItem: { alignItems: 'center', width: 56 },
  onlineName: {
    fontSize: Typography.sizes.xxs,
    marginTop: 4,
    fontWeight: '600',
    color: Colors.tan600,
    maxWidth: 54,
  },
  list: { paddingHorizontal: Spacing.sm + 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.md,
    borderRadius: Radii.md,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  name: { fontSize: Typography.sizes.md, color: Colors.brown, fontWeight: '600' },
  time: { fontSize: Typography.sizes.xs, color: Colors.tan400 },
  preview: { fontSize: Typography.sizes.sm, color: Colors.tan500, marginTop: 2 },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: Colors.white, fontSize: Typography.sizes.xs, fontWeight: '800' },
  loader: { padding: Spacing.xxl, alignItems: 'center' },
  empty: { padding: Spacing.xxl, alignItems: 'center' },
  emptyEmoji: { fontSize: 40, marginBottom: Spacing.md },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: 4,
  },
});
