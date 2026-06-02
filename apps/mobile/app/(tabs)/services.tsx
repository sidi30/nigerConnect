import { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';
import { colorForId, relativeTime, SERVICE_CATEGORY_LABELS } from '@/constants/lookups';
import { servicesApi } from '@/services/servicesApi';
import type { ServiceCategory, ServiceUrgency } from '@nigerconnect/shared-types';

const CATEGORIES: Array<{ id: ServiceCategory; icon: string; label: string }> = [
  { id: 'logement', icon: '🏠', label: 'Logement' },
  { id: 'transport', icon: '✈️', label: 'Transport' },
  { id: 'admin_category', icon: '📋', label: 'Admin' },
  { id: 'sante', icon: '🏥', label: 'Santé' },
  { id: 'emploi', icon: '💼', label: 'Emploi' },
  { id: 'business', icon: '💰', label: 'Business' },
  { id: 'education', icon: '🎓', label: 'Éducation' },
  { id: 'autre', icon: '📦', label: 'Autre' },
];

type SortOption = 'recent' | 'urgent_first';

export default function ServicesTab() {
  const router = useRouter();
  const [selectedCat, setSelectedCat] = useState<ServiceCategory | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<ServiceUrgency | null>(null);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>('recent');
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const servicesQuery = useQuery({
    queryKey: ['services', { cat: selectedCat, urg: urgencyFilter, country: countryFilter, sort }],
    queryFn: () =>
      servicesApi.list({
        category: selectedCat ?? undefined,
        urgency: urgencyFilter ?? undefined,
        country: countryFilter ?? undefined,
        sort,
      }),
  });

  const services = servicesQuery.data?.items ?? [];

  const hasFilters = selectedCat || urgencyFilter || countryFilter;

  function resetFilters() {
    setSelectedCat(null);
    setUrgencyFilter(null);
    setCountryFilter(null);
    setSort('recent');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>🤝 Services & Entraide</Text>
        <Pressable style={styles.sortBtn} onPress={() => setSort(sort === 'recent' ? 'urgent_first' : 'recent')}>
          <Text style={styles.sortLabel}>
            {sort === 'recent' ? '🕐 Récent' : '🔴 Urgent'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={servicesQuery.isRefetching}
            onRefresh={() => void servicesQuery.refetch()}
            tintColor={Colors.orange}
          />
        }
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.catStrip}
          contentContainerStyle={styles.catStripContent}
        >
          {hasFilters ? (
            <Pressable onPress={resetFilters} style={styles.resetPill}>
              <Text style={styles.resetLabel}>✕ Réinitialiser</Text>
            </Pressable>
          ) : null}
          {CATEGORIES.map((c) => {
            const active = c.id === selectedCat;
            return (
              <Pressable
                key={c.id}
                onPress={() => setSelectedCat(active ? null : c.id)}
                style={[styles.catPill, active && styles.catPillActive]}
              >
                <Text style={[styles.catIcon, active && { color: Colors.white }]}>{c.icon}</Text>
                <Text style={[styles.catLabel, active && { color: Colors.white }]}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.subFilters}>
          <Pressable
            onPress={() => setUrgencyFilter(urgencyFilter === 'urgent' ? null : 'urgent')}
            style={[
              styles.subFilterPill,
              urgencyFilter === 'urgent' && {
                backgroundColor: Colors.warningSoft,
                borderColor: Colors.warningDark,
              },
            ]}
          >
            <Text
              style={[
                styles.subFilterLabel,
                urgencyFilter === 'urgent' && { color: Colors.warningDark },
              ]}
            >
              🔴 Urgent seulement
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowCountryPicker(!showCountryPicker)}
            style={[
              styles.subFilterPill,
              countryFilter && {
                backgroundColor: Colors.peach50,
                borderColor: Colors.orange,
              },
            ]}
          >
            <Text
              style={[
                styles.subFilterLabel,
                countryFilter && { color: Colors.orange },
              ]}
            >
              {countryFilter ? `${Flags[countryFilter]} ${CountryNames[countryFilter]}` : '🌍 Pays'}
            </Text>
          </Pressable>
        </View>

        {showCountryPicker && (
          <View style={styles.countryPicker}>
            {Object.keys(Flags)
              .filter((c) => c !== 'NE')
              .map((code) => (
                <Pressable
                  key={code}
                  onPress={() => {
                    setCountryFilter(countryFilter === code ? null : code);
                    setShowCountryPicker(false);
                  }}
                  style={[
                    styles.countryChip,
                    countryFilter === code && styles.countryChipActive,
                  ]}
                >
                  <Text style={styles.countryFlag}>{Flags[code]}</Text>
                  <Text style={styles.countryName}>{CountryNames[code]}</Text>
                </Pressable>
              ))}
          </View>
        )}

        {servicesQuery.isLoading ? (
          <View style={styles.loader}>
            <Loader style={{ marginTop: 0 }} />
          </View>
        ) : services.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🤝</Text>
            <Text style={styles.emptyTitle}>Aucune demande</Text>
            <Text style={styles.emptyText}>
              {hasFilters
                ? 'Aucune demande ne correspond aux filtres.'
                : 'Sois le premier à publier une demande d\u2019entraide.'}
            </Text>
          </View>
        ) : (
          services.map((svc) => {
            const author = svc.author;
            return (
              <Pressable
                key={svc.id}
                onPress={() => router.push(`/services/${svc.id}` as never)}
                style={styles.card}
              >
                <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                  <Pressable
                    onPress={() => router.push(`/user/${author.id}`)}
                    hitSlop={4}
                  >
                    <Avatar
                      uri={author.avatarUrl}
                      name={author.displayName ?? 'N'}
                      size={42}
                      borderColor={colorForId(author.id)}
                    />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <View style={styles.catRow}>
                      <Text style={styles.catTag}>
                        {SERVICE_CATEGORY_LABELS[svc.category] ?? svc.category}
                      </Text>
                      {svc.urgency === 'urgent' && (
                        <View style={styles.urgencyPill}>
                          <Text style={styles.urgencyLabel}>🔴 Urgent</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.svcTitle} numberOfLines={2}>
                      {svc.title}
                    </Text>
                    <Text style={styles.metaAuthor} numberOfLines={1}>
                      {author.displayName} · {author.city ?? ''}{' '}
                      {author.countryCode ? Flags[author.countryCode] ?? '' : ''} ·{' '}
                      {relativeTime(svc.createdAt)}
                    </Text>
                    {svc.description ? (
                      <Text style={styles.desc} numberOfLines={2}>
                        {svc.description}
                      </Text>
                    ) : null}
                    <View style={styles.footer}>
                      {svc.budget ? <Text style={styles.budget}>💰 {svc.budget}</Text> : null}
                      <View style={{ flex: 1 }} />
                      <Text style={styles.responses}>
                        💬 {svc.responseCount}{' '}
                        {svc.responseCount === 1 ? 'réponse' : 'réponses'}
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => router.push('/services/new')}>
        <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
        <Text style={styles.fabLabel}>+ Publier une demande</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
    backgroundColor: 'rgba(253,251,247,0.96)',
  },
  title: {
    flex: 1,
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
  },
  sortBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
  },
  sortLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.tan600 },
  catStrip: { marginTop: Spacing.sm },
  catStripContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: 8,
  },
  resetPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.dangerSoft,
  },
  resetLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.danger },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  catPillActive: { backgroundColor: Colors.brown, borderColor: Colors.brown },
  catIcon: { fontSize: 15 },
  catLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.tan600 },
  subFilters: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  subFilterPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.tan200,
    backgroundColor: Colors.white,
  },
  subFilterLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '700', color: Colors.tan600 },
  countryPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  countryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.tan200,
    backgroundColor: Colors.white,
  },
  countryChipActive: { backgroundColor: Colors.peach50, borderColor: Colors.orange },
  countryFlag: { fontSize: 16 },
  countryName: { fontSize: Typography.sizes.xs + 1, fontWeight: '600', color: Colors.brown },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.md + 2,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md - 2,
  },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  catTag: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '700',
    color: Colors.tan600,
    backgroundColor: Colors.tan100,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  urgencyPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: Colors.warningSoft,
  },
  urgencyLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700', color: Colors.warningDark },
  svcTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 3,
  },
  metaAuthor: { fontSize: Typography.sizes.xs, color: Colors.tan500 },
  desc: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan600,
    lineHeight: 19,
    marginTop: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: 10,
  },
  budget: {
    fontSize: Typography.sizes.sm - 1,
    color: Colors.orange,
    fontWeight: '700',
  },
  responses: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, fontWeight: '600' },
  loader: { padding: Spacing.xxl, alignItems: 'center' },
  empty: { padding: Spacing.xxl, alignItems: 'center' },
  emptyEmoji: { fontSize: 40, marginBottom: Spacing.md },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: 4,
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
