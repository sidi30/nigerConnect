import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { Colors, palette, Radii, Spacing, Typography } from '@/constants/theme';

const CONFIRMATION_WORD = 'SUPPRIMER';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);

  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmation.trim() === CONFIRMATION_WORD && !loading;

  async function onSubmit() {
    if (!canDelete) return;
    setLoading(true);
    setError(null);
    try {
      await deleteAccount();
      // AuthGate in _layout will redirect to welcome once isAuthenticated flips.
      router.replace('/(auth)/welcome');
    } catch (e) {
      const err = e as {
        response?: { data?: { message?: string | string[] } };
        message?: string;
      };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setError(msg ?? err.message ?? 'Suppression impossible. Réessaie.');
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Supprimer le compte</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.warnCard}>
            <Text style={styles.warnIcon}>⚠️</Text>
            <Text style={styles.warnTitle}>Cette action est définitive</Text>
            <Text style={styles.warnText}>
              La suppression de ton compte <Text style={styles.email}>{user?.email}</Text> entraîne
              la perte immédiate et irréversible de toutes tes données.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Ce qui sera supprimé</Text>
          <View style={styles.list}>
            {[
              'Ton profil, ta bio, tes photos, ta vérification d’identité',
              'Toutes tes publications, stories, commentaires, likes',
              'Tes amis et tes demandes d’amis (tes amis ne te verront plus)',
              'Tes messages et conversations',
              'Tes services, demandes et réponses marketplace',
              'Tes adhésions aux associations (si tu es le dernier admin, lègue le rôle avant)',
              'Tes notifications et tokens d’appareil',
            ].map((item) => (
              <View key={item} style={styles.listRow}>
                <Text style={styles.listBullet}>✕</Text>
                <Text style={styles.listItem}>{item}</Text>
              </View>
            ))}
          </View>

          <View style={styles.rgpdBox}>
            <Text style={styles.rgpdTitle}>Tes droits</Text>
            <Text style={styles.rgpdText}>
              Conformément au RGPD, tu peux exporter tes données avant suppression en nous
              contactant à <Text style={styles.email}>privacy@nigerconnect.ne</Text>. Sans action
              de ta part, la suppression est immédiate et aucune copie n’est conservée après
              30 jours (logs serveur anonymisés).
            </Text>
          </View>

          <Text style={styles.confirmLabel}>
            Tape <Text style={styles.confirmWord}>{CONFIRMATION_WORD}</Text> pour confirmer
          </Text>
          <TextInput
            value={confirmation}
            onChangeText={setConfirmation}
            placeholder={CONFIRMATION_WORD}
            placeholderTextColor={Colors.tan400}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
          />

          {error ? (
            <View
              style={styles.errorBanner}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={onSubmit}
            disabled={!canDelete}
            accessibilityRole="button"
            accessibilityLabel="Supprimer définitivement mon compte"
            style={({ pressed }) => [
              styles.deleteBtn,
              !canDelete && styles.deleteBtnDisabled,
              pressed && canDelete && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.deleteLabel}>
              {loading ? 'Suppression…' : '🗑️  Supprimer définitivement'}
            </Text>
          </Pressable>

          <Pressable onPress={() => router.back()} style={styles.keepBtn}>
            <Text style={styles.keepLabel}>Non, je garde mon compte</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
  },
  cancel: { color: Colors.tan500, fontSize: Typography.sizes.md, fontWeight: '600' },
  title: {
    fontSize: Typography.sizes.md + 1,
    fontWeight: '700',
    color: Colors.brown,
  },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  warnCard: {
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  warnIcon: { fontSize: 40 },
  warnTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: '800',
    color: palette.errorText,
  },
  warnText: {
    fontSize: Typography.sizes.sm,
    color: palette.errorText,
    textAlign: 'center',
    lineHeight: 20,
  },
  email: { fontWeight: '700' },
  sectionTitle: {
    fontSize: Typography.sizes.xs + 1,
    fontWeight: '800',
    color: Colors.tan600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  list: { gap: 6 },
  listRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  listBullet: {
    color: Colors.danger,
    fontSize: Typography.sizes.sm,
    fontWeight: '800',
    lineHeight: 20,
  },
  listItem: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.brown, lineHeight: 20 },
  rgpdBox: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.tan200,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  rgpdTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 4,
  },
  rgpdText: { fontSize: Typography.sizes.xs + 1, color: Colors.tan600, lineHeight: 18 },
  confirmLabel: {
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
    marginTop: Spacing.md,
    fontWeight: '600',
  },
  confirmWord: { fontWeight: '800', color: Colors.danger, letterSpacing: 1 },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.md,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.white,
    color: Colors.brown,
    letterSpacing: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
  },
  errorIcon: { fontSize: 16, lineHeight: 20 },
  errorText: {
    flex: 1,
    color: palette.errorText,
    fontSize: Typography.sizes.sm,
    fontWeight: '500',
    lineHeight: 20,
  },
  deleteBtn: {
    height: 54,
    borderRadius: Radii.lg,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
  },
  deleteBtnDisabled: { backgroundColor: palette.dangerMuted, opacity: 0.6 },
  deleteLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  keepBtn: { paddingVertical: Spacing.md, alignItems: 'center' },
  keepLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
});
