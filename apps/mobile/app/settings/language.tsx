import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
              {active && <Feather name="check" size={18} color={Colors.orange} />}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.hintRow}>
        <Feather name="tool" size={14} color={Colors.tan500} />
        <Text style={styles.hint}>
          La traduction complète arrive bientôt. L&apos;app est actuellement en français.
        </Text>
      </View>
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
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.lg,
  },
  hint: {
    flex: 1,
    fontSize: Typography.sizes.xs + 1,
    color: Colors.tan500,
    lineHeight: 19,
  },
});
