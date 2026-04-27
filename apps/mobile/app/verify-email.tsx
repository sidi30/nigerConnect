import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { authApi } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setLoading(true);
    setError(null);
    try {
      await authApi.resendVerification();
      setSent(true);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(
        err.response?.data?.message ?? err.message ?? "Impossible d'envoyer l'email. Réessaie.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        </View>

        <Text style={styles.emoji}>📧</Text>
        <Text style={styles.title}>Vérifie ton email</Text>
        <Text style={styles.subtitle}>
          Nous avons envoyé un lien à{' '}
          <Text style={styles.email}>{user?.email ?? 'ton adresse'}</Text>. Clique dessus
          pour confirmer ton compte.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pas reçu ?</Text>
          <Text style={styles.cardText}>
            Vérifie tes spams. Le lien expire dans 24h. Tu peux en demander un nouveau
            ci-dessous.
          </Text>
        </View>

        {sent ? (
          <View style={styles.successBanner}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successText}>
              Nouveau lien envoyé. Pense à vérifier tes spams.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={resend}
          disabled={loading}
          style={({ pressed }) => [styles.primary, (loading || pressed) && { opacity: 0.85 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.primaryLabel}>
            {loading ? 'Envoi…' : 'Renvoyer le lien'}
          </Text>
        </Pressable>

        <Pressable onPress={() => router.replace('/(tabs)' as never)} style={styles.skip} hitSlop={8}>
          <Text style={styles.skipLabel}>Plus tard →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  scroll: { flexGrow: 1, padding: Spacing.xl },
  topRow: { marginBottom: Spacing.lg },
  back: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, color: Colors.brown },
  emoji: { fontSize: 56, textAlign: 'center', marginVertical: Spacing.lg },
  title: {
    fontSize: Typography.sizes.display,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  email: { fontWeight: '700', color: Colors.brown },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  cardTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
    marginBottom: 6,
  },
  cardText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    lineHeight: 20,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.successSoft,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  successIcon: { fontSize: 18 },
  successText: { flex: 1, color: Colors.successDark, fontSize: Typography.sizes.sm },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  errorIcon: { fontSize: 16 },
  errorText: { flex: 1, color: palette.errorText, fontSize: Typography.sizes.sm },
  primary: {
    height: 56,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  primaryLabel: { color: Colors.white, fontSize: Typography.sizes.lg, fontWeight: '700' },
  skip: { alignItems: 'center', marginTop: Spacing.lg, padding: Spacing.md },
  skipLabel: { color: Colors.tan500, fontSize: Typography.sizes.sm, fontWeight: '600' },
});
