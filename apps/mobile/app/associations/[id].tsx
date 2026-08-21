import { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { Badge } from '@/components/ui/Badge';
import { PostCard } from '@/components/feed/PostCard';
import { associationsApi, type DesignateOfficerInput } from '@/services/associationsApi';
import { feedApi } from '@/services/feedApi';
import { friendsApi } from '@/services/friendsApi';
import { notificationApi } from '@/services/notificationApi';
import { useAuthStore } from '@/stores/authStore';
import type { AssociationOfficerTitle, Post } from '@nigerconnect/shared-types';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';
import {
  ASSOCIATION_OFFICER_TITLE_LABELS,
  officerTitleLabel,
  relativeTime,
  selectOfficerInviteBanner,
  visibleOfficers,
} from '@/constants/lookups';
import { describeError } from '@/services/apiError';

/**
 * Map join/leave/fetch errors to a sentence the end user can act on. The raw
 * axios message ("Request failed with status code 409") means nothing to a
 * non-technical member. We surface the API's own message when present, then
 * fall back to status-based copy.
 */

const ROLE_LABELS: Record<string, { color: string; bg: string; label: string }> = {
  owner: { color: Colors.orange, bg: Colors.peach50, label: 'Propriétaire' },
  admin: { color: Colors.orange, bg: Colors.peach50, label: 'Admin' },
  moderator: { color: Colors.info, bg: Colors.infoSoft, label: 'Modérateur' },
  member: { color: Colors.tan500, bg: Colors.tan100, label: 'Membre' },
};

// A4 — titres proposables lors de la désignation d'un membre du bureau.
const OFFICER_TITLE_OPTIONS: AssociationOfficerTitle[] = [
  'president',
  'vice_president',
  'secretary',
  'treasurer',
  'spokesperson',
  'other',
];

export default function AssociationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);

  const assocQuery = useQuery({
    queryKey: ['association', id],
    queryFn: () => associationsApi.get(id!),
    enabled: !!id,
    retry: 1,
  });

  // `getById` carries no current-user membership info, so we derive the
  // join/leave state from the user's own associations list (the same data the
  // Settings → My Associations screen renders). This keeps the button correct
  // without a dedicated endpoint.
  const mineQuery = useQuery({
    queryKey: ['associations', 'mine'],
    queryFn: () => associationsApi.mine(),
    enabled: !!id,
  });

  const membersQuery = useQuery({
    queryKey: ['association', id, 'members'],
    queryFn: () => associationsApi.members(id!),
    enabled: !!id,
  });

  const membership = mineQuery.data?.find((a) => a.id === id);
  const isMember = !!membership;

  const joinMut = useMutation({
    mutationFn: () => associationsApi.join(id!),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['association', id] });
      void qc.invalidateQueries({ queryKey: ['association', id, 'members'] });
      Alert.alert(
        res.pending ? 'Demande envoyée' : 'Bienvenue !',
        res.pending
          ? 'Ta demande a été transmise aux admins pour validation.'
          : 'Tu fais maintenant partie de cette association.',
      );
    },
    onError: (e) => Alert.alert('Impossible de rejoindre', describeError(e, 'Association introuvable.')),
  });

  const leaveMut = useMutation({
    mutationFn: () => associationsApi.leave(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['association', id] });
      void qc.invalidateQueries({ queryKey: ['association', id, 'members'] });
    },
    onError: (e) => Alert.alert('Impossible de quitter', describeError(e, 'Association introuvable.')),
  });

  function confirmLeave() {
    Alert.alert('Quitter l’association', 'Tu ne recevras plus ses actualités.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter', style: 'destructive', onPress: () => leaveMut.mutate() },
    ]);
  }

  const removeMut = useMutation({
    mutationFn: () => associationsApi.remove(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['associations'] });
      void qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['geo'] });
      router.back();
    },
    onError: (e) => Alert.alert('Impossible de supprimer', describeError(e, 'Association introuvable.')),
  });

  function confirmDelete() {
    Alert.alert('Supprimer l’association', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => removeMut.mutate() },
    ]);
  }

  // Admins & moderators manage join requests and can invite people.
  const canManage = membership?.role === 'admin' || membership?.role === 'moderator';

  // Publier au nom de l'association est réservé aux dirigeants (décision
  // proprio du 2026-08-21) : une publication d'association atterrit dans le fil
  // de TOUS les membres approuvés, c'est donc l'association qui parle, pas un
  // membre qui s'adresse aux autres. Miroir exact du filtre de rôle de
  // posts.service.ts create() — si l'écran offrait le bouton à un simple
  // membre, il n'obtiendrait qu'un 403.
  const canPublish =
    membership?.role === 'admin' ||
    membership?.role === 'moderator' ||
    membership?.role === 'owner';

  const pendingQuery = useQuery({
    queryKey: ['association', id, 'pending'],
    queryFn: () => associationsApi.pending(id!),
    enabled: !!id && canManage,
  });

  function invalidateRequests() {
    void qc.invalidateQueries({ queryKey: ['association', id, 'pending'] });
    void qc.invalidateQueries({ queryKey: ['association', id, 'members'] });
    void qc.invalidateQueries({ queryKey: ['association', id] });
  }

  const approveMut = useMutation({
    mutationFn: (userId: string) => associationsApi.approve(id!, userId),
    onSuccess: invalidateRequests,
    onError: (e) => Alert.alert('Action impossible', describeError(e, 'Association introuvable.')),
  });
  const rejectMut = useMutation({
    mutationFn: (userId: string) => associationsApi.reject(id!, userId),
    onSuccess: invalidateRequests,
    onError: (e) => Alert.alert('Action impossible', describeError(e, 'Association introuvable.')),
  });

  // ── Invite ──────────────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const friendsQuery = useQuery({
    queryKey: ['friends'],
    queryFn: () => friendsApi.list(),
    enabled: inviteOpen,
  });

  const inviteMut = useMutation({
    mutationFn: (userId: string) => associationsApi.invite(id!, userId),
    onSuccess: (_res, userId) => {
      setInvitedIds((prev) => new Set(prev).add(userId));
    },
    onError: (e) => Alert.alert('Invitation impossible', describeError(e, 'Association introuvable.')),
  });

  // ── A4 — bureau exécutif ────────────────────────────────────
  // Un owner peut désigner/retirer au même titre qu'un admin (miroir exact de
  // association.service.ts assertRole(['admin','owner']) côté API).
  const canManageOfficers = membership?.role === 'admin' || membership?.role === 'owner';

  const officersQuery = useQuery({
    queryKey: ['association', id, 'officers'],
    queryFn: () => associationsApi.officers(id!),
    enabled: !!id,
  });

  // Il n'existe aucun endpoint « mon siège en attente » (un siège proposé
  // n'apparaît qu'après acceptation dans officers(), par consentement
  // explicite). Le seul signal côté client est la notification d'invitation
  // elle-même — comme pour friend_request, elle route vers cette page. Limite
  // assumée : la notification (donc ce bandeau) disparaît 24h après l'envoi,
  // ou plus tôt si l'utilisateur fait "Tout effacer" (même contrainte que
  // toutes les notifications de l'app, pas une régression introduite ici).
  const notifsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationApi.list(),
    enabled: !!id && !!me,
  });

  const [officerActionTaken, setOfficerActionTaken] = useState(false);
  const officers = officersQuery.data ?? [];
  // Client-owned invariant (see constants/lookups.ts `visibleOfficers`) —
  // only accepted seats, sortOrder-ordered — kept independent of the API's
  // own filtering/ordering rather than trusted blindly.
  const sortedOfficers = visibleOfficers(officers);
  const alreadyOfficer = !!me && officers.some((o) => o.user.id === me.id);
  const showOfficerInviteBanner = selectOfficerInviteBanner({
    notifications: notifsQuery.data?.items ?? [],
    associationId: id,
    alreadyOfficer,
    actionTaken: officerActionTaken,
  });

  function invalidateOfficers() {
    setOfficerActionTaken(true);
    void qc.invalidateQueries({ queryKey: ['association', id, 'officers'] });
  }

  const acceptOfficerMut = useMutation({
    mutationFn: () => associationsApi.acceptOfficerSeat(id!),
    onSuccess: invalidateOfficers,
    onError: (e) => Alert.alert('Action impossible', describeError(e, 'Invitation introuvable ou expirée.')),
  });
  const declineOfficerMut = useMutation({
    mutationFn: () => associationsApi.removeOfficer(id!, me!.id),
    onSuccess: invalidateOfficers,
    onError: (e) => Alert.alert('Action impossible', describeError(e, 'Invitation introuvable ou expirée.')),
  });
  const removeOfficerMut = useMutation({
    mutationFn: (userId: string) => associationsApi.removeOfficer(id!, userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['association', id, 'officers'] }),
    onError: (e) => Alert.alert('Retrait impossible', describeError(e, 'Association introuvable.')),
  });

  function confirmRemoveOfficer(userId: string, name: string) {
    Alert.alert('Retirer du bureau ?', `${name} ne sera plus affiché·e comme membre du bureau.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => removeOfficerMut.mutate(userId) },
    ]);
  }

  // ── Désignation d'un membre du bureau (admin/owner) ─────────
  const [designateOpen, setDesignateOpen] = useState(false);
  const [designateUserId, setDesignateUserId] = useState<string | null>(null);
  const [designateTitle, setDesignateTitle] = useState<AssociationOfficerTitle>('president');
  const [designateCustomTitle, setDesignateCustomTitle] = useState('');

  const designateMut = useMutation({
    mutationFn: (input: DesignateOfficerInput) => associationsApi.designateOfficer(id!, input),
    onSuccess: () => {
      setDesignateOpen(false);
      setDesignateUserId(null);
      setDesignateCustomTitle('');
      Alert.alert('Invitation envoyée', 'La personne devra accepter pour apparaître au bureau.');
    },
    onError: (e) => Alert.alert('Désignation impossible', describeError(e, 'Association introuvable.')),
  });

  function submitDesignate() {
    if (!designateUserId) return;
    designateMut.mutate({
      userId: designateUserId,
      title: designateTitle,
      customTitle: designateTitle === 'other' ? designateCustomTitle.trim() : undefined,
      // Ajoute en fin de liste — pas de réordonnancement manuel pour l'instant.
      sortOrder: officers.length,
    });
  }

  async function shareJoinLink() {
    const name = assocQuery.data?.name ?? 'cette association';
    const url = `nigerconnect://associations/${id}`;
    try {
      await Share.share({
        message: `Rejoins « ${name} » sur NigerConnect : ${url}`,
        url,
      });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  }

  // ── Association posts (members-only wall) ───────────────────
  const postsKey = ['association', id, 'posts'] as const;
  const assocPostsQuery = useInfiniteQuery({
    queryKey: postsKey,
    queryFn: ({ pageParam }) => associationsApi.posts(id!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!id && isMember,
  });

  type PostsPage = { items: Post[]; nextCursor: string | null };
  const likeMut = useMutation({
    mutationFn: (postId: string) => feedApi.toggleLike(postId),
    // Optimistic flip across all loaded pages of the association wall.
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: postsKey });
      const prev = qc.getQueryData(postsKey);
      qc.setQueryData(postsKey, (old: unknown) => {
        const typed = old as { pages: PostsPage[]; pageParams: unknown[] } | undefined;
        if (!typed?.pages) return old;
        return {
          ...typed,
          pages: typed.pages.map((pg) => ({
            ...pg,
            items: pg.items.map((p) =>
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
      if (ctx?.prev) qc.setQueryData(postsKey, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: postsKey }),
  });

  const deletePostMut = useMutation({
    mutationFn: (postId: string) => feedApi.deletePost(postId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: postsKey }),
    onError: (e) => Alert.alert('Suppression impossible', describeError(e, 'Association introuvable.')),
  });

  if (assocQuery.isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        </View>
        <Loader />
      </SafeAreaView>
    );
  }

  if (assocQuery.isError || !assocQuery.data || !id) {
    const notFound =
      !id ||
      (assocQuery.error as { response?: { status?: number } } | null)?.response?.status === 404;
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        </View>
        <View style={styles.errorBox}>
          <Feather name="home" size={40} color={Colors.tan300} style={styles.errorIcon} />
          <Text style={styles.errorTitle}>
            {notFound ? 'Association introuvable' : 'Association indisponible'}
          </Text>
          <Text style={styles.errorHint}>
            {notFound
              ? 'Cette association n’existe plus ou a été supprimée.'
              : describeError(assocQuery.error)}
          </Text>
          {!notFound && id ? (
            <Pressable onPress={() => assocQuery.refetch()} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Réessayer</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const a = assocQuery.data;
  const events = a.events ?? [];
  const members = membersQuery.data?.items ?? [];
  const pending = pendingQuery.data?.items ?? [];
  const friends = friendsQuery.data?.items ?? [];
  const assocPosts = assocPostsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const role = membership ? ROLE_LABELS[membership.role] : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        {membership?.role === 'admin' ? (
          <Pressable
            onPress={confirmDelete}
            disabled={removeMut.isPending}
            style={[styles.deleteBtn, removeMut.isPending && { opacity: 0.5 }]}
          >
            <Feather name="trash-2" size={14} color={Colors.danger} />
            <Text style={styles.deleteBtnLabel}>
              {removeMut.isPending ? '…' : 'Supprimer'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxxl }}>
        <View style={styles.hero}>
          {a.coverUrl ? (
            <Image source={{ uri: a.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={styles.logoWrap}>
              {a.logoUrl ? (
                <Image source={{ uri: a.logoUrl }} style={styles.logo} contentFit="cover" />
              ) : (
                <Feather name="home" size={40} color={Colors.tan400} />
              )}
            </View>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{a.name}</Text>
              {a.isVerified ? <Badge kind="association_verified" size={18} verifiedAt={a.verifiedAt} /> : null}
            </View>
            <Text style={styles.location}>
              {Flags[a.countryCode ?? ''] ?? '🌍'} {a.city ?? ''}
              {a.countryCode ? `, ${CountryNames[a.countryCode] ?? a.countryCode}` : ''}
            </Text>
            <View style={styles.membersRow}>
              <Feather name="users" size={14} color="rgba(255,255,255,0.85)" />
              <Text style={styles.members}>{a.memberCount} membres</Text>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          {mineQuery.isPending ? (
            // Membership unknown until `mineQuery` resolves — show a neutral
            // state so an admin never sees (or taps) "Rejoindre" by mistake.
            <Loader />
          ) : isMember ? (
            <>
              {role ? (
                <View style={[styles.roleBadge, { backgroundColor: role.bg }]}>
                  <Text style={[styles.roleLabel, { color: role.color }]}>
                    Tu es {role.label.toLowerCase()}
                  </Text>
                </View>
              ) : null}
              <View style={styles.memberActions}>
                {canManage ? (
                  <Pressable style={styles.secondaryBtn} onPress={() => setInviteOpen(true)}>
                    <Feather name="user-plus" size={15} color={Colors.orange} />
                    <Text style={styles.secondaryLabel}>Inviter</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.secondaryBtn} onPress={shareJoinLink}>
                  <Feather name="share-2" size={15} color={Colors.orange} />
                  <Text style={styles.secondaryLabel}>Partager le lien</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={confirmLeave}
                disabled={leaveMut.isPending}
                style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.leaveLabel}>
                  {leaveMut.isPending ? 'Départ…' : 'Quitter l’association'}
                </Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => joinMut.mutate()}
              disabled={joinMut.isPending}
              style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.9 }]}
            >
              <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
              {joinMut.isPending ? (
                <Text style={styles.joinLabel}>…</Text>
              ) : (
                <View style={styles.btnContent}>
                  <Feather name="plus" size={16} color={Colors.white} />
                  <Text style={styles.joinLabel}>Rejoindre</Text>
                </View>
              )}
            </Pressable>
          )}
        </View>

        {isMember ? (
          <View style={{ marginTop: Spacing.lg }}>
            <View style={styles.pubHeader}>
              <Text style={styles.sectionTitle}>Publications</Text>
              {canPublish ? (
                <Pressable
                  style={styles.writeBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/post/new',
                      params: { associationId: id, associationName: a.name },
                    })
                  }
                >
                  <Feather name="edit-2" size={14} color={Colors.white} />
                  <Text style={styles.writeLabel}>Écrire</Text>
                </Pressable>
              ) : null}
            </View>
            {assocPostsQuery.isLoading ? (
              <Loader style={{ marginTop: Spacing.sm }} />
            ) : assocPostsQuery.isError ? (
              <Text style={[styles.sectionHint, { paddingHorizontal: Spacing.lg }]}>
                Impossible de charger les publications.
              </Text>
            ) : assocPosts.length === 0 ? (
              <Text style={[styles.sectionHint, { paddingHorizontal: Spacing.lg }]}>
                {canPublish
                  ? 'Aucune publication pour l’instant. Sois le premier à publier !'
                  : 'Aucune publication pour l’instant.'}
              </Text>
            ) : (
              assocPosts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  currentUserId={me?.id}
                  onLike={(pid) => likeMut.mutate(pid)}
                  onComment={(pid) => router.push(`/post/${pid}`)}
                  onEdit={(pid) => router.push(`/post/edit/${pid}` as never)}
                  onDelete={(pid) => deletePostMut.mutate(pid)}
                  onPhotoPress={(photos, index) =>
                    router.push({
                      pathname: '/photos/viewer',
                      params: { photos: JSON.stringify(photos), index: String(index) },
                    } as never)
                  }
                />
              ))
            )}
            {assocPostsQuery.hasNextPage ? (
              <Pressable
                onPress={() => assocPostsQuery.fetchNextPage()}
                disabled={assocPostsQuery.isFetchingNextPage}
                style={styles.loadMoreBtn}
              >
                <Text style={styles.loadMoreLabel}>
                  {assocPostsQuery.isFetchingNextPage ? 'Chargement…' : 'Voir plus'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {canManage ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Demandes d’adhésion{pending.length ? ` (${pending.length})` : ''}
            </Text>
            {pendingQuery.isLoading ? (
              <Loader style={{ marginTop: Spacing.sm }} />
            ) : pendingQuery.isError ? (
              <Text style={styles.sectionHint}>Impossible de charger les demandes.</Text>
            ) : pending.length === 0 ? (
              <Text style={styles.sectionHint}>Aucune demande en attente.</Text>
            ) : (
              pending.map((p) => (
                <View key={p.userId} style={styles.requestRow}>
                  <Pressable
                    style={styles.requestUser}
                    onPress={() => router.push(`/user/${p.userId}`)}
                  >
                    <Avatar
                      uri={p.user.avatarUrl}
                      name={p.user.displayName ?? 'N'}
                      size={40}
                      border={false}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.requestName} numberOfLines={1}>
                        {p.user.displayName ?? 'Membre'}
                      </Text>
                      {p.user.city ? (
                        <Text style={styles.requestMeta} numberOfLines={1}>
                          {p.user.city}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                  <View style={styles.requestActions}>
                    <Pressable
                      onPress={() => approveMut.mutate(p.userId)}
                      disabled={approveMut.isPending || rejectMut.isPending}
                      style={[styles.reqBtn, styles.reqApprove]}
                      accessibilityLabel="Accepter la demande"
                    >
                      <Feather name="check" size={16} color={Colors.white} />
                    </Pressable>
                    <Pressable
                      onPress={() => rejectMut.mutate(p.userId)}
                      disabled={approveMut.isPending || rejectMut.isPending}
                      style={[styles.reqBtn, styles.reqReject]}
                      accessibilityLabel="Refuser la demande"
                    >
                      <Feather name="x" size={16} color={Colors.danger} />
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.pubHeader}>
            <Text style={styles.sectionTitle}>Bureau exécutif</Text>
            {canManageOfficers ? (
              <Pressable
                style={styles.writeBtn}
                onPress={() => {
                  setDesignateUserId(null);
                  setDesignateTitle('president');
                  setDesignateCustomTitle('');
                  setDesignateOpen(true);
                }}
              >
                <Feather name="user-plus" size={14} color={Colors.white} />
                <Text style={styles.writeLabel}>Désigner</Text>
              </Pressable>
            ) : null}
          </View>

          {showOfficerInviteBanner ? (
            <View style={styles.officerInvite}>
              <Feather name="award" size={20} color={Colors.info} />
              <View style={{ flex: 1 }}>
                <Text style={styles.officerInviteTitle}>On te propose une place au bureau</Text>
                <Text style={styles.officerInviteHint}>
                  Ta fonction ne sera visible qu’après ton acceptation — c’est un choix qui n’engage que toi.
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <Pressable
                  onPress={() => acceptOfficerMut.mutate()}
                  disabled={acceptOfficerMut.isPending || declineOfficerMut.isPending}
                  style={[styles.reqBtn, styles.reqApprove]}
                  accessibilityLabel="Accepter la place au bureau"
                >
                  <Feather name="check" size={16} color={Colors.white} />
                </Pressable>
                <Pressable
                  onPress={() => declineOfficerMut.mutate()}
                  disabled={acceptOfficerMut.isPending || declineOfficerMut.isPending}
                  style={[styles.reqBtn, styles.reqReject]}
                  accessibilityLabel="Refuser la place au bureau"
                >
                  <Feather name="x" size={16} color={Colors.danger} />
                </Pressable>
              </View>
            </View>
          ) : null}

          {officersQuery.isLoading ? (
            <Loader style={{ marginTop: Spacing.sm }} />
          ) : officersQuery.isError ? (
            <Text style={styles.sectionHint}>Impossible de charger le bureau.</Text>
          ) : sortedOfficers.length === 0 ? (
            <Text style={styles.sectionHint}>Aucun membre du bureau désigné pour l’instant.</Text>
          ) : (
            sortedOfficers.map((o) => (
              <Pressable
                key={o.user.id}
                style={styles.officerRow}
                onPress={() => router.push(`/user/${o.user.id}`)}
              >
                <Avatar uri={o.user.avatarUrl} name={o.user.displayName ?? 'N'} size={44} border={false} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName} numberOfLines={1}>
                    {o.user.displayName ?? 'Membre'}
                  </Text>
                  <Text style={styles.officerTitle} numberOfLines={1}>
                    {officerTitleLabel(o)}
                  </Text>
                </View>
                {canManageOfficers ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      confirmRemoveOfficer(o.user.id, o.user.displayName ?? 'Ce membre');
                    }}
                    disabled={removeOfficerMut.isPending}
                    hitSlop={10}
                    style={styles.officerRemoveBtn}
                    accessibilityLabel="Retirer du bureau"
                  >
                    <Feather name="x" size={14} color={Colors.tan600} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))
          )}
        </View>

        {a.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>À propos</Text>
            <Text style={styles.description}>{a.description}</Text>
          </View>
        ) : null}

        {a.website || a.contactEmail ? (
          <View style={styles.section}>
            {a.website ? (
              <View style={styles.contactRow}>
                <Feather name="globe" size={14} color={Colors.brownSoft} />
                <Text style={styles.contactLine}>{a.website}</Text>
              </View>
            ) : null}
            {a.contactEmail ? (
              <View style={styles.contactRow}>
                <Feather name="mail" size={14} color={Colors.brownSoft} />
                <Text style={styles.contactLine}>{a.contactEmail}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {events.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Événements à venir</Text>
            {events.map((e) => (
              <View key={e.id} style={styles.eventCard}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <View style={styles.eventMetaRow}>
                  <Feather name="calendar" size={12} color={Colors.tan500} />
                  <Text style={styles.eventMeta}>{relativeTime(e.eventDate)}</Text>
                  {e.location ? (
                    <>
                      <Text style={styles.eventMeta}>·</Text>
                      <Feather name="map-pin" size={12} color={Colors.tan500} />
                      <Text style={styles.eventMeta} numberOfLines={1}>
                        {e.location}
                      </Text>
                    </>
                  ) : null}
                </View>
                {e.description ? (
                  <Text style={styles.eventDesc} numberOfLines={2}>
                    {e.description}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Membres ({a.memberCount})</Text>
          {membersQuery.isLoading ? (
            <Loader style={{ marginTop: Spacing.sm }} />
          ) : membersQuery.isError ? (
            <Text style={styles.sectionHint}>Impossible de charger les membres.</Text>
          ) : members.length === 0 ? (
            <Text style={styles.sectionHint}>Aucun membre pour l’instant.</Text>
          ) : (
            <FlatList
              data={members}
              keyExtractor={(m) => m.user.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: Spacing.sm, paddingVertical: Spacing.sm }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() =>
                    me && item.user.id === me.id
                      ? undefined
                      : router.push(`/user/${item.user.id}`)
                  }
                  style={styles.memberChip}
                >
                  <Avatar
                    uri={item.user.avatarUrl}
                    name={item.user.displayName ?? item.user.firstName ?? 'N'}
                    size={48}
                    border={false}
                  />
                  <Text style={styles.memberName} numberOfLines={1}>
                    {item.user.displayName ??
                      `${item.user.firstName ?? ''} ${item.user.lastName ?? ''}`.trim()}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </ScrollView>

      <Modal
        visible={inviteOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setInviteOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Inviter un ami</Text>
              <Pressable onPress={() => setInviteOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={Colors.brown} />
              </Pressable>
            </View>
            {friendsQuery.isLoading ? (
              <Loader style={{ marginTop: Spacing.lg }} />
            ) : friends.length === 0 ? (
              <Text style={styles.sectionHint}>
                Tu n’as pas encore d’amis à inviter. Partage plutôt le lien d’adhésion.
              </Text>
            ) : (
              <FlatList
                data={friends}
                keyExtractor={(u) => u.id}
                contentContainerStyle={{ gap: Spacing.sm, paddingVertical: Spacing.sm }}
                renderItem={({ item }) => {
                  const invited = invitedIds.has(item.id);
                  return (
                    <View style={styles.friendRow}>
                      <Avatar
                        uri={item.avatarUrl}
                        name={item.displayName ?? item.firstName ?? 'N'}
                        size={40}
                        border={false}
                      />
                      <Text style={styles.friendName} numberOfLines={1}>
                        {item.displayName ??
                          `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim() ??
                          'Ami'}
                      </Text>
                      <Pressable
                        onPress={() => inviteMut.mutate(item.id)}
                        disabled={invited || inviteMut.isPending}
                        style={[styles.inviteBtn, invited && styles.inviteBtnDone]}
                      >
                        <Text style={[styles.inviteBtnLabel, invited && { color: Colors.green }]}>
                          {invited ? 'Invité ✓' : 'Inviter'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={designateOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setDesignateOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {designateUserId ? 'Choisir la fonction' : 'Désigner un membre du bureau'}
              </Text>
              <Pressable onPress={() => setDesignateOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={Colors.brown} />
              </Pressable>
            </View>

            {!designateUserId ? (
              members.length === 0 ? (
                <Text style={styles.sectionHint}>Aucun membre à proposer pour l’instant.</Text>
              ) : (
                <FlatList
                  data={members.filter((m) => m.user.id !== me?.id)}
                  keyExtractor={(m) => m.user.id}
                  contentContainerStyle={{ gap: Spacing.sm, paddingVertical: Spacing.sm }}
                  renderItem={({ item }) => (
                    <Pressable
                      style={styles.friendRow}
                      onPress={() => setDesignateUserId(item.user.id)}
                    >
                      <Avatar
                        uri={item.user.avatarUrl}
                        name={item.user.displayName ?? 'N'}
                        size={40}
                        border={false}
                      />
                      <Text style={styles.friendName} numberOfLines={1}>
                        {item.user.displayName ?? 'Membre'}
                      </Text>
                      <Feather name="chevron-right" size={18} color={Colors.tan400} />
                    </Pressable>
                  )}
                />
              )
            ) : (
              <View style={{ gap: Spacing.md, paddingVertical: Spacing.sm }}>
                <View style={styles.titleChipsRow}>
                  {OFFICER_TITLE_OPTIONS.map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setDesignateTitle(t)}
                      style={[styles.titleChip, designateTitle === t && styles.titleChipActive]}
                    >
                      <Text
                        style={[
                          styles.titleChipLabel,
                          designateTitle === t && styles.titleChipLabelActive,
                        ]}
                      >
                        {ASSOCIATION_OFFICER_TITLE_LABELS[t]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {designateTitle === 'other' ? (
                  <TextInput
                    value={designateCustomTitle}
                    onChangeText={setDesignateCustomTitle}
                    placeholder="Titre (ex. Responsable communication)"
                    placeholderTextColor={Colors.tan400}
                    style={styles.titleInput}
                    maxLength={100}
                  />
                ) : null}
                <Pressable
                  onPress={() => setDesignateUserId(null)}
                  style={styles.secondaryBtn}
                >
                  <Feather name="arrow-left" size={15} color={Colors.orange} />
                  <Text style={styles.secondaryLabel}>Changer de membre</Text>
                </Pressable>
                <Pressable
                  onPress={submitDesignate}
                  disabled={
                    designateMut.isPending ||
                    (designateTitle === 'other' && !designateCustomTitle.trim())
                  }
                  style={({ pressed }) => [
                    styles.joinBtn,
                    (designateMut.isPending ||
                      (designateTitle === 'other' && !designateCustomTitle.trim())) && {
                      opacity: 0.5,
                    },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                  <Text style={styles.joinLabel}>
                    {designateMut.isPending ? '…' : 'Proposer le siège'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.lg,
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.dangerMuted,
  },
  deleteBtnLabel: { color: Colors.danger, fontSize: Typography.sizes.sm, fontWeight: '700' },
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
    marginHorizontal: Spacing.lg,
    borderRadius: Radii.xxl,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    overflow: 'hidden',
    alignItems: 'center',
  },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  heroContent: { alignItems: 'center' },
  logoWrap: {
    width: 84,
    height: 84,
    borderRadius: Radii.xl,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: Colors.white,
  },
  logo: { width: '100%', height: '100%' },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  name: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.white,
    textAlign: 'center',
  },
  location: { fontSize: Typography.sizes.sm, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  membersRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  members: { fontSize: Typography.sizes.sm, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  actions: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  roleBadge: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radii.full },
  roleLabel: { fontSize: Typography.sizes.xs, fontWeight: '700' },
  pubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  writeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radii.lg,
    backgroundColor: Colors.orange,
  },
  writeLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  loadMoreBtn: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
  },
  loadMoreLabel: { color: Colors.brown, fontSize: Typography.sizes.sm, fontWeight: '700' },
  memberActions: { flexDirection: 'row', gap: Spacing.sm, width: '100%' },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.peach100,
    backgroundColor: Colors.peach50,
  },
  secondaryLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan100,
  },
  requestUser: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  requestName: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  requestMeta: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 1 },
  requestActions: { flexDirection: 'row', gap: 8 },
  reqBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqApprove: { backgroundColor: Colors.green },
  reqReject: { backgroundColor: Colors.dangerSoft, borderWidth: 1, borderColor: Colors.dangerMuted },
  officerInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: Colors.infoSoft,
    borderWidth: 1,
    borderColor: Colors.info,
    marginBottom: Spacing.sm,
  },
  officerInviteTitle: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  officerInviteHint: { fontSize: Typography.sizes.xs, color: Colors.brownSoft, marginTop: 2 },
  officerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan100,
  },
  officerTitle: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 1 },
  officerRemoveBtn: {
    width: 30,
    height: 30,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.tan100,
  },
  titleChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  titleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.full,
    backgroundColor: Colors.tan100,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  titleChipActive: { backgroundColor: Colors.peach50, borderColor: Colors.orange },
  titleChipLabel: { fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.tan600 },
  titleChipLabelActive: { color: Colors.orange },
  titleInput: {
    height: 44,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    padding: Spacing.lg,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  modalTitle: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.brown },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.sm,
  },
  friendName: { flex: 1, fontSize: Typography.sizes.sm + 1, fontWeight: '600', color: Colors.brown },
  inviteBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.lg,
    backgroundColor: Colors.peach50,
    borderWidth: 1,
    borderColor: Colors.peach100,
  },
  inviteBtnDone: { backgroundColor: Colors.white, borderColor: Colors.tan200 },
  inviteBtnLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  joinBtn: {
    width: '100%',
    height: 52,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaveBtn: {
    width: '100%',
    height: 52,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveLabel: { color: Colors.tan600, fontSize: Typography.sizes.md, fontWeight: '700' },
  section: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  sectionHint: { fontSize: Typography.sizes.sm, color: Colors.tan500 },
  description: { fontSize: Typography.sizes.md, color: Colors.brownSoft, lineHeight: 22 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  contactLine: { fontSize: Typography.sizes.sm, color: Colors.brownSoft, flexShrink: 1 },
  eventCard: {
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    marginBottom: Spacing.sm,
  },
  eventTitle: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  eventMeta: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500 },
  eventDesc: { fontSize: Typography.sizes.sm, color: Colors.brownSoft, marginTop: 6, lineHeight: 19 },
  memberChip: { alignItems: 'center', width: 68, gap: 4 },
  memberName: {
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
  errorIcon: { marginBottom: 4 },
  errorTitle: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  errorHint: { fontSize: Typography.sizes.sm, color: Colors.tan500, textAlign: 'center' },
  retryBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    backgroundColor: Colors.orange,
  },
  retryLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
});
