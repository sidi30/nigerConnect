import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { PublicUser } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { BadgeGroup, selectPersonBadges } from '@/components/ui/Badge';
import { profileApi } from '@/services/profileApi';
import { Colors, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';

/**
 * Paginated "all friends of X" screen. Reachable from the "Voir tout" link on
 * a third-party profile — the profile header only shows a ~10-item preview.
 */
export default function UserFriendsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const friendsQuery = useInfiniteQuery({
    queryKey: ['user', id, 'friends', 'all'],
    queryFn: ({ pageParam }) => profileApi.getFriendsOf(id!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id,
    retry: 0,
  });

  const friends: PublicUser[] = friendsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  // The list endpoint 404s/403s when the target's friend list isn't visible
  // to the viewer (private/friends-only profile, non-friend) — same gating as
  // the preview on the profile screen.
  const gated = friendsQuery.isError;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Feather name="arrow-left" size={22} color={Colors.brown} />
        </Pressable>
        <Text style={styles.title}>Amis</Text>
        <View style={{ width: 40 }} />
      </View>

      {gated ? (
        <View style={styles.empty}>
          <Feather name="lock" size={40} color={Colors.tan300} style={{ marginBottom: Spacing.md }} />
          <Text style={styles.emptyTitle}>Liste non visible</Text>
          <Text style={styles.emptyText}>
            Ce profil est privé ou réservé aux amis : la liste complète n&apos;est pas accessible.
          </Text>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingBottom: Spacing.xl }}
          onEndReached={() => friendsQuery.hasNextPage && friendsQuery.fetchNextPage()}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/user/${item.id}`)} style={styles.row}>
              <Avatar
                uri={item.avatarUrl}
                name={item.displayName ?? item.firstName ?? 'N'}
                size={48}
                borderColor={colorForId(item.id)}
                recyclingKey={item.id}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.displayName ?? `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim()}
                  </Text>
                  <BadgeGroup kinds={selectPersonBadges(item)} size={12} />
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {Flags[item.countryCode ?? ''] ?? ''} {item.city ?? ''}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            friendsQuery.isLoading ? (
              <Loader />
            ) : (
              <View style={styles.empty}>
                <Feather name="users" size={40} color={Colors.tan300} style={{ marginBottom: Spacing.md }} />
                <Text style={styles.emptyTitle}>Aucun ami visible</Text>
              </View>
            )
          }
          ListFooterComponent={
            friendsQuery.isFetchingNextPage ? <Loader size="small" /> : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  name: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  meta: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxxl,
  },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: 4,
  },
});
