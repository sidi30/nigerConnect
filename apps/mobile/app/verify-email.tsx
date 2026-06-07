import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { authApi } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The user types the 6-digit code from the email to activate the account.
  async function verifyCode() {
    if (code.length !== 6) {
      setError('Entre les 6 chiffres du code reçu par email.');
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      await authApi.verifyEmailCode(code);
      const { user: fresh } = await authApi.me();
      setUser(fresh);
      router.replace('/(tabs)' as never);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err.response?.data?.message ?? err.message ?? 'Code invalide. Réessaie.');
    } finally {
      setVerifying(false);
    }
  }

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

  async function signOut() {
    await logout();
    router.replace('/(auth)/welcome' as never);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.emoji}>📧</Text>
        <Text style={styles.title}>Active ton compte</Text>
        <Text style={styles.subtitle}>
          Nous avons envoyé un code à{' '}
          <Text style={styles.email}>{user?.email ?? 'ton adresse'}</Text>. Saisis-le
          ci-dessous pour activer ton compte.
        </Text>

        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => {
            setCode(t.replace(/\D/g, '').slice(0, 6));
            if (error) setError(null);
            if (sent) setSent(false);
          }}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={Colors.tan400}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          returnKeyType="done"
          onSubmitEditing={verifyCode}
        />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pas reçu ?</Text>
          <Text style={styles.cardText}>
            Vérifie tes spams. Le code expire dans 24h. Tu peux en demander un nouveau
            ci-dessous.
          </Text>
        </View>

        {sent ? (
          <View style={styles.successBanner}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successText}>
              Nouveau code envoyé. Pense à vérifier tes spams.
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
          onPress={verifyCode}
          disabled={verifying || code.length !== 6}
          style={({ pressed }) => [
            styles.primary,
            (verifying || pressed) && { opacity: 0.85 },
            code.length !== 6 && { opacity: 0.5 },
          ]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.primaryLabel}>
            {verifying ? 'Vérification…' : 'Valider le code'}
          </Text>
        </Pressable>

        <Pressable
          onPress={resend}
          disabled={loading}
          style={({ pressed }) => [styles.secondary, (loading || pressed) && { opacity: 0.85 }]}
        >
          <Text style={styles.secondaryLabel}>
            {loading ? 'Envoi…' : 'Renvoyer le code'}
          </Text>
        </Pressable>


        <Pressable onPress={signOut} style={styles.skip} hitSlop={8}>
          <Text style={styles.skipLabel}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  scroll: { flexGrow: 1, padding: Spacing.xl },
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
  codeInput: {
    height: 64,
    borderRadius: Radii.xl,
    borderWidth: 1.5,
    borderColor: Colors.tan200,
    backgroundColor: Colors.white,
    color: Colors.brown,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
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
  secondary: {
    height: 52,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.tan200,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
  },
  secondaryLabel: { color: Colors.brown, fontSize: Typography.sizes.md, fontWeight: '700' },
  skip: { alignItems: 'center', marginTop: Spacing.lg, padding: Spacing.md },
  skipLabel: { color: Colors.tan500, fontSize: Typography.sizes.sm, fontWeight: '600' },
});
