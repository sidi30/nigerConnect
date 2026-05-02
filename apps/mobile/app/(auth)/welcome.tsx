import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors, Flags, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { geoApi } from '@/services/geoApi';
import { associationsApi } from '@/services/associationsApi';
import { probeApi, type Reachability } from '@/services/connectivity';

const FLOATING_FLAGS = [
  { x: '6%', y: '8%', size: 54, code: 'FR' },
  { x: '72%', y: '5%', size: 46, code: 'US' },
  { x: '38%', y: '38%', size: 62, code: 'NE' },
  { x: '82%', y: '48%', size: 42, code: 'CA' },
  { x: '12%', y: '62%', size: 50, code: 'SN' },
  { x: '58%', y: '68%', size: 44, code: 'BE' },
];

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}K+`;
  return String(n);
}

function FloatingFlag({
  delay,
  x,
  y,
  size,
  code,
}: {
  delay: number;
  x: string;
  y: string;
  size: number;
  code: string;
}) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -8,
          duration: 1500 + delay * 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 1500 + delay * 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [delay, translateY]);

  return (
    <Animated.View
      style={[
        styles.floatingTile,
        {
          left: x as unknown as number,
          top: y as unknown as number,
          width: size,
          height: size,
          borderRadius: size * 0.35,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.55 }}>{Flags[code]}</Text>
    </Animated.View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const flagEntries = Object.entries(Flags).filter(([k]) => k !== 'NE');
  // In dev only: probe the API once at mount and surface a banner if it can't
  // be reached. Cuts down on hours of "why does login fail" debugging when
  // the resolved BASE_URL points at the wrong server.
  const [probe, setProbe] = useState<Reachability | null>(null);
  useEffect(() => {
    if (!__DEV__) return;
    let active = true;
    void probeApi().then((r) => {
      if (active) setProbe(r);
    });
    return () => {
      active = false;
    };
  }, []);
  const statsQuery = useQuery({
    queryKey: ['geo', 'stats'],
    queryFn: () => geoApi.stats(),
    retry: 0,
  });
  const assocQuery = useQuery({
    queryKey: ['associations', 'count'],
    queryFn: () => associationsApi.list({ limit: 50 }),
    retry: 0,
  });
  const stats = [
    {
      n: statsQuery.data ? formatK(statsQuery.data.totalMembers) : '—',
      l: 'Membres',
      color: Colors.orange,
    },
    {
      n: statsQuery.data ? String(statsQuery.data.countryCounts.length) : '—',
      l: 'Pays',
      color: Colors.green,
    },
    {
      n: assocQuery.data ? String(assocQuery.data.items.length) : '—',
      l: 'Associations',
      color: '#FFB74D',
    },
  ];

  return (
    <View style={styles.root}>
      <LinearGradient colors={Gradients.dark} style={StyleSheet.absoluteFill} />
      <View style={styles.halo} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.logo}>
              <Text style={styles.logoEmoji}>🇳🇪</Text>
            </View>
            <Text style={styles.title}>
              Niger<Text style={styles.titleAccent}>Connect</Text>
            </Text>
            <Text style={styles.tagline}>LE RÉSEAU DE LA DIASPORA</Text>
          </View>

          <View style={styles.floatingWrap}>
            {FLOATING_FLAGS.map((a, i) => (
              <FloatingFlag key={i} delay={i} {...a} />
            ))}
          </View>

          <View style={styles.statsCard}>
            {stats.map((s) => (
              <View key={s.l} style={styles.statCol}>
                <Text style={[styles.statNumber, { color: s.color }]}>{s.n}</Text>
                <Text style={styles.statLabel}>{s.l}</Text>
              </View>
            ))}
          </View>

          <View style={styles.ctaBlock}>
            <Pressable
              onPress={() => router.push('/(auth)/register')}
              style={({ pressed }) => [styles.ctaPrimary, pressed && { opacity: 0.9 }]}
            >
              <LinearGradient
                colors={Gradients.orange}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.ctaPrimaryLabel}>Rejoindre la communauté</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/(auth)/login')}
              style={({ pressed }) => [styles.ctaSecondary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.ctaSecondaryLabel}>Se connecter</Text>
            </Pressable>
          </View>

          <View style={styles.flagsRow}>
            {flagEntries.map(([code, flag]) => (
              <Text key={code} style={styles.flag}>
                {flag}
              </Text>
            ))}
          </View>

          {__DEV__ && probe ? (
            <View
              style={[
                styles.devProbe,
                probe.ok ? styles.devProbeOk : styles.devProbeKo,
              ]}
            >
              <Text style={styles.devProbeTitle}>
                {probe.ok ? '✓ API joignable' : '✗ API injoignable'}
              </Text>
              <Text style={styles.devProbeText} numberOfLines={2}>
                {probe.baseUrl}
              </Text>
              <Text style={styles.devProbeText}>
                {probe.ok
                  ? `${probe.latencyMs}ms · db ${probe.checks.db} · redis ${probe.checks.redis}`
                  : probe.reason}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.brown },
  halo: {
    position: 'absolute',
    top: 60,
    left: '25%',
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(224,82,6,0.15)',
    opacity: 0.8,
  },
  scroll: {
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
  },
  hero: { alignItems: 'center', marginBottom: Spacing.xl },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  logoEmoji: { fontSize: 36 },
  title: {
    fontSize: Typography.sizes.hero,
    fontFamily: Typography.fontFamily.serifBlack,
    color: Colors.white,
    fontWeight: '900',
  },
  titleAccent: { color: Colors.orange },
  tagline: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: Typography.sizes.xs,
    letterSpacing: 4,
    marginTop: Spacing.sm,
    fontWeight: '600',
  },
  floatingWrap: {
    position: 'relative',
    height: 160,
    marginVertical: Spacing.xl,
  },
  floatingTile: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  statCol: { flex: 1, alignItems: 'center' },
  statNumber: { fontSize: Typography.sizes.xxl, fontWeight: '900' },
  statLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: Typography.sizes.xs,
    marginTop: 4,
    fontWeight: '500',
  },
  ctaBlock: { gap: Spacing.md, marginBottom: Spacing.xl },
  ctaPrimary: {
    height: 56,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  ctaPrimaryLabel: { color: Colors.white, fontSize: Typography.sizes.lg, fontWeight: '700' },
  ctaSecondary: {
    height: 56,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaSecondaryLabel: { color: Colors.white, fontSize: Typography.sizes.lg, fontWeight: '600' },
  flagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    opacity: 0.7,
  },
  flag: { fontSize: 20 },
  devProbe: {
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  devProbeOk: {
    backgroundColor: 'rgba(13,176,43,0.12)',
    borderColor: 'rgba(13,176,43,0.4)',
  },
  devProbeKo: {
    backgroundColor: 'rgba(192,57,43,0.18)',
    borderColor: 'rgba(192,57,43,0.5)',
  },
  devProbeTitle: {
    color: Colors.white,
    fontSize: Typography.sizes.xs,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  devProbeText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: Typography.sizes.xs,
    fontFamily: 'monospace',
  },
});
