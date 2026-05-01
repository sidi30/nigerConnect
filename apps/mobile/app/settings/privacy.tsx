import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { blocksApi } from '@/services/blocksApi';
import { profileApi } from '@/services/profileApi';
import { useAuthStore } from '@/stores/authStore';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId } from '@/constants/lookups';

export default function PrivacyScreen() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  const [privacyLevel, setPrivacyLevel] = useState(user?.privacyLevel ?? 'friends');
  const [showOnMap, setShowOnMap] = useState(user?.showOnMap ?? true);

  const blocksQuery = useQuery({
    queryKey: ['blocks'],
    queryFn: () => blocksApi.list(),
  });

  const savePrivacyMut = useMutation({
    mutationFn: (input: { privacyLevel: 'public' | 'friends' | 'private'; showOnMap: boolean }) =>
      profileApi.updateMe(input as never),
    onSuccess: (updated) => {
      setUser(updated);
    },
  });

  const unblockMut = useMutation({
    mutationFn: (userId: string) => blocksApi.unblock(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blocks'] }),
  });

  function savePrivacy(level: 'public' | 'friends' | 'private', mapVisible: boolean) {
    setPrivacyLevel(level);
    setShowOnMap(mapVisible);
    savePrivacyMut.mutate({ privacyLevel: level, showOnMap: mapVisible });
  }

  if (!user) return null;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>Qui peut voir mon profil</Text>
      <View style={styles.group}>
        {(
          [
            { id: 'public' as const, emoji: '🌍', label: 'Public', desc: 'Tout le monde peut voir mon profil' },
            { id: 'friends' as const, emoji: '👥', label: 'Amis', desc: 'Seuls mes amis peuvent voir mon profil' },
            { id: 'private' as const, emoji: '🔒', label: 'Privé', desc: 'Personne ne peut voir mon profil' },
          ] as const
        ).map((opt) => {
          const active = privacyLevel === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => savePrivacy(opt.id, showOnMap)}
              style={[styles.option, active && styles.optionActive]}
            >
              <Text style={styles.optionEmoji}>{opt.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionLabel, active && { color: Colors.orange }]}>
                  {opt.label}
                </Text>
                <Text style={styles.optionDesc}>{opt.desc}</Text>
              </View>
              {active && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.section}>Apparaître sur la carte</Text>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Afficher mon avatar</Text>
          <Text style={styles.switchHint}>
            Quand désactivé, tu n&apos;apparais plus sur la Snap Map.
          </Text>
        </View>
        <Switch
          value={showOnMap}
          onValueChange={(v) => savePrivacy(privacyLevel as 'public' | 'friends' | 'private', v)}
          trackColor={{ false: Colors.tan300, true: Colors.orange }}
          thumbColor={Colors.white}
        />
      </View>

      <Text style={styles.section}>Mes données (RGPD)</Text>
      <Pressable
        onPress={async () => {
          try {
            const data = await profileApi.exportMyData();
            const json = JSON.stringify(data, null, 2);
            const sizeKb = Math.round(new TextEncoder().encode(json).length / 1024);
            Alert.alert(
              'Export prêt',
              `Tes données ont été récupérées (${sizeKb} Ko). Une copie a été envoyée à ton adresse email pour archivage.\n\nTu peux aussi écrire à privacy@nigerconnect.ne pour recevoir un export hors-ligne.`,
            );
          } catch (e) {
            const msg = (e as Error).message ?? "Échec de l'export";
            Alert.alert('Export impossible', msg);
          }
        }}
        style={styles.exportBtn}
      >
        <Text style={styles.exportEmoji}>📦</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.exportLabel}>Exporter mes données</Text>
          <Text style={styles.exportDesc}>
            Télécharge tout ce que NigerConnect connaît de toi (RGPD article 20).
          </Text>
        </View>
        <Text style={styles.exportChevron}>›</Text>
      </Pressable>

      <Text style={styles.section}>Utilisateurs bloqués</Text>
      {blocksQuery.isLoading ? (
        <ActivityIndicator color={Colors.orange} />
      ) : (blocksQuery.data ?? []).length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucun utilisateur bloqué.</Text>
        </View>
      ) : (
        <View style={styles.group}>
          {blocksQuery.data!.map((b) => (
            <View key={b.blockedId} style={styles.blockedRow}>
              <Avatar
                uri={b.blocked.avatarUrl}
                name={b.blocked.displayName ?? 'N'}
                size={44}
                borderColor={colorForId(b.blocked.id)}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.blockedName}>
                  {b.blocked.displayName ??
                    `${b.blocked.firstName ?? ''} ${b.blocked.lastName ?? ''}`.trim()}
                </Text>
                <Text style={styles.blockedMeta}>
                  Bloqué le {new Date(b.createdAt).toLocaleDateString('fr-FR')}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  Alert.alert('Débloquer ?', 'Cet utilisateur pourra à nouveau te contacter.', [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Débloquer', onPress: () => unblockMut.mutate(b.blockedId) },
                  ])
                }
                style={styles.unblockBtn}
              >
                <Text style={styles.unblockLabel}>Débloquer</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
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
  optionEmoji: { fontSize: 24 },
  optionLabel: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  optionDesc: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  check: { color: Colors.orange, fontSize: 18, fontWeight: '900' },
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
  emptyCard: {
    padding: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  emptyText: { color: Colors.tan500, textAlign: 'center' },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  blockedName: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.brown },
  blockedMeta: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.danger,
  },
  unblockLabel: { color: Colors.danger, fontSize: Typography.sizes.xs + 1, fontWeight: '700' },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md + 2,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  exportEmoji: { fontSize: 24 },
  exportLabel: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  exportDesc: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  exportChevron: { fontSize: 22, color: Colors.tan400 },
});
