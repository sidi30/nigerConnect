import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CursorPage, Post, PublicUser, User } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { PostCard } from '@/components/feed/PostCard';
import { ReportSheet } from '@/components/ReportSheet';
import { profileApi } from '@/services/profileApi';
import { friendsApi } from '@/services/friendsApi';
import { blocksApi } from '@/services/blocksApi';
import { feedApi } from '@/services/feedApi';
import { chatApi } from '@/services/chatApi';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

type Relationship = 'self' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'none';

/**
 * Make profile-fetch errors actionable to the end user. The default React
 * Query / axios error message ("Network Error", "timeout of 15000ms exceeded")
 * is incomprehensible to a non-technical person. Map the most common cases to
 * a sentence the user can act on (or report).
 */
function describeProfileError(err: unknown): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string | string[] } };
  } | null;
  if (!e) return 'Vérifie ta connexion puis réessaie.';
  const status = e.response?.status;
  if (status === 404) return "Ce profil n'existe plus.";
  if (status === 403) return "Ce profil est privé.";
  if (status && status >= 500) return 'Le serveur ne répond pas correctement. Réessaie dans un instant.';
  const msg = e.message ?? '';
  if (/timeout/i.test(msg)) return 'Le serveur est lent à répondre. Vérifie ta connexion puis réessaie.';
  if (/network/i.test(msg)) return 'Pas de connexion. Vérifie ton Wi-Fi ou tes données mobiles.';
  return msg || 'Vérifie ta connexion puis réessaie.';
}

const RELATION_COPY: Record<Relationship, string> = {
  self: '',
  friends: '✓ Amis',
  outgoing: '⌛ Demande envoyée',
  incoming: '📩 Accepter la demande',
  blocked: '🚫 Bloqué',
  none: '👤 Ajouter en ami',
};

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  // Pre-populate from any other place we might already have this user — feed
  // cache (post.author), friends list, search results, conversation member.
  // The screen then paints instantly with whatever fields PublicUser gives,
  // and the network fetch upgrades it to the richer User shape in the bg.
  const userQuery = useQuery<User | PublicUser>({
    queryKey: ['user', id],
    queryFn: () => profileApi.getById(id!),
    enabled: !!id,
    placeholderData: (): PublicUser | undefined => {
      if (!id) return undefined;
      // 1. Feed cache: any post by this user has the author embedded.
      const feed = qc.getQueryData<{ pages: Array<{ items: Post[] }> }>(['feed']);
      const fromFeed = feed?.pages
        .flatMap((p) => p.items)
        .find((post) => post.author.id === id)?.author;
      if (fromFeed) return fromFeed;
      // 2. Friends list (current user's friends).
      const friendsList = qc.getQueryData<CursorPage<PublicUser>>(['friends', 'list']);
      const fromFriends = friendsList?.items.find((u) => u.id === id);
      if (fromFriends) return fromFriends;
      // 3. Search results cache — the user may have just clicked a hit on the
      //    map page. Without this, the screen has nothing to paint until the
      //    network round-trip finishes, which is what makes failed fetches
      //    look like "the profile never opens".
      const searchCaches = qc.getQueriesData<CursorPage<PublicUser>>({
        queryKey: ['profile', 'search'],
      });
      for (const [, page] of searchCaches) {
        const hit = page?.items.find((u) => u.id === id);
        if (hit) return hit;
      }
      return undefined;
    },
    staleTime: 60_000,
    // 1 retry — default 3 means a flaky network keeps the screen on a spinner
    // for ~45s (3 × 15s axios timeout). 1 retry makes failures surface in ~15s.
    retry: 1,
  });

  const relationshipQuery = useQuery({
    queryKey: ['user', id, 'relationship'],
    queryFn: () => friendsApi.relationship(id!),
    enabled: !!id,
  });

  const postsQuery = useQuery({
    queryKey: ['user', id, 'posts'],
    queryFn: () => profileApi.getUserPosts(id!),
    enabled: !!id,
  });

  const friendsQuery = useQuery({
    queryKey: ['user', id, 'friends'],
    queryFn: () => profileApi.getFriendsOf(id!),
    enabled: !!id,
    retry: 0,
  });

  const sendRequestMut = useMutation({
    mutationFn: () => friendsApi.sendRequest(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user', id, 'relationship'] });
      void qc.invalidateQueries({ queryKey: ['friends'] });
    },
  });
  const acceptMut = useMutation({
    mutationFn: (friendshipId: string) => friendsApi.accept(friendshipId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user', id, 'relationship'] });
      void qc.invalidateQueries({ queryKey: ['friends'] });
    },
  });
  const removeMut = useMutation({
    mutationFn: () => friendsApi.remove(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user', id, 'relationship'] });
      void qc.invalidateQueries({ queryKey: ['friends'] });
    },
  });
  const openConvoMut = useMutation({
    mutationFn: () => chatApi.createConversation([id!]),
    onSuccess: (convo) => router.push(`/chat/${convo.id}`),
  });

  const blockMut = useMutation({
    mutationFn: () => blocksApi.block(id!),
    onSuccess: () => {
      setMenuOpen(false);
      void qc.invalidateQueries();
      router.back();
    },
  });

  const likeMut = useMutation({
    mutationFn: (postId: string) => feedApi.toggleLike(postId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['user', id, 'posts'] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const handleRelationAction = useCallback(() => {
    const rel = relationshipQuery.data;
    if (!rel) return;
    if (rel.status === 'none') sendRequestMut.mutate();
    else if (rel.status === 'incoming' && rel.friendshipId) acceptMut.mutate(rel.friendshipId);
    else if (rel.status === 'friends') removeMut.mutate();
  }, [relationshipQuery.data, sendRequestMut, acceptMut, removeMut]);

  if (!userQuery.data) {
    // Three states: still loading (spinner), errored (visible message + retry),
    // or query disabled because `id` is missing (treat like an error). Without
    // this, an axios timeout would leave the screen on an indefinite spinner
    // for ~45s (3 retries × 15s) before silently giving up — what users
    // perceive as "the profile never opens".
    const isErrored = userQuery.isError || !id;
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        </View>
        {isErrored ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Profil indisponible</Text>
            <Text style={styles.errorHint}>
              {!id
                ? 'Identifiant manquant.'
                : describeProfileError(userQuery.error)}
            </Text>
            {id ? (
              <Pressable
                onPress={() => userQuery.refetch()}
                style={styles.retryBtn}
              >
                <Text style={styles.retryLabel}>Réessayer</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Loader />
        )}
      </SafeAreaView>
    );
  }

  const u = userQuery.data;
  const name =
    u.displayName ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ?? 'Utilisateur';
  const rel: Relationship = relationshipQuery.data?.status ?? 'none';
  const relLabel = RELATION_COPY[rel];
  const posts = postsQuery.data?.items ?? [];
  const friends = friendsQuery.data?.items ?? [];
  const friendsError = friendsQuery.isError;
  const postsError = postsQuery.isError;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        {rel !== 'self' ? (
          <View>
            <Pressable
              onPress={() => setMenuOpen((v) => !v)}
              hitSlop={12}
              style={styles.back}
              accessibilityLabel="Plus d'options"
            >
              <Text style={styles.backIcon}>⋯</Text>
            </Pressable>
            {menuOpen ? (
              <>
                <Pressable
                  style={styles.menuBackdrop}
                  onPress={() => setMenuOpen(false)}
                />
                <View style={styles.menu}>
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      setMenuOpen(false);
                      setReporting(true);
                    }}
                  >
                    <Text style={styles.menuText}>🚩  Signaler ce profil</Text>
                  </Pressable>
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => blockMut.mutate()}
                    disabled={blockMut.isPending}
                  >
                    <Text style={[styles.menuText, { color: '#D32F2F' }]}>
                      🚫  {blockMut.isPending ? 'Blocage…' : 'Bloquer cet utilisateur'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
      <ReportSheet
        visible={reporting}
        targetType="user"
        targetId={id ?? ''}
        onClose={() => setReporting(false)}
      />

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }: { item: Post }) => (
          <PostCard
            post={item}
            onLike={(pid) => likeMut.mutate(pid)}
            onComment={(pid) => router.push(`/post/${pid}`)}
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
            <View style={styles.hero}>
              <LinearGradient
                colors={[Colors.brown, Colors.brownSoft]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.heroContent}>
                <Avatar uri={u.avatarUrl} name={name} size={96} border={false} />
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{name}</Text>
                  {u.identityStatus === 'approved' && <VerifiedBadge size={18} />}
                </View>
                <Text style={styles.location}>
                  {u.countryCode ? Flags[u.countryCode] ?? '🌍' : '🌍'} {u.city ?? ''}
                  {u.countryCode ? `, ${CountryNames[u.countryCode] ?? u.countryCode}` : ''}
                </Text>
                {'bio' in u && u.bio ? <Text style={styles.bio}>{u.bio}</Text> : null}
              </View>
            </View>

            {rel !== 'self' && rel !== 'blocked' ? (
              <View style={styles.actions}>
                <Pressable
                  onPress={() => openConvoMut.mutate()}
                  disabled={openConvoMut.isPending}
                  style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
                >
                  <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                  <Text style={styles.primaryLabel}>💬 Envoyer un message</Text>
                </Pressable>
                <Pressable
                  onPress={handleRelationAction}
                  disabled={
                    rel === 'outgoing' ||
                    sendRequestMut.isPending ||
                    acceptMut.isPending ||
                    removeMut.isPending
                  }
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    rel === 'friends' && styles.friendsBtn,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryLabel,
                      rel === 'friends' && { color: Colors.green },
                    ]}
                  >
                    {relLabel}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Amis</Text>
              {friendsError ? (
                <Text style={styles.sectionHint}>
                  🔒 Liste d&apos;amis non visible (profil privé ou amis uniquement)
                </Text>
              ) : friends.length === 0 ? (
                <Text style={styles.sectionHint}>Aucun ami visible</Text>
              ) : (
                <FlatList
                  data={friends}
                  keyExtractor={(f) => f.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: Spacing.sm, paddingHorizontal: Spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => router.push(`/user/${item.id}`)}
                      style={styles.friendChip}
                    >
                      <Avatar
                        uri={item.avatarUrl}
                        name={item.displayName ?? item.firstName ?? 'N'}
                        size={48}
                        border={false}
                      />
                      <Text style={styles.friendName} numberOfLines={1}>
                        {item.displayName ??
                          `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim()}
                      </Text>
                    </Pressable>
                  )}
                />
              )}
            </View>

            <View style={[styles.section, { paddingHorizontal: 0 }]}>
              <Text style={[styles.sectionTitle, { paddingHorizontal: Spacing.md }]}>
                Publications
              </Text>
              {postsError ? (
                <Text style={styles.sectionHint}>
                  🔒 Publications non visibles (profil privé ou amis uniquement)
                </Text>
              ) : posts.length === 0 && !postsQuery.isLoading ? (
                <Text style={styles.sectionHint}>Aucune publication visible.</Text>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          postsQuery.isLoading ? (
            <Loader style={{ marginTop: Spacing.xl }} />
          ) : null
        }
        contentContainerStyle={{ paddingBottom: Spacing.xxxl }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  menuBackdrop: {
    position: 'absolute',
    top: -1000,
    bottom: -1000,
    left: -1000,
    right: -1000,
    zIndex: 50,
  },
  menu: {
    position: 'absolute',
    top: 44,
    right: 0,
    zIndex: 60,
    minWidth: 210,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 12,
  },
  menuItem: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 10,
  },
  menuText: {
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
    fontWeight: '600',
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, color: Colors.brown },
  hero: {
    margin: Spacing.lg,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    overflow: 'hidden',
    alignItems: 'center',
  },
  heroContent: { alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.md },
  name: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.white,
  },
  location: { fontSize: Typography.sizes.sm, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  bio: {
    fontSize: Typography.sizes.sm,
    color: 'rgba(255,255,255,0.6)',
    marginTop: Spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: { paddingHorizontal: Spacing.lg, gap: Spacing.md, marginBottom: Spacing.lg },
  primaryBtn: {
    height: 52,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  secondaryBtn: {
    height: 52,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  friendsBtn: { borderColor: Colors.green, backgroundColor: Colors.successSoft },
  secondaryLabel: { color: Colors.orange, fontSize: Typography.sizes.md, fontWeight: '700' },
  section: {
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  sectionHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    paddingHorizontal: Spacing.md,
  },
  friendChip: {
    alignItems: 'center',
    width: 68,
    gap: 4,
  },
  friendName: {
    fontSize: Typography.sizes.xs,
    color: Colors.brown,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBox: {
    marginTop: Spacing.xxl,
    marginHorizontal: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radii.lg,
    backgroundColor: Colors.white,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  errorTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
  },
  errorHint: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    backgroundColor: Colors.orange,
  },
  retryLabel: {
    color: Colors.white,
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
  },
});
