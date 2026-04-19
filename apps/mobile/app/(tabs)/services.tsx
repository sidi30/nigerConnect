import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography } from '@/constants/theme';

export default function ServicesTab() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.placeholder}>
        <Text style={styles.emoji}>🤝</Text>
        <Text style={styles.title}>Entraide</Text>
        <Text style={styles.subtitle}>Le marketplace d&apos;entraide arrive bientôt.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  emoji: { fontSize: 72, marginBottom: Spacing.md },
  title: {
    fontSize: Typography.sizes.xxl,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  subtitle: { fontSize: Typography.sizes.md, color: Colors.gray500, textAlign: 'center' },
});
