import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '@/services/api';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { Loader } from '@/components/ui/Loader';
import { relativeTime } from '@/constants/lookups';

interface MyService {
  id: string;
  title: string;
  description: string | null;
  category: string;
  urgency: 'urgent' | 'normal';
  budget: string | null;
  city: string | null;
  countryCode: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  responseCount: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  open: { bg: Colors.peach50, color: Colors.orange, label: 'Ouvert' },
  in_progress: { bg: Colors.infoSoft, color: Colors.info, label: 'En cours' },
  resolved: { bg: Colors.successSoft, color: Colors.successDark, label: 'Résolu' },
  closed: { bg: Colors.tan100, color: Colors.tan500, label: 'Fermé' },
};

export default function MyRequestsScreen() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['services', 'mine'],
    queryFn: async () => {
      const { data } = await api.get<MyService[]>('/services/mine');
      return data;
    },
  });

  if (isLoading) {
    return <Loader />;
  }

  const requests = data ?? [];

  if (requests.length === 0) {
    return (
      <View style={styles.empty}>
        <Feather name="briefcase" size={44} color={Colors.tan400} style={styles.emptyEmoji} />
        <Text style={styles.emptyTitle}>Aucune demande</Text>
        <Text style={styles.emptyText}>
          Publie une demande d&apos;entraide depuis l&apos;onglet Services.
        </Text>
        <Pressable style={styles.browseBtn} onPress={() => router.replace('/(tabs)/services')}>
          <Text style={styles.browseLabel}>Publier une demande →</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {requests.map((r) => {
        const status = STATUS_COLORS[r.status]!;
        return (
          <View key={r.id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{r.title}</Text>
              <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
              </View>
            </View>
            {r.description ? (
              <Text style={styles.cardDesc} numberOfLines={2}>
                {r.description}
              </Text>
            ) : null}
            <View style={styles.footer}>
              <Text style={styles.footerText}>{r.category}</Text>
              {r.urgency === 'urgent' && (
                <View style={styles.urgentRow}>
                  <Feather name="alert-circle" size={12} color={Colors.warningDark} />
                  <Text style={styles.urgent}>Urgent</Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              <Text style={styles.footerText}>
                {r.responseCount} {r.responseCount === 1 ? 'réponse' : 'réponses'}
              </Text>
              <Text style={styles.footerText}>· {relativeTime(r.createdAt)}</Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  empty: { flex: 1, padding: Spacing.xxxl, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { marginBottom: Spacing.md },
  emptyTitle: { fontSize: Typography.sizes.lg, fontWeight: '700', color: Colors.brown },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
  },
  browseBtn: { marginTop: Spacing.lg, padding: Spacing.md },
  browseLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    padding: Spacing.md + 2,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  cardTitle: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
  },
  statusPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  statusLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700' },
  cardDesc: { fontSize: Typography.sizes.sm, color: Colors.tan600, lineHeight: 19 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
    flexWrap: 'wrap',
  },
  footerText: { fontSize: Typography.sizes.xs, color: Colors.tan500 },
  urgentRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  urgent: { fontSize: Typography.sizes.xs, color: Colors.warningDark, fontWeight: '700' },
});
