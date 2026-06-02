import {
  Alert,
  FlatList,
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
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { associationsApi } from '@/services/associationsApi';
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
import { relativeTime } from '@/constants/lookups';

/**
 * Map join/leave/fetch errors to a sentence the end user can act on. The raw
 * axios message ("Request failed with status code 409") means nothing to a
 * non-technical member. We surface the API's own message when present, then
 * fall back to status-based copy.
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
  if (status === 404) return 'Association introuvable.';
  if (status && status >= 500) return 'Le serveur ne répond pas. Réessaie dans un instant.';
  if (/network/i.test(e?.message ?? '')) return 'Pas de connexion. Vérifie ton réseau.';
  return e?.message ?? 'Une erreur est survenue.';
}

const ROLE_LABELS: Record<string, { color: string; bg: string; label: string }> = {
  admin: { color: Colors.orange, bg: Colors.peach50, label: 'Admin' },
  moderator: { color: Colors.info, bg: Colors.infoSoft, label: 'Modérateur' },
  member: { color: Colors.tan500, bg: Colors.tan100, label: 'Membre' },
};

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
    onError: (e) => Alert.alert('Impossible de rejoindre', describeError(e)),
  });

  const leaveMut = useMutation({
    mutationFn: () => associationsApi.leave(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['association', id] });
      void qc.invalidateQueries({ queryKey: ['association', id, 'members'] });
    },
    onError: (e) => Alert.alert('Impossible de quitter', describeError(e)),
  });

  function confirmLeave() {
    Alert.alert('Quitter l’association', 'Tu ne recevras plus ses actualités.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter', style: 'destructive', onPress: () => leaveMut.mutate() },
    ]);
  }

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
          <Text style={styles.errorEmoji}>🏛️</Text>
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
  const role = membership ? ROLE_LABELS[membership.role] : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
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
                <Text style={styles.logoEmoji}>🏛️</Text>
              )}
            </View>
            <Text style={styles.name}>
              {a.name}
              {a.isVerified ? ' ✓' : ''}
            </Text>
            <Text style={styles.location}>
              {Flags[a.countryCode ?? ''] ?? '🌍'} {a.city ?? ''}
              {a.countryCode ? `, ${CountryNames[a.countryCode] ?? a.countryCode}` : ''}
            </Text>
            <Text style={styles.members}>👥 {a.memberCount} membres</Text>
          </View>
        </View>

        <View style={styles.actions}>
          {isMember ? (
            <>
              {role ? (
                <View style={[styles.roleBadge, { backgroundColor: role.bg }]}>
                  <Text style={[styles.roleLabel, { color: role.color }]}>
                    Tu es {role.label.toLowerCase()}
                  </Text>
                </View>
              ) : null}
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
              <Text style={styles.joinLabel}>
                {joinMut.isPending ? '…' : '＋ Rejoindre'}
              </Text>
            </Pressable>
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
            {a.website ? <Text style={styles.contactLine}>🌐 {a.website}</Text> : null}
            {a.contactEmail ? <Text style={styles.contactLine}>✉️ {a.contactEmail}</Text> : null}
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
                <Text style={styles.eventMeta}>
                  📅 {relativeTime(e.eventDate)}
                  {e.location ? ` · 📍 ${e.location}` : ''}
                </Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
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
  logoEmoji: { fontSize: 40 },
  name: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.white,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  location: { fontSize: Typography.sizes.sm, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  members: { fontSize: Typography.sizes.sm, color: 'rgba(255,255,255,0.85)', marginTop: 4, fontWeight: '600' },
  actions: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  roleBadge: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radii.full },
  roleLabel: { fontSize: Typography.sizes.xs, fontWeight: '700' },
  joinBtn: {
    width: '100%',
    height: 52,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
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
  contactLine: { fontSize: Typography.sizes.sm, color: Colors.brownSoft, marginBottom: 4 },
  eventCard: {
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    marginBottom: Spacing.sm,
  },
  eventTitle: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  eventMeta: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
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
