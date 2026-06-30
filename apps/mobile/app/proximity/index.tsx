import { useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProximityEncounterSummary } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { geoApi } from '@/services/geoApi';
import { toast } from '@/stores/toastStore';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId, relativeTime } from '@/constants/lookups';

function distanceLabel(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

function requesterName(r: NonNullable<ProximityEncounterSummary['requester']>): string {
  return r.displayName ?? (`${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Membre');
}

export default function ProximityScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['proximity', 'encounters'],
    queryFn: () => geoApi.listEncounters(),
  });

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['proximity', 'encounters'] });
  }, [qc]);

  const connectMut = useMutation({
    mutationFn: (id: string) => geoApi.connectEncounter(id),
    onSuccess: () => {
      toast.success('Demande envoyée');
      invalidate();
    },
    onError: () => toast.error('Action impossible'),
  });

  const declineMut = useMutation({
    mutationFn: (id: string) => geoApi.declineEncounter(id),
    onSuccess: invalidate,
    onError: () => toast.error('Action impossible'),
  });

  const encounters = data ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={Colors.brown} />
        </Pressable>
        <Text style={styles.title}>Rencontres à proximité</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={Colors.orange} />
        }
      >
        <View style={styles.intro}>
          <Feather name="shield" size={15} color={Colors.tan600} />
          <Text style={styles.introText}>
            Les personnes croisées restent anonymes. Tu vois leur profil seulement
            si elles t&apos;envoient une demande, ou après avoir accepté la tienne.
          </Text>
        </View>

        {isLoading ? (
          <Loader style={{ marginTop: Spacing.xl }} />
        ) : encounters.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="map-pin" size={44} color={Colors.tan400} />
            <Text style={styles.emptyTitle}>Aucune rencontre pour l&apos;instant</Text>
            <Text style={styles.emptyText}>
              Active les notifications de proximité et garde l&apos;app ouverte en te
              déplaçant pour croiser d&apos;autres membres vérifiés.
            </Text>
          </View>
        ) : (
          encounters.map((e) => {
            const incoming = e.status === 'requested' && !e.outgoing && e.requester;
            if (incoming && e.requester) {
              // A request someone sent me — the requester is revealed.
              return (
                <Pressable
                  key={e.encounterId}
                  style={[styles.card, styles.cardIncoming]}
                  onPress={() => router.push(`/proximity/${e.encounterId}` as never)}
                >
                  <Avatar
                    uri={e.requester.avatarUrl}
                    name={requesterName(e.requester)}
                    size={48}
                    borderColor={colorForId(e.requester.id)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {requesterName(e.requester)}
                    </Text>
                    <Text style={styles.cardMeta}>
                      Souhaite vous rencontrer · {distanceLabel(e.distance)}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={Colors.orange} />
                </Pressable>
              );
            }

            // Anonymous active crossing, or my own pending request.
            return (
              <View key={e.encounterId} style={styles.card}>
                <View style={styles.anonAvatar}>
                  <Feather name="user" size={20} color={Colors.tan500} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>Quelqu&apos;un à proximité</Text>
                  <Text style={styles.cardMeta}>
                    {distanceLabel(e.distance)} · {relativeTime(e.createdAt)}
                  </Text>
                </View>
                {e.outgoing ? (
                  <View style={styles.pendingPill}>
                    <Text style={styles.pendingLabel}>En attente</Text>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <Pressable
                      style={styles.connectBtn}
                      disabled={connectMut.isPending}
                      onPress={() => connectMut.mutate(e.encounterId)}
                    >
                      <Text style={styles.connectLabel}>Connecter</Text>
                    </Pressable>
                    <Pressable
                      style={styles.ignoreBtn}
                      disabled={declineMut.isPending}
                      onPress={() => declineMut.mutate(e.encounterId)}
                      hitSlop={6}
                    >
                      <Feather name="x" size={16} color={Colors.tan500} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
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
  backBtn: { width: 24 },
  title: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.brown },
  scroll: { padding: Spacing.md, gap: 10, paddingBottom: Spacing.xxxl },
  intro: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: Colors.tan100,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: 4,
  },
  introText: { flex: 1, fontSize: Typography.sizes.xs + 1, color: Colors.tan600, lineHeight: 18 },
  empty: { padding: Spacing.xxxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: Spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  cardIncoming: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  anonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.tan100,
  },
  cardName: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  cardMeta: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.orange,
  },
  connectLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  ignoreBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.tan100,
  },
  pendingPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
  },
  pendingLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.tan600 },
});
