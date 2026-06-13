import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { friendsApi } from '@/services/friendsApi';
import { profileApi } from '@/services/profileApi';
import { Colors, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId, relativeTime } from '@/constants/lookups';

type Tab = 'friends' | 'received' | 'sent' | 'suggestions' | 'search';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'search', label: 'Rechercher' },
  { id: 'friends', label: 'Amis' },
  { id: 'received', label: 'Reçues' },
  { id: 'sent', label: 'Envoyées' },
  { id: 'suggestions', label: 'Suggestions' },
];

export default function FriendsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('friends');

  const friendsQuery = useQuery({
    queryKey: ['friends', 'list'],
    queryFn: () => friendsApi.list(),
  });
  const incomingQuery = useQuery({
    queryKey: ['friends', 'incoming'],
    queryFn: () => friendsApi.incoming(),
  });
  const outgoingQuery = useQuery({
    queryKey: ['friends', 'outgoing'],
    queryFn: () => friendsApi.outgoing(),
  });
  const suggestionsQuery = useQuery({
    queryKey: ['friends', 'suggestions'],
    queryFn: () => friendsApi.suggestions(),
    enabled: tab === 'suggestions',
  });

  const [searchQ, setSearchQ] = useState('');
  // Trim + require at least 2 chars to avoid hammering the API on each keystroke.
  // 250ms debounce to keep typing responsive.
  const debouncedQ = useDebouncedValue(searchQ.trim(), 250);
  const searchQuery = useQuery({
    queryKey: ['profile', 'search', debouncedQ],
    queryFn: () => profileApi.search({ q: debouncedQ, limit: 30 }),
    enabled: tab === 'search' && debouncedQ.length >= 2,
    // Search results barely change minute-to-minute — keep them fresh for 5 min
    // so re-typing or revisiting a recent query serves the cache instead of
    // re-hitting /profile/search.
    staleTime: 5 * 60 * 1000,
  });

  const acceptMut = useMutation({
    mutationFn: (id: string) => friendsApi.accept(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
  const declineMut = useMutation({
    mutationFn: (id: string) => friendsApi.decline(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
  const sendRequestMut = useMutation({
    mutationFn: (userId: string) => friendsApi.sendRequest(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
  const removeFriendMut = useMutation({
    mutationFn: (userId: string) => friendsApi.remove(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });

  const counts: Record<Tab, number> = {
    friends: friendsQuery.data?.items.length ?? 0,
    received: incomingQuery.data?.length ?? 0,
    sent: outgoingQuery.data?.length ?? 0,
    suggestions: suggestionsQuery.data?.length ?? 0,
    // The search tab doesn't show a count badge — its content is the input.
    search: 0,
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Amis & Communauté</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.id;
          const count = counts[t.id];
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
                {count > 0 ? ` ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'friends' && (
        <FlatList
          data={friendsQuery.data?.items ?? []}
          keyExtractor={(u) => u.id}
          refreshing={friendsQuery.isRefetching}
          onRefresh={() => void friendsQuery.refetch()}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/user/${item.id}`)}
              style={styles.row}
            >
              <Avatar
                uri={item.avatarUrl}
                name={item.displayName ?? 'N'}
                size={48}
                borderColor={colorForId(item.id)}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.displayName ??
                      `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim()}
                  </Text>
                  {item.identityStatus === 'approved' && <VerifiedBadge size={12} />}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {Flags[item.countryCode ?? ''] ?? ''} {item.city ?? ''}
                </Text>
              </View>
              <Pressable
                onPress={() => removeFriendMut.mutate(item.id)}
                style={styles.ghostBtn}
                hitSlop={8}
              >
                <Text style={styles.ghostLabel}>Retirer</Text>
              </Pressable>
            </Pressable>
          )}
          ListEmptyComponent={
            friendsQuery.isLoading ? (
              <Loader />
            ) : (
              <Empty icon="users" title="Aucun ami" subtitle="Accepte les demandes ou envoie-en." />
            )
          }
        />
      )}

      {tab === 'received' && (
        <FlatList
          data={incomingQuery.data ?? []}
          keyExtractor={(r) => r.id}
          refreshing={incomingQuery.isRefetching}
          onRefresh={() => void incomingQuery.refetch()}
          renderItem={({ item }) => {
            const u = item.requester;
            return (
              <View style={styles.row}>
                <Pressable
                  onPress={() => router.push(`/user/${u.id}`)}
                  style={styles.userBlock}
                  hitSlop={4}
                >
                  <Avatar uri={u.avatarUrl} name={u.displayName ?? 'N'} size={48} borderColor={colorForId(u.id)} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()}
                    </Text>
                    <Text style={styles.meta}>
                      {Flags[u.countryCode ?? ''] ?? ''} {u.city ?? ''} · {relativeTime(item.createdAt)}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => acceptMut.mutate(item.id)}
                >
                  <Text style={styles.primaryLabel}>Accepter</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => declineMut.mutate(item.id)}
                >
                  <Feather name="x" size={18} color={Colors.tan600} />
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            incomingQuery.isLoading ? (
              <Loader />
            ) : (
              <Empty icon="inbox" title="Aucune demande" subtitle="Tu n'as pas de demande en attente." />
            )
          }
        />
      )}

      {tab === 'sent' && (
        <FlatList
          data={outgoingQuery.data ?? []}
          keyExtractor={(r) => r.id}
          refreshing={outgoingQuery.isRefetching}
          onRefresh={() => void outgoingQuery.refetch()}
          renderItem={({ item }) => {
            const u = item.addressee!;
            return (
              <Pressable
                onPress={() => router.push(`/user/${u.id}`)}
                style={styles.row}
              >
                <Avatar uri={u.avatarUrl} name={u.displayName ?? 'N'} size={48} borderColor={colorForId(u.id)} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()}
                  </Text>
                  <Text style={styles.meta}>
                    En attente · {relativeTime(item.createdAt)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            outgoingQuery.isLoading ? (
              <Loader />
            ) : (
              <Empty icon="send" title="Aucune demande envoyée" />
            )
          }
        />
      )}

      {tab === 'search' && (
        <View style={{ flex: 1 }}>
          <View style={styles.searchWrap}>
            <Feather name="search" size={16} color={Colors.tan400} />
            <TextInput
              value={searchQ}
              onChangeText={setSearchQ}
              placeholder="Nom, prénom, ou pseudo…"
              placeholderTextColor={Colors.tan400}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQ.length > 0 && (
              <Pressable onPress={() => setSearchQ('')} hitSlop={10}>
                <Feather name="x" size={16} color={Colors.tan500} />
              </Pressable>
            )}
          </View>
          {debouncedQ.length < 2 ? (
            <Empty
              icon="search"
              title="Tape au moins 2 lettres"
              subtitle="Cherche par prénom, nom ou pseudo."
            />
          ) : searchQuery.isLoading ? (
            <Loader />
          ) : (
            <FlatList
              data={searchQuery.data?.items ?? []}
              keyExtractor={(u) => u.id}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Pressable
                    onPress={() => router.push(`/user/${item.id}`)}
                    style={styles.userBlock}
                    hitSlop={4}
                  >
                    <Avatar
                      uri={item.avatarUrl}
                      name={item.displayName ?? 'N'}
                      size={48}
                      borderColor={colorForId(item.id)}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={1}>
                          {item.displayName ??
                            `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim()}
                        </Text>
                        {item.identityStatus === 'approved' && <VerifiedBadge size={12} />}
                      </View>
                      <Text style={styles.meta} numberOfLines={1}>
                        {Flags[item.countryCode ?? ''] ?? ''} {item.city ?? ''}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.primaryBtn}
                    onPress={() => sendRequestMut.mutate(item.id)}
                  >
                    <Text style={styles.primaryLabel}>+ Ajouter</Text>
                  </Pressable>
                </View>
              )}
              ListEmptyComponent={
                <Empty icon="user-x" title="Aucun résultat" subtitle="Essaie un autre nom." />
              }
            />
          )}
        </View>
      )}

      {tab === 'suggestions' && (
        <FlatList
          data={suggestionsQuery.data ?? []}
          keyExtractor={(s) => s.user.id}
          refreshing={suggestionsQuery.isRefetching}
          onRefresh={() => void suggestionsQuery.refetch()}
          renderItem={({ item }) => {
            const u = item.user;
            return (
              <View style={styles.row}>
                <Pressable
                  onPress={() => router.push(`/user/${u.id}`)}
                  style={styles.userBlock}
                  hitSlop={4}
                >
                  <Avatar uri={u.avatarUrl} name={u.displayName ?? 'N'} size={48} borderColor={colorForId(u.id)} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {Flags[u.countryCode ?? ''] ?? ''} {u.city ?? ''}
                      {item.mutualFriends > 0 ? ` · ${item.mutualFriends} en commun` : ''}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => sendRequestMut.mutate(u.id)}
                >
                  <Text style={styles.primaryLabel}>+ Ajouter</Text>
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            suggestionsQuery.isLoading ? (
              <Loader />
            ) : (
              <Empty icon="star" title="Pas de suggestions" subtitle="Reviens plus tard." />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function Empty({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={48} color={Colors.tan300} style={styles.emptyIcon} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={styles.emptyText}>{subtitle}</Text>}
    </View>
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
  back: { fontSize: 26, color: Colors.brown, width: 34 },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radii.md,
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  tabActive: { backgroundColor: Colors.brown, borderColor: Colors.brown },
  tabLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.tan600 },
  tabLabelActive: { color: Colors.white },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  userBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  name: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  meta: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  primaryBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.orange,
  },
  primaryLabel: { color: Colors.white, fontSize: Typography.sizes.xs + 1, fontWeight: '700' },
  secondaryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
  },
  ghostBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
  },
  ghostLabel: { color: Colors.tan600, fontSize: Typography.sizes.xs + 1, fontWeight: '700' },
  empty: { padding: Spacing.xxxl, alignItems: 'center' },
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
  searchInput: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
    padding: 0,
  },
  emptyIcon: { marginBottom: Spacing.md },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: 4,
  },
});
