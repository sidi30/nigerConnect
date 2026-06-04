import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader } from '@/components/ui/Loader';
import { StarRating } from '@/components/ui/StarRating';
import { ReviewsSection } from '@/components/reviews/ReviewsSection';
import { PollCard } from '@/components/poll/PollCard';
import { CreatePollCard } from '@/components/poll/CreatePollCard';
import { pagesApi } from '@/services/pagesApi';
import { pollsApi } from '@/services/pollsApi';
import { useAuthStore } from '@/stores/authStore';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

/**
 * Map page/follow/unfollow errors to actionable sentences.
 */
function describeError(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { status?: number; data?: { message?: string | string[] } };
  } | null;
  const apiMsg = e?.response?.data?.message;
  const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
  if (msg) return msg;
  const status = e?.response?.status;
  if (status === 404) return 'Page introuvable.';
  if (status && status >= 500) return 'Le serveur ne répond pas. Réessaie dans un instant.';
  if (/network/i.test(e?.message ?? '')) return 'Pas de connexion. Vérifie ton réseau.';
  return e?.message ?? 'Une erreur est survenue.';
}

const KIND_LABELS: Record<string, string> = {
  community: '🌐 Communauté',
  cause: '❤️ Cause',
  business: '💼 Business',
  official: '🏛️ Officiel',
  group: '👥 Groupe',
};

export default function PageDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);

  const [showCreatePoll, setShowCreatePoll] = useState(false);

  const pageQuery = useQuery({
    queryKey: ['page', id],
    queryFn: () => pagesApi.get(id!),
    enabled: !!id,
    retry: 1,
  });

  const pollsQuery = useQuery({
    queryKey: ['polls', 'page', id],
    queryFn: () => pollsApi.list({ pageId: id }),
    enabled: !!id,
  });

  const followMut = useMutation({
    mutationFn: () => pagesApi.follow(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['page', id] });
      void qc.invalidateQueries({ queryKey: ['pages'] });
    },
    onError: (e) => Alert.alert('Impossible de suivre', describeError(e)),
  });

  const unfollowMut = useMutation({
    mutationFn: () => pagesApi.unfollow(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['page', id] });
      void qc.invalidateQueries({ queryKey: ['pages'] });
    },
    onError: (e) => Alert.alert('Impossible de ne plus suivre', describeError(e)),
  });

  const removeMut = useMutation({
    mutationFn: () => pagesApi.remove(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pages'] });
      router.back();
    },
    onError: (e) => Alert.alert('Impossible de supprimer', describeError(e)),
  });

  function confirmDelete() {
    Alert.alert('Supprimer la page', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => removeMut.mutate(),
      },
    ]);
  }

  if (pageQuery.isLoading) {
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

  if (pageQuery.isError || !pageQuery.data || !id) {
    const notFound =
      !id ||
      (pageQuery.error as { response?: { status?: number } } | null)?.response?.status === 404;
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        </View>
        <View style={styles.errorBox}>
          <Text style={styles.errorEmoji}>📄</Text>
          <Text style={styles.errorTitle}>
            {notFound ? 'Page introuvable' : 'Page indisponible'}
          </Text>
          <Text style={styles.errorHint}>
            {notFound
              ? "Cette page n'existe plus ou a été supprimée."
              : describeError(pageQuery.error)}
          </Text>
          {!notFound && id ? (
            <Pressable onPress={() => pageQuery.refetch()} style={styles.retryBtn}>
              <Text style={styles.retryLabel}>Réessayer</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const p = pageQuery.data;
  const polls = pollsQuery.data?.items ?? [];
  const isAdmin = p.myRole === 'admin' || p.myRole === 'editor';
  // Owners/admins can't review their own page (API enforces this too).
  const canReviewPage = !isAdmin && p.createdBy?.id !== me?.id;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        {p.myRole === 'admin' ? (
          <View style={styles.adminActions}>
            <Pressable
              onPress={confirmDelete}
              disabled={removeMut.isPending}
              style={[styles.deletePageBtn, removeMut.isPending && { opacity: 0.5 }]}
            >
              <Text style={styles.deleteBtnLabel}>
                {removeMut.isPending ? '…' : 'Supprimer'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxxl }}>
        {/* Hero */}
        <View style={styles.hero}>
          {p.coverUrl ? (
            <Image
              source={{ uri: p.coverUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={styles.logoWrap}>
              {p.avatarUrl ? (
                <Image source={{ uri: p.avatarUrl }} style={styles.logo} contentFit="cover" />
              ) : (
                <Text style={styles.logoEmoji}>📄</Text>
              )}
            </View>
            <Text style={styles.pageName}>
              {p.name}
              {p.isVerified ? ' ✓' : ''}
            </Text>
            <Text style={styles.pageKind}>{KIND_LABELS[p.kind] ?? p.kind}</Text>
            {(p.city || p.countryCode) ? (
              <Text style={styles.location}>
                {Flags[p.countryCode ?? ''] ?? '🌍'} {p.city ?? ''}
                {p.countryCode ? `, ${CountryNames[p.countryCode] ?? p.countryCode}` : ''}
              </Text>
            ) : null}
            <Text style={styles.followers}>👥 {p.followerCount} abonnés</Text>
            {p.ratingCount > 0 ? (
              <View style={styles.ratingWrap}>
                <StarRating value={p.ratingAvg} count={p.ratingCount} size={14} />
              </View>
            ) : null}
          </View>
        </View>

        {/* Follow / Unfollow action */}
        <View style={styles.actions}>
          {p.isFollowing ? (
            <Pressable
              onPress={() => unfollowMut.mutate()}
              disabled={unfollowMut.isPending}
              style={({ pressed }) => [styles.unfollowBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.unfollowLabel}>
                {unfollowMut.isPending ? '…' : '✓ Abonné · Se désabonner'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => followMut.mutate()}
              disabled={followMut.isPending}
              style={({ pressed }) => [styles.followBtn, pressed && { opacity: 0.9 }]}
            >
              <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
              <Text style={styles.followLabel}>
                {followMut.isPending ? '…' : '＋ Suivre'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* À propos */}
        {p.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>À propos</Text>
            <Text style={styles.description}>{p.description}</Text>
          </View>
        ) : null}

        {/* Contact */}
        {p.website || p.contactEmail ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            {p.website ? <Text style={styles.contactLine}>🌐 {p.website}</Text> : null}
            {p.contactEmail ? <Text style={styles.contactLine}>✉️ {p.contactEmail}</Text> : null}
          </View>
        ) : null}

        {/* Create poll (admin only) */}
        {isAdmin ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setShowCreatePoll((v) => !v)}
              style={styles.createPollToggle}
            >
              <Text style={styles.createPollToggleLabel}>
                {showCreatePoll ? '✕ Annuler' : '＋ Créer un sondage'}
              </Text>
            </Pressable>
            {showCreatePoll ? (
              <CreatePollCard
                pageId={id}
                onCreated={() => {
                  setShowCreatePoll(false);
                  void qc.invalidateQueries({ queryKey: ['polls', 'page', id] });
                }}
              />
            ) : null}
          </View>
        ) : null}

        {/* Polls */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sondages</Text>
          {pollsQuery.isLoading ? (
            <Loader style={{ marginTop: Spacing.sm }} />
          ) : pollsQuery.isError ? (
            <Text style={styles.sectionHint}>Impossible de charger les sondages.</Text>
          ) : polls.length === 0 ? (
            <Text style={styles.sectionHint}>Aucun sondage pour le moment.</Text>
          ) : (
            polls.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                isPageAdmin={isAdmin}
                onChanged={() => {
                  void qc.invalidateQueries({ queryKey: ['polls', 'page', id] });
                }}
              />
            ))
          )}
        </View>

        {/* Reviews */}
        <ReviewsSection targetType="page" targetId={id} canReview={canReviewPage} />
      </ScrollView>
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
  back: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, color: Colors.brown },
  adminActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  adminBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.lg,
    backgroundColor: Colors.peach50,
    borderWidth: 1,
    borderColor: Colors.orange,
  },
  adminBtnLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  deletePageBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.lg,
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.dangerMuted,
  },
  deleteBtnLabel: { color: Colors.danger, fontSize: Typography.sizes.sm, fontWeight: '700' },
  hero: {
    marginHorizontal: Spacing.lg,
    borderRadius: Radii.xxl,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    overflow: 'hidden',
    alignItems: 'center',
  },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
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
  logoEmoji: { fontSize: 40 },
  pageName: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.white,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  pageKind: {
    fontSize: Typography.sizes.sm,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  location: { fontSize: Typography.sizes.sm, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  followers: {
    fontSize: Typography.sizes.sm,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
    fontWeight: '600',
  },
  ratingWrap: { marginTop: 6 },
  actions: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    alignItems: 'center',
  },
  followBtn: {
    width: '100%',
    height: 52,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  unfollowBtn: {
    width: '100%',
    height: 52,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unfollowLabel: { color: Colors.tan600, fontSize: Typography.sizes.md, fontWeight: '700' },
  section: { marginTop: Spacing.lg, paddingHorizontal: Spacing.lg },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  sectionHint: { fontSize: Typography.sizes.sm, color: Colors.tan500 },
  description: { fontSize: Typography.sizes.md, color: Colors.brownSoft, lineHeight: 22 },
  contactLine: { fontSize: Typography.sizes.sm, color: Colors.brownSoft, marginBottom: 4 },
  createPollToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.orange,
    backgroundColor: Colors.peach50,
    marginBottom: Spacing.sm,
  },
  createPollToggleLabel: {
    color: Colors.orange,
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
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
  errorEmoji: { fontSize: 40 },
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
