import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

const ITEMS: Array<{ icon: string; title: string; desc: string; href: Href }> = [
  {
    icon: '📜',
    title: 'Conditions d’utilisation',
    desc: 'Ce que tu acceptes en utilisant NigerConnect.',
    href: '/legal/terms' as Href,
  },
  {
    icon: '🔐',
    title: 'Politique de confidentialité',
    desc: 'Quelles données on collecte et pourquoi.',
    href: '/legal/privacy' as Href,
  },
  {
    icon: '🤝',
    title: 'Règles de la communauté',
    desc: 'Comportement attendu, tolérance zéro sur certains contenus.',
    href: '/legal/community' as Href,
  },
];

export default function LegalIndex() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.title}>Informations légales</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {ITEMS.map((item) => (
          <Pressable key={item.title} style={styles.card} onPress={() => router.push(item.href)}>
            <Text style={styles.icon}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc}>{item.desc}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        <Text style={styles.version}>Version de l’app 0.1.0</Text>
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
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
    borderRadius: Radii.lg,
    padding: Spacing.md + 2,
  },
  icon: { fontSize: 28 },
  cardTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
  },
  cardDesc: {
    fontSize: Typography.sizes.xs + 1,
    color: Colors.tan500,
    marginTop: 2,
    lineHeight: 17,
  },
  chevron: { fontSize: 22, color: Colors.tan400 },
  version: {
    textAlign: 'center',
    color: Colors.tan400,
    fontSize: Typography.sizes.xs,
    marginTop: Spacing.xl,
  },
});
