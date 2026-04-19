import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { chatApi } from '@/services/chatApi';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { useChatSocket } from '@/hooks/useSocket';

export default function MessagesTab() {
  const router = useRouter();
  const query = useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: ({ pageParam }) => chatApi.listConversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  useChatSocket({
    onConversationUpdated: () => query.refetch(),
  });

  const conversations = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/chat/${item.id}`)}>
            <Avatar uri={item.avatarUrl} name={item.name} size={52} />
            <View style={{ flex: 1, marginLeft: Spacing.md }}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name ?? 'Conversation'}
              </Text>
              <Text style={styles.preview} numberOfLines={1}>
                {item.lastMessagePreview ?? 'Aucun message'}
              </Text>
            </View>
            {item.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount}</Text>
              </View>
            )}
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        refreshing={query.isRefetching}
        onRefresh={() => query.refetch()}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.white,
  },
  name: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  preview: { fontSize: Typography.sizes.sm, color: Colors.gray500, marginTop: 2 },
  sep: { height: 1, backgroundColor: Colors.gray100, marginLeft: 72 },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: Radii.full,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: Colors.white, fontSize: Typography.sizes.xs, fontWeight: '700' },
});
