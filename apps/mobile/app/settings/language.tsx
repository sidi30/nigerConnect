import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { profileApi } from '@/services/profileApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

// `translated` marks the languages the interface itself is already available in.
// The others can still be picked: the choice is stored on the profile, which is
// what tells us which translation to ship first.
const LANGUAGES = [
  { code: 'fr', name: 'Français', flag: '🇫🇷', translated: true },
  { code: 'en', name: 'English', flag: '🇬🇧', translated: false },
  { code: 'ha', name: 'Hausa', flag: '🇳🇪', translated: false },
  { code: 'zg', name: 'Zarma', flag: '🇳🇪', translated: false },
];

export default function LanguageScreen() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  // `languages` is an array server-side (a member may speak several); this screen
  // sets the preferred one, which is the head of the list.
  const [selected, setSelected] = useState(user?.languages?.[0] ?? 'fr');

  const saveMut = useMutation({
    mutationFn: (code: string) => profileApi.updateMe({ languages: [code] }),
    onSuccess: (updated) => setUser(updated),
    onError: (_err, code) => {
      // Roll back to what the profile still holds — the toggle must never claim
      // a preference the server did not record.
      setSelected(user?.languages?.[0] ?? 'fr');
      toast.error(`Impossible d'enregistrer la langue (${code}).`);
    },
  });

  const pick = (code: string) => {
    if (code === selected || saveMut.isPending) return;
    setSelected(code);
    saveMut.mutate(code);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>Langue de l&apos;application</Text>
      <View style={styles.group}>
        {LANGUAGES.map((l) => {
          const active = selected === l.code;
          return (
            <Pressable
              key={l.code}
              onPress={() => pick(l.code)}
              disabled={saveMut.isPending}
              style={[styles.option, active && styles.optionActive]}
            >
              <Text style={styles.flag}>{l.flag}</Text>
              <View style={styles.labels}>
                <Text style={[styles.name, active && { color: Colors.orange }]}>{l.name}</Text>
                {!l.translated && <Text style={styles.soon}>Traduction en préparation</Text>}
              </View>
              {active &&
                (saveMut.isPending ? (
                  <ActivityIndicator size="small" color={Colors.orange} />
                ) : (
                  <Feather name="check" size={18} color={Colors.orange} />
                ))}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.hintRow}>
        <Feather name="info" size={14} color={Colors.tan500} />
        <Text style={styles.hint}>
          Ton choix est enregistré sur ton profil. L&apos;interface reste en français pour
          l&apos;instant — les langues les plus demandées seront traduites en premier.
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
  labels: { flex: 1, gap: 2 },
  name: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  soon: { fontSize: Typography.sizes.xs, color: Colors.tan500 },
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
