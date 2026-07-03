import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import type { RatesToday } from '@nigerconnect/shared-types';

interface Props {
  rates: RatesToday | undefined;
  loading: boolean;
  onPress: () => void;
}

function formatRate(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/**
 * Light, non-intrusive feed-head banner: XOF↔EUR peg (always shown) +
 * USD/CAD when a real ECB snapshot exists. `source: 'unavailable'` (no
 * snapshot fetched yet) degrades gracefully — peg still shown, USD/CAD
 * cells hidden rather than showing a broken "—".
 */
export function RatesBanner({ rates, loading, onPress }: Props) {
  if (loading && !rates) {
    return (
      <View style={[styles.wrap, styles.skeleton]}>
        <View style={styles.skelLine} />
      </View>
    );
  }
  if (!rates) return null;

  const unavailable = rates.source === 'unavailable';
  const asOfLabel = rates.asOf
    ? new Date(rates.asOf).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.85 }]}>
      <View style={styles.iconWrap}>
        <Feather name="trending-up" size={15} color={Colors.orange} />
      </View>
      <View style={styles.rows}>
        <Text style={styles.pair}>
          1€ = <Text style={styles.value}>655,957 F CFA</Text>
        </Text>
        {!unavailable && rates.usdXof != null ? (
          <Text style={styles.pair}>
            1$ = <Text style={styles.value}>{formatRate(rates.usdXof)} F CFA</Text>
          </Text>
        ) : null}
        {!unavailable && rates.cadXof != null ? (
          <Text style={styles.pair}>
            1CA$ = <Text style={styles.value}>{formatRate(rates.cadXof)} F CFA</Text>
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }} />
      {unavailable ? (
        <Text style={styles.hint}>Taux du jour bientôt</Text>
      ) : asOfLabel ? (
        <Text style={styles.hint}>Au {asOfLabel}</Text>
      ) : null}
      <Feather name="chevron-right" size={16} color={Colors.tan400} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan50,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  skeleton: { minHeight: 40 },
  skelLine: {
    height: 12,
    width: '60%',
    borderRadius: 6,
    backgroundColor: Colors.tan200,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: Radii.md,
    backgroundColor: Colors.peach50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rows: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, flexShrink: 1 },
  pair: { fontSize: Typography.sizes.xs + 1, color: Colors.tan600, fontWeight: '600' },
  value: { color: Colors.brown, fontWeight: '800' },
  hint: { fontSize: Typography.sizes.xxs, color: Colors.tan400, fontWeight: '600' },
});
