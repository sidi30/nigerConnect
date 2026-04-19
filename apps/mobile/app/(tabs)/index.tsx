import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { feedApi } from '@/services/feedApi';
import { PostCard } from '@/components/PostCard';
import { Colors, Spacing, Typography } from '@/constants/theme';

export default function FeedTab() {
  const router = useRouter();
  const qc = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => feedApi.getFeed({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const posts = query.data?.pages.flatMap((p) => p.items) ?? [];

  const handleLike = useCallback(
    async (postId: string) => {
      await feedApi.toggleLike(postId).catch(() => null);
      await qc.invalidateQueries({ queryKey: ['feed'] });
    },
    [qc],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>NigerConnect</Text>
      </View>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onLike={handleLike}
            onOpenComments={(id) => router.push(`/post/${id}`)}
          />
        )}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
        }
        contentContainerStyle={posts.length === 0 && styles.emptyContainer}
        ListEmptyComponent={
          query.isLoading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Aucune publication encore. Commence par ajouter un ami !
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.gray100,
    backgroundColor: Colors.white,
  },
  title: { fontSize: Typography.sizes.xl, fontWeight: '700', color: Colors.orange },
  empty: { padding: Spacing.xxl, alignItems: 'center' },
  emptyText: { color: Colors.gray500, fontSize: Typography.sizes.md, textAlign: 'center' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
