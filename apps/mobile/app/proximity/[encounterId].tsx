import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProximityEncounterSummary } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { AmbassadorBadge } from '@/components/ui/AmbassadorBadge';
import { geoApi } from '@/services/geoApi';
import { toast } from '@/stores/toastStore';
import { Colors, Flags, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';

function distanceLabel(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

function requesterName(r: NonNullable<ProximityEncounterSummary['requester']>): string {
  return r.displayName ?? (`${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Membre');
}

export default function ProximityRequestScreen() {
  const { encounterId } = useLocalSearchParams<{ encounterId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['proximity', 'encounters'],
    queryFn: () => geoApi.listEncounters(),
  });

  const encounter = (data ?? []).find((e) => e.encounterId === encounterId);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['proximity', 'encounters'] });
  };

  const acceptMut = useMutation({
    mutationFn: () => geoApi.acceptEncounter(encounterId!),
    onSuccess: () => {
      toast.success('Vous êtes maintenant en relation 🎉');
      invalidate();
      const id = encounter?.requester?.id;
      if (id) router.replace(`/user/${id}` as never);
      else router.back();
    },
    onError: () => toast.error('Action impossible'),
  });

  const declineMut = useMutation({
    mutationFn: () => geoApi.declineEncounter(encounterId!),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: () => toast.error('Action impossible'),
  });

  const busy = acceptMut.isPending || declineMut.isPending;
  const requester = encounter?.requester;
  const isIncoming = encounter?.status === 'requested' && !encounter.outgoing && !!requester;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={Colors.brown} />
        </Pressable>
        <Text style={styles.title}>Demande de rencontre</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <Loader style={{ marginTop: Spacing.xxxl }} />
      ) : !isIncoming || !requester ? (
        <View style={styles.fallback}>
          <Feather name="inbox" size={44} color={Colors.tan400} />
          <Text style={styles.fallbackText}>
            Cette demande n&apos;est plus disponible.
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.replace('/proximity' as never)}>
            <Text style={styles.secondaryLabel}>Voir mes rencontres</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.body}>
          <Pressable onPress={() => router.push(`/user/${requester.id}` as never)} style={styles.profile}>
            <Avatar
              uri={requester.avatarUrl}
              name={requesterName(requester)}
              size={96}
              borderColor={colorForId(requester.id)}
            />
            <View style={styles.nameRow}>
              <Text style={styles.name}>{requesterName(requester)}</Text>
              {requester.identityStatus === 'approved' ? <VerifiedBadge size={18} /> : null}
              {requester.isAmbassador ? <AmbassadorBadge size={18} /> : null}
            </View>
            {requester.city ? (
              <Text style={styles.loc}>
                {requester.city}
                {requester.countryCode ? ` ${Flags[requester.countryCode] ?? ''}` : ''}
              </Text>
            ) : null}
            <Text style={styles.distance}>Croisé à {distanceLabel(encounter.distance)}</Text>
            <Text style={styles.viewProfile}>Voir le profil complet ›</Text>
          </Pressable>

          <Text style={styles.explain}>
            Cette personne vous a croisé et souhaite vous rencontrer. Si vous acceptez,
            vous deviendrez amis et verrez chacun le profil de l&apos;autre.
          </Text>

          <View style={styles.ctaRow}>
            <Pressable
              style={[styles.declineBtn, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={() => declineMut.mutate()}
            >
              <Text style={styles.declineLabel}>Refuser</Text>
            </Pressable>
            <Pressable
              style={[styles.acceptBtn, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={() => acceptMut.mutate()}
            >
              <Text style={styles.acceptLabel}>{acceptMut.isPending ? 'Acceptation…' : 'Accepter'}</Text>
            </Pressable>
          </View>
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
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  title: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.brown },
  body: { flex: 1, padding: Spacing.lg, gap: Spacing.lg },
  profile: { alignItems: 'center', gap: 6, paddingVertical: Spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  name: { fontSize: Typography.sizes.xl, fontWeight: '800', color: Colors.brown },
  loc: { fontSize: Typography.sizes.sm, color: Colors.tan600 },
  distance: { fontSize: Typography.sizes.sm, color: Colors.tan500, marginTop: 2 },
  viewProfile: { fontSize: Typography.sizes.sm, color: Colors.orange, fontWeight: '700', marginTop: 6 },
  explain: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan600,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Spacing.md,
  },
  ctaRow: { flexDirection: 'row', gap: Spacing.md, marginTop: 'auto' },
  declineBtn: {
    flex: 1,
    height: 52,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.tan300,
  },
  declineLabel: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.tan600 },
  acceptBtn: {
    flex: 1,
    height: 52,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.orange,
  },
  acceptLabel: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.white },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  fallbackText: { fontSize: Typography.sizes.md, color: Colors.tan500, textAlign: 'center' },
  secondaryBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
  },
  secondaryLabel: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
});
