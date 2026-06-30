import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { feedApi, type LikerUser } from '@/services/feedApi';
import { colorForId } from '@/constants/lookups';
import { Colors, palette, Radii, Spacing, Typography } from '@/constants/theme';

interface Props {
  postId: string;
  visible: boolean;
  onClose: () => void;
}

function fullName(u: LikerUser): string {
  return (
    u.displayName ?? (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Membre')
  );
}

/**
 * Instagram-style "liked by" bottom sheet. Lists the people who liked a post
 * (paginated), tap a row to open their profile. The backend already gates the
 * likers list by post visibility, so a private post can't be enumerated here.
 */
export function LikersSheet({ postId, visible, onClose }: Props) {
  const router = useRouter();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['post-likers', postId],
      queryFn: ({ pageParam }) => feedApi.getLikers(postId, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      enabled: visible,
    });

  const likers = data?.pages.flatMap((p) => p.items) ?? [];

  function openProfile(id: string) {
    onClose();
    router.push(`/user/${id}` as never);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Fermer la liste des j'aime"
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>J&apos;aime</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color={Colors.tan500} />
            </Pressable>
          </View>

          {isLoading ? (
            <Loader />
          ) : likers.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="heart" size={40} color={Colors.tan400} />
              <Text style={styles.emptyText}>Personne n&apos;a encore aimé.</Text>
            </View>
          ) : (
            <FlatList
              data={likers}
              keyExtractor={(u) => u.id}
              onEndReachedThreshold={0.5}
              onEndReached={() => {
                if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
              }}
              ListFooterComponent={
                isFetchingNextPage ? <Loader style={{ marginVertical: Spacing.md }} /> : null
              }
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => openProfile(item.id)}>
                  <Avatar
                    uri={item.avatarUrl}
                    name={fullName(item)}
                    size={44}
                    borderColor={colorForId(item.id)}
                  />
                  <Text style={styles.name} numberOfLines={1}>
                    {fullName(item)}
                  </Text>
                  <Feather name="chevron-right" size={18} color={Colors.tan400} />
                </Pressable>
              )}
              contentContainerStyle={styles.listContent}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.overlayMedium,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    maxHeight: '80%',
    minHeight: '40%',
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.tan300,
    alignSelf: 'center',
    marginTop: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  title: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.brown },
  listContent: { padding: Spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.xs,
  },
  name: { flex: 1, fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  empty: { padding: Spacing.xxxl, alignItems: 'center', gap: Spacing.sm },
  emptyText: { fontSize: Typography.sizes.sm, color: Colors.tan500 },
});
