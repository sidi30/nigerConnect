import { useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { Page, PageKind } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { StarRating } from '@/components/ui/StarRating';
import { pagesApi } from '@/services/pagesApi';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

const KIND_FILTERS: Array<{ id: PageKind | null; label: string; icon: string }> = [
  { id: null, label: 'Toutes', icon: '🔍' },
  { id: 'community', label: 'Communauté', icon: '🌐' },
  { id: 'cause', label: 'Cause', icon: '❤️' },
  { id: 'business', label: 'Business', icon: '💼' },
  { id: 'official', label: 'Officiel', icon: '🏛️' },
  { id: 'group', label: 'Groupe', icon: '👥' },
];

const KIND_LABELS: Record<PageKind, string> = {
  community: '🌐 Communauté',
  cause: '❤️ Cause',
  business: '💼 Business',
  official: '🏛️ Officiel',
  group: '👥 Groupe',
};

export default function PagesIndexScreen() {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState<PageKind | null>(null);
  const [search, setSearch] = useState('');

  const discoverQuery = useQuery({
    queryKey: ['pages', 'list', kindFilter, search],
    queryFn: () =>
      pagesApi.list({
        kind: kindFilter ?? undefined,
        q: search.trim() || undefined,
        limit: 30,
      }),
    staleTime: 30_000,
  });

  const mineQuery = useQuery({
    queryKey: ['pages', 'mine'],
    queryFn: () => pagesApi.mine(),
    staleTime: 60_000,
  });

  const pages = discoverQuery.data?.items ?? [];
  const myPages = mineQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Pages</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={pages}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PageCard page={item} onPress={() => router.push(`/pages/${item.id}`)} />}
        ListHeaderComponent={
          <View>
            {/* Search */}
            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher une page…"
                placeholderTextColor={Colors.tan400}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
                autoCapitalize="none"
              />
            </View>

            {/* Kind filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {KIND_FILTERS.map((f) => {
                const active = f.id === kindFilter;
                return (
                  <Pressable
                    key={String(f.id)}
                    onPress={() => setKindFilter(f.id)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                  >
                    <Text style={styles.filterIcon}>{f.icon}</Text>
                    <Text style={[styles.filterLabel, active && { color: Colors.orange }]}>
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Mes pages section */}
            {myPages.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Mes pages</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: Spacing.sm, paddingVertical: Spacing.xs }}
                >
                  {myPages.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => router.push(`/pages/${p.id}`)}
                      style={styles.myPageChip}
                    >
                      <Avatar uri={p.avatarUrl} name={p.name} size={40} border={false} />
                      <Text style={styles.myPageName} numberOfLines={1}>
                        {p.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Text style={styles.sectionTitle2}>Découvrir</Text>

            {discoverQuery.isLoading ? (
              <Loader style={{ marginTop: Spacing.lg }} />
            ) : discoverQuery.isError ? (
              <Text style={styles.errorText}>Impossible de charger les pages.</Text>
            ) : pages.length === 0 ? (
              <Text style={styles.emptyText}>Aucune page trouvée.</Text>
            ) : null}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <Pressable
        onPress={() => router.push('/pages/new')}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        accessibilityLabel="Créer une page"
      >
        <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
        <Text style={styles.fabLabel}>＋</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function PageCard({ page, onPress }: { page: Page; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
      {/* Cover strip */}
      <View style={styles.cardCover}>
        {page.coverUrl ? (
          <Image source={{ uri: page.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
        )}
      </View>

      <View style={styles.cardBody}>
        <Avatar uri={page.avatarUrl} name={page.name} size={44} border={false} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName} numberOfLines={1}>
            {page.name}
            {page.isVerified ? ' ✓' : ''}
          </Text>
          <Text style={styles.cardKind}>{KIND_LABELS[page.kind]}</Text>
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>👥 {page.followerCount}</Text>
            {page.ratingCount > 0 ? (
              <StarRating value={page.ratingAvg} count={page.ratingCount} size={12} />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
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
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, color: Colors.brown },
  headerTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: '800',
    color: Colors.brown,
  },
  searchWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  searchInput: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm + 2,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.white,
    color: Colors.brown,
  },
  filterRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.full,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  filterChipActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  filterIcon: { fontSize: 14 },
  filterLabel: { fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.brown },
  section: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
  },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  sectionTitle2: {
    fontSize: Typography.sizes.md,
    fontWeight: '800',
    color: Colors.brown,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  myPageChip: {
    alignItems: 'center',
    width: 72,
    gap: 4,
  },
  myPageName: {
    fontSize: Typography.sizes.xs,
    color: Colors.brown,
    fontWeight: '600',
    textAlign: 'center',
  },
  card: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: Radii.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
    overflow: 'hidden',
  },
  cardCover: {
    height: 64,
    overflow: 'hidden',
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  cardName: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
  },
  cardKind: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
    marginTop: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 4,
  },
  metaText: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
  },
  errorText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  fab: {
    position: 'absolute',
    bottom: Spacing.xxl,
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  fabLabel: {
    color: Colors.white,
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
  },
});
