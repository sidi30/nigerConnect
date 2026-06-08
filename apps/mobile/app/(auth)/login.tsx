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
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { useAuthStore } from '@/stores/authStore';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { AppleButton } from '@/components/ui/AppleButton';

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit() {
    setErrorMessage(null);
    if (!email.trim() || !password) {
      setErrorMessage('Renseigne ton email et ton mot de passe.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (error) {
      const err = error as {
        response?: { data?: { message?: string | string[] } };
        message?: string;
        code?: string;
      };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      const isNetwork =
        err.code === 'ERR_NETWORK' || err.message === 'Network Error' || !err.response;
      setErrorMessage(
        msg ??
          (isNetwork
            ? "Impossible de joindre le serveur. Vérifie ta connexion ou que l'API tourne."
            : err.message ?? 'Une erreur est survenue. Réessaie.'),
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
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
              <Feather name="arrow-left" size={22} color={Colors.brown} />
            </Pressable>
          </View>

          <View style={styles.logoRow}>
            <Text style={styles.flag}>🇳🇪</Text>
            <Text style={styles.brand}>
              Niger<Text style={styles.brandAccent}>Connect</Text>
            </Text>
          </View>

          <Text style={styles.title}>Bon retour !</Text>
          <Text style={styles.subtitle}>Connecte-toi pour retrouver la diaspora.</Text>

          <View style={styles.form}>
            <View>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (errorMessage) setErrorMessage(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                placeholder="ex : nom@email.com"
                placeholderTextColor={Colors.tan400}
                style={styles.fieldInput}
              />
            </View>

            <View>
              <Text style={styles.fieldLabel}>Mot de passe</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  placeholder="••••••••"
                  placeholderTextColor={Colors.tan400}
                  style={[styles.fieldInput, styles.passwordInput]}
                />
                <Pressable
                  onPress={() => setShowPassword((s) => !s)}
                  hitSlop={12}
                  style={styles.eyeBtn}
                  accessibilityLabel={
                    showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
                  }
                  accessibilityRole="button"
                >
                  <Feather
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color={Colors.tan500}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              hitSlop={8}
              onPress={() => router.push('/(auth)/forgot-password' as never)}
            >
              <Text style={styles.forgotLink}>Mot de passe oublié ?</Text>
            </Pressable>
          </View>

          {errorMessage ? (
            <View style={styles.errorBanner} accessibilityLiveRegion="polite" accessibilityRole="alert">
              <Feather name="alert-triangle" size={16} color={palette.errorText} style={styles.errorIcon} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={onSubmit}
            disabled={loading}
            style={({ pressed }) => [styles.submit, (loading || pressed) && { opacity: 0.85 }]}
          >
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            <Text style={styles.submitLabel}>{loading ? 'Connexion…' : 'Se connecter'}</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={{ marginBottom: Spacing.md, gap: Spacing.sm }}>
            <AppleButton mode="signIn" />
            <GoogleButton />
          </View>

          <Link href="/(auth)/register" asChild>
            <Pressable>
              <Text style={styles.switchText}>
                Pas encore de compte ? <Text style={styles.switchAccent}>S&apos;inscrire</Text>
              </Text>
            </Pressable>
          </Link>
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
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Spacing.xxl },
  flag: { fontSize: 24 },
  brand: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontFamily.serifBlack,
    color: Colors.brown,
  },
  brandAccent: { color: Colors.orange },
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
  },
  form: { gap: Spacing.md, marginBottom: Spacing.xl },
  fieldLabel: {
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
    color: Colors.brown,
    marginBottom: 6,
  },
  fieldInput: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.white,
    color: Colors.brown,
  },
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 52 },
  eyeBtn: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginBottom: Spacing.lg,
  },
  errorIcon: { fontSize: 16, lineHeight: 20 },
  errorText: {
    flex: 1,
    color: palette.errorText,
    fontSize: Typography.sizes.sm,
    fontWeight: '500',
    lineHeight: 20,
  },
  submit: {
    height: 56,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
    shadowColor: Colors.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  submitLabel: {
    color: Colors.white,
    fontSize: Typography.sizes.lg,
    fontWeight: '700',
  },
  switchText: {
    textAlign: 'center',
    color: Colors.tan500,
    fontSize: Typography.sizes.sm,
  },
  switchAccent: { color: Colors.orange, fontWeight: '700' },
  forgotLink: {
    color: Colors.orange,
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
    textAlign: 'right',
    marginTop: -Spacing.sm,
    marginBottom: Spacing.sm,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
    marginTop: -Spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.tan300 },
  dividerText: {
    marginHorizontal: Spacing.md,
    color: Colors.tan500,
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
  },
});
