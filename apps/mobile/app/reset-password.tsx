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
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { authApi } from '@/services/authApi';

// Mirror of the backend reset-password rules (resetPasswordSchema): 12+ chars,
// one uppercase, one digit, one special character.
function passwordIssue(pw: string): string | null {
  if (pw.length < 12) return 'Au moins 12 caractères.';
  if (!/[A-Z]/.test(pw)) return 'Au moins une majuscule.';
  if (!/[0-9]/.test(pw)) return 'Au moins un chiffre.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Au moins un caractère spécial.';
  return null;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : undefined;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!token) {
      setError('Lien invalide. Redemande un email de réinitialisation.');
      return;
    }
    const issue = passwordIssue(password);
    if (issue) {
      setError(issue);
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(
        err.response?.data?.message ??
          err.message ??
          'Lien invalide ou expiré. Redemande un email de réinitialisation.',
      );
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
          <Text style={styles.title}>Nouveau mot de passe</Text>

          {done ? (
            <View style={styles.successCard}>
              <Feather
                name="check-circle"
                size={48}
                color={Colors.successDark}
                style={styles.successEmoji}
              />
              <Text style={styles.successTitle}>Mot de passe modifié</Text>
              <Text style={styles.successText}>
                Tu peux maintenant te connecter avec ton nouveau mot de passe.
              </Text>
              <Pressable style={styles.backBtn} onPress={() => router.replace('/(auth)/login')}>
                <Text style={styles.backBtnLabel}>Se connecter</Text>
              </Pressable>
            </View>
          ) : !token ? (
            <View style={styles.errorBanner}>
              <Feather name="alert-triangle" size={16} color={palette.errorText} style={styles.errorIcon} />
              <Text style={styles.errorText}>
                Lien invalide. Ouvre le lien reçu par email, ou redemande une réinitialisation.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.subtitle}>
                Choisis un nouveau mot de passe pour ton compte.
              </Text>

              {error ? (
                <View style={styles.errorBanner}>
                  <Feather name="alert-triangle" size={16} color={palette.errorText} style={styles.errorIcon} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>Nouveau mot de passe</Text>
                <TextInput
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (error) setError(null);
                  }}
                  placeholder="12+ caractères, 1 majuscule, 1 chiffre, 1 spécial"
                  placeholderTextColor={Colors.tan400}
                  style={styles.input}
                  secureTextEntry
                  autoCapitalize="none"
                  autoFocus
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Confirme le mot de passe</Text>
                <TextInput
                  value={confirm}
                  onChangeText={(t) => {
                    setConfirm(t);
                    if (error) setError(null);
                  }}
                  placeholder="Retape le mot de passe"
                  placeholderTextColor={Colors.tan400}
                  style={styles.input}
                  secureTextEntry
                  autoCapitalize="none"
                  onSubmitEditing={handleSubmit}
                />
              </View>

              <Pressable
                onPress={handleSubmit}
                disabled={loading || !password || !confirm}
                style={({ pressed }) => [
                  styles.submit,
                  (loading || pressed || !password || !confirm) && { opacity: 0.85 },
                ]}
              >
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <Text style={styles.submitLabel}>
                  {loading ? 'Enregistrement…' : 'Réinitialiser'}
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
  title: {
    fontSize: Typography.sizes.display,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xl,
  },
  subtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
    marginBottom: Spacing.xl,
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
    marginTop: Spacing.sm,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  submitLabel: { color: Colors.white, fontSize: Typography.sizes.lg, fontWeight: '700' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorIcon: { fontSize: 16 },
  errorText: { flex: 1, color: palette.errorText, fontSize: Typography.sizes.sm },
  successCard: {
    backgroundColor: Colors.successSoft,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    alignItems: 'center',
    marginTop: Spacing.lg,
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
