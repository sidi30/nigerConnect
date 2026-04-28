import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicUser } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';
import { chatApi } from '@/services/chatApi';
import { friendsApi } from '@/services/friendsApi';

export default function NewChatScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const friendsQuery = useQuery({
    queryKey: ['friends', 'list'],
    queryFn: () => friendsApi.list(),
  });

  const createMut = useMutation({
    mutationFn: (friendId: string) => chatApi.createConversation([friendId]),
    onSuccess: (convo) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      router.replace(`/chat/${convo.id}`);
    },
  });

  const friends = friendsQuery.data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => {
      const name = (f.displayName ?? `${f.firstName ?? ''} ${f.lastName ?? ''}`).toLowerCase();
      return name.includes(q);
    });
  }, [friends, search]);

  function renderItem({ item }: { item: PublicUser }) {
    const name =
      item.displayName ?? `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim() ?? 'Contact';
    return (
      <Pressable
        onPress={() => createMut.mutate(item.id)}
        style={styles.row}
        android_ripple={{ color: Colors.tan100 }}
        disabled={createMut.isPending}
      >
        <Avatar uri={item.avatarUrl} name={name} size={48} borderColor={colorForId(item.id)} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {item.identityStatus === 'approved' && <VerifiedBadge size={12} />}
          </View>
          {item.city || item.countryCode ? (
            <Text style={styles.meta} numberOfLines={1}>
              {[item.city, item.countryCode].filter(Boolean).join(', ')}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>‹ Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouveau message</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher un contact…"
          placeholderTextColor={Colors.tan400}
          style={styles.searchInput}
          autoFocus
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={10}>
            <Text style={{ fontSize: 14, color: Colors.tan500 }}>✕</Text>
          </Pressable>
        )}
      </View>

      {friendsQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.orange} />
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>👥</Text>
          <Text style={styles.emptyTitle}>Pas encore d&apos;amis</Text>
          <Text style={styles.emptyText}>
            Ajoute des amis pour pouvoir leur envoyer un message.
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🔎</Text>
          <Text style={styles.emptyTitle}>Aucun résultat</Text>
          <Text style={styles.emptyText}>Essaie un autre nom.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: Spacing.sm }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {createMut.isPending && (
        <View style={styles.overlay}>
          <ActivityIndicator color={Colors.orange} />
        </View>
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  cancel: { fontSize: Typography.sizes.md, color: Colors.brown, width: 80, fontWeight: '600' },
  title: {
    fontSize: Typography.sizes.lg,
    fontWeight: '700',
    color: Colors.brown,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.brown, padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  meta: { fontSize: Typography.sizes.sm, color: Colors.tan500, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  emptyEmoji: { fontSize: 40, marginBottom: Spacing.md },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: 4,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
