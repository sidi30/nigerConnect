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
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { authApi } from '@/services/authApi';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch {
      // Silently succeed: backend returns 204 regardless (anti-enumeration)
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
              <Text style={styles.backIcon}>←</Text>
            </Pressable>
          </View>

          <Text style={styles.title}>Mot de passe oublié</Text>
          <Text style={styles.subtitle}>
            Entre ton email, nous t&apos;enverrons un lien pour le réinitialiser.
          </Text>

          {sent ? (
            <View style={styles.successCard}>
              <Text style={styles.successEmoji}>📬</Text>
              <Text style={styles.successTitle}>Email envoyé</Text>
              <Text style={styles.successText}>
                Si un compte existe pour cette adresse, tu recevras un lien de réinitialisation
                d&apos;ici quelques minutes. Valable 1 heure.
              </Text>
              <Pressable
                style={styles.backBtn}
                onPress={() => router.replace('/(auth)/login')}
              >
                <Text style={styles.backBtnLabel}>Retour à la connexion</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="nom@email.com"
                  placeholderTextColor={Colors.tan400}
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoFocus
                />
              </View>

              <Pressable
                onPress={handleSubmit}
                disabled={!email.trim() || loading}
                style={({ pressed }) => [
                  styles.submit,
                  (!email.trim() || loading || pressed) && { opacity: 0.85 },
                ]}
              >
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <Text style={styles.submitLabel}>
                  {loading ? 'Envoi…' : 'Envoyer le lien'}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  title: {
    fontSize: Typography.sizes.display,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
    marginBottom: Spacing.xxl,
    lineHeight: 22,
  },
  field: { marginBottom: Spacing.lg },
  label: {
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
    color: Colors.brown,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.white,
    color: Colors.brown,
  },
  submit: {
    height: 56,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  submitLabel: { color: Colors.white, fontSize: Typography.sizes.lg, fontWeight: '700' },
  successCard: {
    backgroundColor: Colors.successSoft,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  successEmoji: { fontSize: 56, marginBottom: Spacing.md },
  successTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: '800',
    color: Colors.successDark,
    marginBottom: Spacing.sm,
  },
  successText: {
    fontSize: Typography.sizes.sm,
    color: Colors.successDark,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  backBtn: { padding: Spacing.md },
  backBtnLabel: { color: Colors.successDark, fontWeight: '700', fontSize: Typography.sizes.md },
});
