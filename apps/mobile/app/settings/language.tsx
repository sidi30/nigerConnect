import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

const LANGUAGES = [
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ha', name: 'Hausa', flag: '🇳🇪' },
  { code: 'zg', name: 'Zarma', flag: '🇳🇪' },
];

export default function LanguageScreen() {
  const [selected, setSelected] = useState('fr');

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>Langue de l&apos;application</Text>
      <View style={styles.group}>
        {LANGUAGES.map((l) => {
          const active = selected === l.code;
          return (
            <Pressable
              key={l.code}
              onPress={() => setSelected(l.code)}
              style={[styles.option, active && styles.optionActive]}
            >
              <Text style={styles.flag}>{l.flag}</Text>
              <Text style={[styles.name, active && { color: Colors.orange }]}>{l.name}</Text>
              {active && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        🚧 La traduction complète arrive bientôt. L&apos;app est actuellement en français.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  section: {
    fontSize: Typography.sizes.xs,
    fontWeight: '800',
    color: Colors.tan500,
    letterSpacing: 1,
    marginTop: Spacing.md,
    textTransform: 'uppercase',
  },
  group: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md + 2,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan200,
  },
  optionActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  flag: { fontSize: 26 },
  name: { flex: 1, fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  check: { color: Colors.orange, fontSize: 18, fontWeight: '900' },
  hint: {
    fontSize: Typography.sizes.xs + 1,
    color: Colors.tan500,
    textAlign: 'center',
    marginTop: Spacing.lg,
    lineHeight: 19,
  },
});
