import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { associationsApi } from '@/services/associationsApi';
import { Colors, CountryNames, Flags, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { Loader } from '@/components/ui/Loader';

const ROLE_LABELS: Record<string, { color: string; bg: string; label: string }> = {
  admin: { color: Colors.orange, bg: Colors.peach50, label: 'Admin' },
  moderator: { color: Colors.info, bg: Colors.infoSoft, label: 'Modérateur' },
  member: { color: Colors.tan500, bg: Colors.tan100, label: 'Membre' },
};

export default function MyAssociationsScreen() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['associations', 'mine'],
    queryFn: () => associationsApi.mine(),
  });

  if (isLoading) {
    return <Loader />;
  }

  const assocs = data ?? [];

  if (assocs.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>🏛️</Text>
        <Text style={styles.emptyTitle}>Aucune association</Text>
        <Text style={styles.emptyText}>
          Rejoins une association depuis la carte ou crée la tienne.
        </Text>
        <Pressable
          style={styles.createBtn}
          onPress={() => router.push('/associations/new')}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.createLabel}>✨  Créer une association</Text>
        </Pressable>
        <Pressable style={styles.browseBtn} onPress={() => router.replace('/(tabs)/map')}>
          <Text style={styles.browseLabel}>Parcourir les associations →</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {assocs.map((a) => {
          const role = ROLE_LABELS[a.role]!;
          return (
            <Pressable
              key={a.id}
              style={styles.card}
              onPress={() => router.push(`/associations/${a.id}`)}
            >
              <View style={styles.logoWrap}>
                {a.logoUrl ? (
                  <Image source={{ uri: a.logoUrl }} style={styles.logo} contentFit="cover" />
                ) : (
                  <Text style={styles.logoEmoji}>🏛️</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {a.name}
                  {a.isVerified ? ' ✓' : ''}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {Flags[a.countryCode ?? ''] ?? '🌍'} {a.city ?? ''}
                  {a.countryCode
                    ? `, ${CountryNames[a.countryCode] ?? a.countryCode}`
                    : ''}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.members}>👥 {a.memberCount} membres</Text>
                  <View style={[styles.roleBadge, { backgroundColor: role.bg }]}>
                    <Text style={[styles.roleLabel, { color: role.color }]}>{role.label}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable style={styles.fab} onPress={() => router.push('/associations/new')}>
        <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
        <Text style={styles.fabLabel}>✨  Créer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  empty: { flex: 1, padding: Spacing.xxxl, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.md },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
  },
  createBtn: {
    marginTop: Spacing.xl,
    height: 50,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  createLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  browseBtn: { marginTop: Spacing.md, padding: Spacing.md },
  browseLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    right: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radii.full,
    overflow: 'hidden',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabLabel: { color: Colors.white, fontSize: Typography.sizes.sm + 1, fontWeight: '700' },
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  logoWrap: {
    width: 52,
    height: 52,
    borderRadius: Radii.md,
    backgroundColor: Colors.info,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: '100%', height: '100%' },
  logoEmoji: { fontSize: 26 },
  name: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  meta: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  members: { fontSize: Typography.sizes.xs, color: Colors.tan600, fontWeight: '600' },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  roleLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700' },
});
