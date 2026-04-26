import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

export interface LegalSection {
  heading?: string;
  body?: string;
  bullets?: string[];
}

interface Props {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  contact?: string;
}

/**
 * Shared renderer for all legal screens. Keeping one component for TOS / Privacy / Community
 * means style + layout drift is impossible — which matters because these texts get updated
 * independently over time and inconsistent typography looks sloppy to reviewers.
 */
export function LegalDoc({ title, lastUpdated, intro, sections, contact }: Props) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.lastUpdated}>Mis à jour le {lastUpdated}</Text>
        <Text style={styles.intro}>{intro}</Text>
        {sections.map((s, i) => (
          <View key={i} style={styles.section}>
            {s.heading ? <Text style={styles.heading}>{s.heading}</Text> : null}
            {s.body ? <Text style={styles.body}>{s.body}</Text> : null}
            {s.bullets?.length ? (
              <View style={styles.bullets}>
                {s.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {contact ? (
          <View style={styles.contactBox}>
            <Text style={styles.contactTitle}>Nous contacter</Text>
            <Text style={styles.contactText}>{contact}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
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
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.sizes.md + 1,
    fontWeight: '700',
    color: Colors.brown,
  },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  lastUpdated: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
    marginBottom: Spacing.sm,
    fontWeight: '600',
  },
  intro: {
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  section: { marginBottom: Spacing.lg },
  heading: {
    fontSize: Typography.sizes.md + 1,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: Typography.sizes.sm + 1,
    color: Colors.tan600,
    lineHeight: 21,
  },
  bullets: { gap: 4, marginTop: 6 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bulletDot: {
    color: Colors.orange,
    fontSize: Typography.sizes.md,
    lineHeight: 20,
    fontWeight: '800',
  },
  bulletText: {
    flex: 1,
    fontSize: Typography.sizes.sm + 1,
    color: Colors.tan600,
    lineHeight: 20,
  },
  contactBox: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  contactTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: 4,
  },
  contactText: { fontSize: Typography.sizes.sm, color: Colors.tan600, lineHeight: 19 },
});
