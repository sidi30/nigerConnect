import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader } from '@/components/ui/Loader';
import { ReportSheet } from '@/components/ReportSheet';
import { CommunityPriceCard } from '@/components/rates/CommunityPriceCard';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { COMMUNITY_PRICE_TYPE_LABELS } from '@/constants/lookups';
import { ratesApi, describeCommunityPriceError } from '@/services/ratesApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import type { CommunityPrice, CommunityPriceType } from '@nigerconnect/shared-types';

const TYPES: Array<{ id: CommunityPriceType; label: string }> = [
  { id: 'billet_avion', label: COMMUNITY_PRICE_TYPE_LABELS.billet_avion! },
  { id: 'transfert_argent', label: COMMUNITY_PRICE_TYPE_LABELS.transfert_argent! },
  { id: 'colis_kg', label: COMMUNITY_PRICE_TYPE_LABELS.colis_kg! },
];

export default function CommunityPricesScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const [typeFilter, setTypeFilter] = useState<CommunityPriceType | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);

  const ratesQuery = useQuery({ queryKey: ['rates', 'today'], queryFn: () => ratesApi.today() });

  const listQuery = useInfiniteQuery({
    queryKey: ['community-prices', typeFilter],
    queryFn: ({ pageParam }) => ratesApi.list({ type: typeFilter ?? undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const prices: CommunityPrice[] = listQuery.data?.pages.flatMap((p) => p.items) ?? [];

  const voteMut = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | -1 }) => {
      setVotingId(id);
      return ratesApi.vote(id, value);
    },
    onSuccess: (result) => {
      qc.setQueryData(['community-prices', typeFilter], (old: unknown) => {
        const typed = old as { pages: Array<{ items: CommunityPrice[] }> } | undefined;
        if (!typed) return old;
        return {
          ...typed,
          pages: typed.pages.map((page) => ({
            ...page,
            items: page.items.map((p) =>
              p.id === result.priceId ? { ...p, trustScore: result.trustScore, myVote: result.myVote } : p,
            ),
          })),
        };
      });
    },
    onError: (e) => toast.error(describeCommunityPriceError(e)),
    onSettled: () => setVotingId(null),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => ratesApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['community-prices'] });
      toast.success('Signalement supprimé');
    },
    onError: (e) => toast.error(describeCommunityPriceError(e)),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="chevron-left" size={22} color={Colors.brown} />
        </Pressable>
        <Text style={styles.title}>Taux &amp; prix</Text>
        <View style={{ width: 22 }} />
      </View>

      {ratesQuery.data ? (
        <View style={styles.rateStrip}>
          <Feather name="trending-up" size={13} color={Colors.orange} />
          <Text style={styles.rateStripText}>
            1€ = 655,957 F CFA
            {ratesQuery.data.usdXof != null ? ` · 1$ = ${ratesQuery.data.usdXof} F CFA` : ''}
            {ratesQuery.data.cadXof != null ? ` · 1CA$ = ${ratesQuery.data.cadXof} F CFA` : ''}
          </Text>
        </View>
      ) : null}

      <View style={styles.filters}>
        <Pressable
          onPress={() => setTypeFilter(null)}
          style={[styles.filterPill, !typeFilter && styles.filterPillActive]}
        >
          <Text style={[styles.filterLabel, !typeFilter && styles.filterLabelActive]}>Tous</Text>
        </Pressable>
        {TYPES.map((t) => {
          const active = typeFilter === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTypeFilter(active ? null : t.id)}
              style={[styles.filterPill, active && styles.filterPillActive]}
            >
              <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={prices}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingTop: Spacing.sm, paddingBottom: 100 }}
        renderItem={({ item }) => (
          <CommunityPriceCard
            price={item}
            isMine={item.submitter.id === userId}
            voting={votingId === item.id}
            onVote={(value) => voteMut.mutate({ id: item.id, value })}
            onPressAuthor={() => router.push(`/user/${item.submitter.id}`)}
            onReport={() => setReportingId(item.id)}
            onDelete={
              item.submitter.id === userId
                ? () => deleteMut.mutate(item.id)
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          listQuery.isLoading ? (
            <View style={styles.loader}>
              <Loader style={{ marginTop: 0 }} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="dollar-sign" size={40} color={Colors.tan400} />
              <Text style={styles.emptyTitle}>Aucun prix signalé</Text>
              <Text style={styles.emptyText}>
                Sois le premier à partager un prix pour aider la communauté.
              </Text>
            </View>
          )
        }
        onEndReached={() => listQuery.hasNextPage && listQuery.fetchNextPage()}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={listQuery.isRefetching}
            onRefresh={() => {
              void listQuery.refetch();
              void ratesQuery.refetch();
            }}
            tintColor={Colors.orange}
          />
        }
      />

      <Pressable style={styles.fab} onPress={() => router.push('/rates/new' as never)}>
        <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
        <Text style={styles.fabLabel}>+ Signaler un prix</Text>
      </Pressable>

      <ReportSheet
        visible={reportingId !== null}
        targetType="community_price"
        targetId={reportingId ?? ''}
        onClose={() => setReportingId(null)}
      />
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
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  rateStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.peach50,
  },
  rateStripText: { fontSize: Typography.sizes.xs + 1, color: Colors.brown, fontWeight: '600', flexShrink: 1 },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  filterPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  filterPillActive: { backgroundColor: Colors.brown, borderColor: Colors.brown },
  filterLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.tan600 },
  filterLabelActive: { color: Colors.white },
  loader: { padding: Spacing.xl, alignItems: 'center' },
  empty: { padding: Spacing.xxl, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 19,
  },
  fab: {
    position: 'absolute',
    bottom: 16,
    left: Spacing.md,
    right: Spacing.md,
    height: 54,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  fabLabel: { color: Colors.white, fontSize: Typography.sizes.md + 1, fontWeight: '700' },
});
