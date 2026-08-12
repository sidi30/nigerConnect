import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import type { User } from '@nigerconnect/shared-types';
import { profileApi } from '@/services/profileApi';
import { useAuthStore } from '@/stores/authStore';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

/**
 * Réglages ▸ Notifications push. Tout est activé à l'inscription (le serveur
 * pose `true` par défaut) : le membre coupe ce qui le dérange, il n'a rien à
 * activer pour être prévenu.
 *
 * Ne concerne que ce qui fait vibrer le téléphone. La liste des notifications
 * dans l'app continue de tout enregistrer — couper « Réactions » ne fait pas
 * disparaître les mentions J'aime de l'historique.
 */

type PrefKey =
  | 'notifyMessages'
  | 'notifySocial'
  | 'notifyReactions'
  | 'notifyGroups'
  | 'notifyProximity';

const TOGGLES: { key: PrefKey; label: string; hint: string }[] = [
  {
    key: 'notifyMessages',
    label: 'Messages',
    hint: 'Quand quelqu’un t’écrit en privé.',
  },
  {
    key: 'notifySocial',
    label: 'Demandes d’ami',
    hint: 'Nouvelles demandes, demandes acceptées, invitations utilisées.',
  },
  {
    key: 'notifyReactions',
    label: 'Réactions à mes publications',
    hint: 'J’aime, commentaires, mentions et nouveaux sondages.',
  },
  {
    key: 'notifyGroups',
    label: 'Associations, pages & entraide',
    hint: 'Invitations et demandes d’adhésion, abonnés d’une page, réponses à une annonce, avis reçus.',
  },
  {
    key: 'notifyProximity',
    label: 'Membres à proximité',
    hint: 'Alertes de proximité, si tu les as activées dans Confidentialité.',
  },
];

export default function PushSettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  // Copie locale pour un basculement instantané ; on repart de l'état serveur
  // (tout `true` par défaut) quand le compte n'a pas encore la préférence.
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    notifyMessages: user?.notifyMessages ?? true,
    notifySocial: user?.notifySocial ?? true,
    notifyReactions: user?.notifyReactions ?? true,
    notifyGroups: user?.notifyGroups ?? true,
    notifyProximity: user?.notifyProximity ?? true,
  });

  const saveMut = useMutation({
    mutationFn: (input: Partial<Record<PrefKey, boolean>>) => profileApi.updateMe(input),
    onSuccess: (updated: User) => setUser(updated),
  });

  function toggle(key: PrefKey, value: boolean) {
    // Optimiste + rollback : hors ligne, l'interrupteur ne doit pas mentir sur
    // l'état réellement enregistré (même contrat que les réglages Confidentialité).
    const previous = prefs[key];
    setPrefs((p) => ({ ...p, [key]: value }));
    saveMut.mutate(
      { [key]: value },
      {
        onError: () => {
          setPrefs((p) => ({ ...p, [key]: previous }));
          Alert.alert('Erreur', 'Impossible de mettre à jour ce réglage. Réessaie.');
        },
      },
    );
  }

  const allOff = TOGGLES.every((t) => !prefs[t.key]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.hintCard}>
        <Feather name="bell" size={16} color={Colors.brown} style={styles.hintIcon} />
        <Text style={styles.hintText}>
          Tout est activé par défaut. Coupe ici ce que tu ne veux pas voir arriver sur
          ton téléphone — l&apos;historique dans l&apos;app, lui, reste complet.
        </Text>
      </View>

      <Text style={styles.section}>Me prévenir pour</Text>
      {TOGGLES.map((t) => (
        <View key={t.key} style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>{t.label}</Text>
            <Text style={styles.switchHint}>{t.hint}</Text>
          </View>
          <Switch
            value={prefs[t.key]}
            disabled={saveMut.isPending}
            onValueChange={(v) => toggle(t.key, v)}
            trackColor={{ false: Colors.tan300, true: Colors.orange }}
            thumbColor={Colors.white}
            accessibilityLabel={t.label}
          />
        </View>
      ))}

      {allOff ? (
        <View style={styles.hintCard}>
          <Feather name="bell-off" size={16} color={Colors.brown} style={styles.hintIcon} />
          <Text style={styles.hintText}>
            Tout est coupé : ton téléphone ne sonnera plus, même pour un message privé.
            Tu devras ouvrir l&apos;app pour voir ce qui s&apos;est passé.
          </Text>
        </View>
      ) : null}

      <Text style={styles.footnote}>
        Les messages de service — vérification d&apos;identité, sécurité du compte —
        te seront toujours envoyés. Les annonces NigerConnect et le résumé
        hebdomadaire se règlent dans Confidentialité.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  section: {
    fontSize: Typography.sizes.xs,
    fontWeight: '800',
    color: Colors.tan500,
    letterSpacing: 1,
    marginTop: Spacing.md,
    textTransform: 'uppercase',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md + 2,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  switchLabel: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  switchHint: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: Spacing.md,
    backgroundColor: Colors.peach50,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.orange,
  },
  hintIcon: { marginTop: 1 },
  hintText: { flex: 1, fontSize: Typography.sizes.xs + 1, color: Colors.brown, lineHeight: 18 },
  footnote: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
    lineHeight: 17,
    marginTop: Spacing.sm,
  },
});
