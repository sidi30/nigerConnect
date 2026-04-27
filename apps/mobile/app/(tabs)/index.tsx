import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Post } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { StoriesRow } from '@/components/feed/StoriesRow';
import { FriendRequestsBanner } from '@/components/feed/FriendRequestsBanner';
import { PostCard } from '@/components/feed/PostCard';
import { ReportSheet } from '@/components/ReportSheet';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { feedApi } from '@/services/feedApi';
import { friendsApi } from '@/services/friendsApi';
import { notificationApi } from '@/services/notificationApi';
import { useAuthStore } from '@/stores/authStore';

export default function FeedTab() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [reportingId, setReportingId] = useState<string | null>(null);

  const feedQuery = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => feedApi.getFeed({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const storiesQuery = useQuery({
    queryKey: ['stories'],
    queryFn: () => feedApi.stories(),
  });

  const requestsQuery = useQuery({
    queryKey: ['friends', 'incoming'],
    queryFn: () => friendsApi.incoming(),
  });

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationApi.unreadCount(),
    refetchInterval: 30_000,
  });
  const unreadCount = unreadQuery.data ?? 0;

  const shareMut = useMutation({
    mutationFn: (postId: string) => feedApi.share(postId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feed'] });
      Alert.alert('Repartagé', 'Le post a été partagé avec tes amis.');
    },
    onError: (e) => {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })
        ?.response?.data?.message ?? (e as Error).message ?? 'Impossible de partager';
      Alert.alert('Échec du partage', msg);
    },
  });

  function confirmShare(postId: string): void {
    Alert.alert(
      'Repartager ce post ?',
      'Tes amis le verront sur leur fil.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Repartager', onPress: () => shareMut.mutate(postId) },
      ],
    );
  }

  const deleteMut = useMutation({
    mutationFn: (postId: string) => feedApi.deletePost(postId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feed'] }),
  });

  const likeMut = useMutation({
    mutationFn: (postId: string) => feedApi.toggleLike(postId),
    // Optimistic: flip the like on the cached feed pages immediately
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: ['feed'] });
      const prev = qc.getQueryData(['feed']);
      qc.setQueryData(['feed'], (old: unknown) => {
        const typed = old as { pages: Array<{ items: Post[] }> } | undefined;
        if (!typed) return old;
        return {
          ...typed,
          pages: typed.pages.map((page) => ({
            ...page,
            items: page.items.map((p) =>
              p.id === postId
                ? {
                    ...p,
                    isLikedByMe: !p.isLikedByMe,
                    likeCount: p.likeCount + (p.isLikedByMe ? -1 : 1),
                  }
                : p,
            ),
          })),
        };
      });
      return { prev };
    },
    onError: (_e, _postId, ctx) => {
      if (ctx?.prev) qc.setQueryData(['feed'], ctx.prev);
    },
    // Re-sync with the server so the cached counter matches DB truth.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const acceptMut = useMutation({
    mutationFn: (friendshipId: string) => friendsApi.accept(friendshipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
  const declineMut = useMutation({
    mutationFn: (friendshipId: string) => friendsApi.decline(friendshipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });

  const posts: Post[] = feedQuery.data?.pages.flatMap((p) => p.items) ?? [];

  const handleLike = useCallback(
    (id: string) => {
      likeMut.mutate(id);
    },
    [likeMut],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.flag}>🇳🇪</Text>
          <Text style={styles.brand}>
            Niger<Text style={styles.brandAccent}>Connect</Text>
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconBtn}
            hitSlop={8}
            onPress={() => router.push('/settings/notifications' as never)}
          >
            <Text style={styles.iconText}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/profile')} hitSlop={6}>
            <Avatar
              uri={user?.avatarUrl}
              name={user?.displayName ?? user?.firstName ?? 'N'}
              size={34}
              borderColor={Colors.orange}
            />
          </Pressable>
        </View>
      </View>

      <Pressable style={styles.fab} onPress={() => router.push('/post/new')}>
        <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
        <Text style={styles.fabIcon}>✍️</Text>
      </Pressable>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            currentUserId={user?.id}
            onLike={handleLike}
            onComment={(id) => router.push(`/post/${id}`)}
            onShare={confirmShare}
            onEdit={(id) => router.push(`/post/edit/${id}` as never)}
            onDelete={(id) => deleteMut.mutate(id)}
            onReport={(id) => setReportingId(id)}
            onPhotoPress={(photos, index) =>
              router.push({
                pathname: '/photos/viewer',
                params: { photos: JSON.stringify(photos), index: String(index) },
              } as never)
            }
          />
        )}
        ListHeaderComponent={
          <View>
            {user && !user.emailVerified ? (
              <Pressable
                onPress={() => router.push('/verify-email' as never)}
                style={styles.verifyBanner}
              >
                <Text style={styles.verifyIcon}>📧</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.verifyTitle}>Vérifie ton email</Text>
                  <Text style={styles.verifyText} numberOfLines={2}>
                    Confirme {user.email} pour profiter de toutes les fonctionnalités.
                  </Text>
                </View>
                <Text style={styles.verifyChevron}>›</Text>
              </Pressable>
            ) : null}
            <StoriesRow
              storyGroups={storiesQuery.data ?? []}
              onCreate={() => router.push('/stories/new' as never)}
              onOpen={(authorId) => router.push(`/stories/${authorId}` as never)}
            />
            <FriendRequestsBanner
              requests={requestsQuery.data ?? []}
              onAccept={(id) => acceptMut.mutate(id)}
              onDecline={(id) => declineMut.mutate(id)}
            />
          </View>
        }
        ListEmptyComponent={
          feedQuery.isLoading ? (
            <View style={styles.loader}>
              <ActivityIndicator color={Colors.orange} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📰</Text>
              <Text style={styles.emptyTitle}>Fil vide</Text>
              <Text style={styles.emptyText}>
                Ajoute des amis pour voir leurs publications ici.
              </Text>
            </View>
          )
        }
        onEndReached={() => feedQuery.hasNextPage && feedQuery.fetchNextPage()}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={feedQuery.isRefetching}
            onRefresh={() => {
              void feedQuery.refetch();
              void storiesQuery.refetch();
              void requestsQuery.refetch();
            }}
            tintColor={Colors.orange}
          />
        }
        contentContainerStyle={{ paddingBottom: Spacing.xl }}
      />
      <ReportSheet
        visible={reportingId !== null}
        targetType="post"
        targetId={reportingId ?? ''}
        onClose={() => setReportingId(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
    backgroundColor: 'rgba(253,251,247,0.96)',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flag: { fontSize: 22 },
  brand: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
  },
  brandAccent: { color: Colors.orange },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconText: { fontSize: 16 },
  notifBadge: {
    position: 'absolute',
    top: -3,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },
  notifBadgeText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '800',
  },
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
  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  fabIcon: { fontSize: 22 },
  verifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: '#FFF4E0',
    borderWidth: 1,
    borderColor: '#F4D8A8',
  },
  verifyIcon: { fontSize: 22 },
  verifyTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 2,
  },
  verifyText: {
    fontSize: Typography.sizes.xs + 1,
    color: Colors.tan500,
    lineHeight: 17,
  },
  verifyChevron: {
    fontSize: 22,
    color: Colors.orange,
    fontWeight: '600',
  },
});
