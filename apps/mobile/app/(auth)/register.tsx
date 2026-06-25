import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Colors,
  Gradients,
  palette,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';
import { countryName } from '@/constants/countries';
import { useAuthStore } from '@/stores/authStore';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { AppleButton } from '@/components/ui/AppleButton';
import { CitySearchField } from '@/components/ui/CitySearchField';
import { invitationsApi, type RegistrationMode } from '@/services/invitationsApi';

interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  city: string;
  bio: string;
  countryCode: string;
  /** WGS-84 latitude from the /geo/cities autocomplete. Undefined when the
   *  user typed a free-text city without selecting an API suggestion. */
  latitude: number | undefined;
  /** WGS-84 longitude from the /geo/cities autocomplete. */
  longitude: number | undefined;
}

// ── Registration-mode gate states ────────────────────────────────────────────
// 'loading'       → fetching /auth/registration-mode
// 'closed'        → show "Inscriptions fermées" screen
// 'invite_check'  → invite_only mode, step 0: enter/validate code
// 'wizard'        → either open mode or validated invite code → show normal wizard
type GateState = 'loading' | 'closed' | 'invite_check' | 'wizard';

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const register = useAuthStore((s) => s.register);

  // ── Gate state ───────────────────────────────────────────────────────────
  const [gateState, setGateState] = useState<GateState>('loading');
  const [modeError, setModeError] = useState<string | null>(null);

  // ── Invite-code step 0 ───────────────────────────────────────────────────
  const [inviteCode, setInviteCode] = useState<string>(params.code ?? '');
  const [inviteCheckLoading, setInviteCheckLoading] = useState(false);
  const [inviteCheckError, setInviteCheckError] = useState<string | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);
  // Validated code that gets threaded through to the API
  const [validatedCode, setValidatedCode] = useState<string | null>(
    // If the deep-link pre-filled a code we auto-validate it on mount
    null,
  );

  // ── Wizard state ─────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [data, setData] = useState<RegisterData>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    city: '',
    bio: '',
    countryCode: '',
    latitude: undefined,
    longitude: undefined,
  });

  // ── Fetch registration mode on mount ─────────────────────────────────────
  useEffect(() => {
    let active = true;
    invitationsApi
      .getRegistrationMode()
      .then((mode: RegistrationMode) => {
        if (!active) return;
        if (mode === 'closed') {
          setGateState('closed');
        } else if (mode === 'invite_only') {
          setGateState('invite_check');
          // Auto-validate if a code was passed via deep-link
          if (params.code) {
            validateCode(params.code);
          }
        } else {
          // open
          setGateState('wizard');
        }
      })
      .catch(() => {
        if (!active) return;
        // On error, fall back to open mode so users aren't blocked
        setModeError(
          'Impossible de vérifier le mode d\'inscription — accès libre activé.',
        );
        setGateState('wizard');
      });
    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function validateCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) {
      setInviteCheckError('Saisis ton code d\'invitation.');
      return;
    }
    setInviteCheckLoading(true);
    setInviteCheckError(null);
    setInviterName(null);
    try {
      const result = await invitationsApi.checkCode(trimmed);
      if (!result.valid) {
        setInviteCheckError('Code invalide ou expiré. Demande un nouveau lien à ton parrain.');
        return;
      }
      setInviterName(result.inviterName ?? null);
      setValidatedCode(trimmed);
      // Small delay so the user sees the success message before the wizard opens
      setTimeout(() => setGateState('wizard'), 900);
    } catch {
      setInviteCheckError('Impossible de vérifier le code. Réessaie.');
    } finally {
      setInviteCheckLoading(false);
    }
  }

  function update<K extends keyof RegisterData>(key: K, value: RegisterData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
    if (errorMessage) setErrorMessage(null);
  }

  function validateStep1(): string | null {
    if (!data.firstName.trim()) return 'Le prénom est requis';
    if (!data.lastName.trim()) return 'Le nom est requis';
    if (!data.email.trim()) return "L'email est requis";
    if (!/^\S+@\S+\.\S+$/.test(data.email)) return 'Email invalide';
    if (data.password.length < 12) return 'Mot de passe : min 12 caractères';
    if (!/[A-Z]/.test(data.password)) return 'Mot de passe : 1 majuscule requise';
    if (!/[0-9]/.test(data.password)) return 'Mot de passe : 1 chiffre requis';
    if (!/[^A-Za-z0-9]/.test(data.password)) return 'Mot de passe : 1 caractère spécial requis';
    return null;
  }

  function next() {
    setErrorMessage(null);
    if (step === 1) {
      const err = validateStep1();
      if (err) {
        setErrorMessage(err);
        return;
      }
    }
    if (step === 2 && !data.countryCode) {
      setErrorMessage('Sélectionne ton pays actuel.');
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  }

  async function submit() {
    setErrorMessage(null);
    if (!data.countryCode) {
      setStep(2);
      setErrorMessage('Sélectionne ta ville et ton pays.');
      return;
    }
    setLoading(true);
    try {
      await register({
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
        city: data.city.trim() || undefined,
        countryCode: data.countryCode || undefined,
        bio: data.bio.trim() || undefined,
        latitude: data.latitude,
        longitude: data.longitude,
        inviteCode: validatedCode ?? undefined,
      });
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

  // ── Render: loading ───────────────────────────────────────────────────────
  if (gateState === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={gateStyles.centerFill}>
          <ActivityIndicator size="large" color={Colors.orange} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: closed ────────────────────────────────────────────────────────
  if (gateState === 'closed') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.back}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={20} color={Colors.brown} />
          </Pressable>
          <Text style={styles.headerTitle}>Inscription</Text>
          <View style={{ width: 36 }} />
        </View>
        <ScrollView contentContainerStyle={gateStyles.scroll}>
          <View style={gateStyles.iconCircle}>
            <Feather name="lock" size={36} color={Colors.tan500} />
          </View>
          <Text style={gateStyles.heading}>Inscriptions momentanément fermées</Text>
          <Text style={gateStyles.body}>
            NigerConnect est en maintenance ou a temporairement suspendu les nouvelles
            inscriptions. Les membres existants continuent d'accéder au réseau normalement.
          </Text>
          <Text style={gateStyles.body}>
            Reviens bientôt ou contacte-nous à{' '}
            <Text style={gateStyles.link}>contact@nigerconnect.app</Text> pour rejoindre la
            liste d'attente.
          </Text>
          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={({ pressed }) => [gateStyles.secondaryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={gateStyles.secondaryBtnLabel}>Se connecter</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Render: invite_check (step 0) ─────────────────────────────────────────
  if (gateState === 'invite_check') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.back}
            hitSlop={12}
          >
            <Feather name="arrow-left" size={20} color={Colors.brown} />
          </Pressable>
          <Text style={styles.headerTitle}>Inscription</Text>
          <View style={{ width: 36 }} />
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={[styles.scroll, gateStyles.inviteScroll]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={gateStyles.iconCircle}>
              <Feather name="gift" size={36} color={Colors.orange} />
            </View>
            <Text style={gateStyles.heading}>Code d'invitation requis</Text>
            <Text style={gateStyles.body}>
              NigerConnect fonctionne sur invitation. Saisis le code que ton parrain t'a envoyé.
            </Text>

            {/* Success banner */}
            {inviterName ? (
              <View style={gateStyles.successBanner}>
                <Feather name="check-circle" size={18} color={Colors.green} />
                <Text style={gateStyles.successText}>
                  {inviterName} t'invite sur NigerConnect
                </Text>
              </View>
            ) : null}

            {/* Code input */}
            <View style={{ marginBottom: Spacing.md }}>
              <Text style={styles.label}>Code d'invitation</Text>
              <TextInput
                value={inviteCode}
                onChangeText={(v) => {
                  setInviteCode(v);
                  setInviteCheckError(null);
                  setInviterName(null);
                  setValidatedCode(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="Ex : A3X7K2"
                placeholderTextColor={Colors.tan400}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={() => validateCode(inviteCode)}
                editable={!inviteCheckLoading && !validatedCode}
              />
            </View>

            {/* Error */}
            {inviteCheckError ? (
              <View
                style={registerExtras.errorBanner}
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
              >
                <Feather
                  name="alert-triangle"
                  size={16}
                  color={palette.errorText}
                  style={registerExtras.errorIcon}
                />
                <Text style={registerExtras.errorText}>{inviteCheckError}</Text>
              </View>
            ) : null}

            {modeError ? (
              <Text style={gateStyles.modeErrorNote}>{modeError}</Text>
            ) : null}

            <Pressable
              onPress={() => validateCode(inviteCode)}
              disabled={inviteCheckLoading || !!validatedCode}
              style={({ pressed }) => [
                styles.primary,
                (inviteCheckLoading || !!validatedCode || pressed) && { opacity: 0.85 },
              ]}
            >
              <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
              {inviteCheckLoading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.primaryLabel}>
                  {validatedCode ? 'Code validé ✓' : 'Valider le code'}
                </Text>
              )}
            </Pressable>

            {/* OAuth buttons also carry the validated code */}
            {validatedCode ? (
              <View style={{ gap: Spacing.sm, marginTop: Spacing.md }}>
                <AppleButton
                  mode="signUp"
                  inviteCode={validatedCode}
                />
                <GoogleButton
                  label="S'inscrire avec Google"
                  inviteCode={validatedCode}
                />
              </View>
            ) : null}

            <Link href="/(auth)/login" asChild>
              <Pressable style={{ marginTop: Spacing.md }}>
                <Text style={styles.link}>
                  Déjà un compte ? <Text style={styles.linkAccent}>Se connecter</Text>
                </Text>
              </Pressable>
            </Link>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Render: wizard (normal registration flow) ─────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (step > 1 ? setStep(step - 1) : router.back())}
          style={styles.back}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={20} color={Colors.brown} />
        </Pressable>
        <Text style={styles.headerTitle}>Inscription</Text>
        <Text style={styles.stepCounter}>{step}/3</Text>
      </View>

      <View style={styles.progressWrap}>
        {[1, 2, 3].map((s) => (
          <View
            key={s}
            style={[
              styles.progressBar,
              s <= step ? styles.progressBarActive : styles.progressBarIdle,
            ]}
          />
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === 1 && (
            <View>
              <View style={registerExtras.titleRow}>
                <Feather name="user" size={26} color={Colors.brown} />
                <Text style={styles.title}>Ton profil</Text>
              </View>
              <Text style={styles.subtitle}>
                Commençons par les infos de base — tu pourras tout modifier plus tard.
              </Text>

              <View style={{ marginBottom: Spacing.lg, gap: Spacing.sm }}>
                <AppleButton mode="signUp" inviteCode={validatedCode ?? undefined} />
                <GoogleButton label="S'inscrire avec Google" inviteCode={validatedCode ?? undefined} />
              </View>
              <View style={registerExtras.divider}>
                <View style={registerExtras.line} />
                <Text style={registerExtras.dividerText}>ou avec ton email</Text>
                <View style={registerExtras.line} />
              </View>

              <Field
                label="Prénom"
                value={data.firstName}
                onChangeText={(v) => update('firstName', v)}
                placeholder="Ex : Aïcha"
              />
              <Field
                label="Nom"
                value={data.lastName}
                onChangeText={(v) => update('lastName', v)}
                placeholder="Ex : Maïga"
              />
              <Field
                label="Email"
                value={data.email}
                onChangeText={(v) => update('email', v)}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="nom@email.com"
              />
              <View style={{ marginBottom: Spacing.md }}>
                <Text style={styles.label}>Mot de passe</Text>
                <View style={registerExtras.passwordWrap}>
                  <TextInput
                    value={data.password}
                    onChangeText={(v) => update('password', v)}
                    secureTextEntry={!showPassword}
                    autoComplete="password-new"
                    placeholder="12+ car., 1 maj, 1 chiffre, 1 spécial"
                    placeholderTextColor={Colors.tan400}
                    style={[styles.input, registerExtras.passwordInput]}
                  />
                  <Pressable
                    onPress={() => setShowPassword((s) => !s)}
                    hitSlop={12}
                    style={registerExtras.eyeBtn}
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
              <Field
                label="Bio (facultatif)"
                value={data.bio}
                onChangeText={(v) => update('bio', v)}
                placeholder="Ingénieur • Passionné de culture…"
                multiline
              />
            </View>
          )}

          {step === 2 && (
            <View>
              <View style={registerExtras.titleRow}>
                <Feather name="globe" size={26} color={Colors.brown} />
                <Text style={styles.title}>Ta ville</Text>
              </View>
              <Text style={styles.subtitle}>Où vis-tu actuellement ?</Text>
              <CitySearchField
                label="Ville"
                city={data.city}
                countryCode={data.countryCode}
                onChange={(city, countryCode, lat, lng) => {
                  setData((prev) => ({
                    ...prev,
                    city,
                    countryCode,
                    latitude: lat,
                    longitude: lng,
                  }));
                  if (errorMessage) setErrorMessage(null);
                }}
              />
            </View>
          )}

          {step === 3 && (
            <View>
              <View style={registerExtras.titleRow}>
                <Feather name="check-circle" size={26} color={Colors.brown} />
                <Text style={styles.title}>Vérification</Text>
              </View>
              <Text style={styles.subtitle}>
                La vérification d&apos;identité est facultative pour commencer. Tu pourras
                l&apos;ajouter plus tard pour obtenir le badge ✓ et créer une association.
              </Text>
              <View style={styles.recap}>
                <RecapLine label="Nom" value={`${data.firstName} ${data.lastName}`} />
                <RecapLine label="Email" value={data.email} />
                <RecapLine
                  label="Localisation"
                  value={`${data.city || '—'}${
                    data.countryCode ? `, ${countryName(data.countryCode)}` : ''
                  }`}
                />
                {data.bio ? <RecapLine label="Bio" value={data.bio} /> : null}
              </View>
              <View style={styles.infoCard}>
                <View style={registerExtras.infoTitleRow}>
                  <Feather name="award" size={16} color={Colors.successDark} />
                  <Text style={styles.infoTitle}>Prêt à rejoindre NigerConnect</Text>
                </View>
                <Text style={styles.infoText}>
                  Après inscription, tu pourras vérifier ton identité dans Paramètres pour obtenir
                  le badge de diaspora certifiée.
                </Text>
              </View>
            </View>
          )}

          {errorMessage ? (
            <View
              style={registerExtras.errorBanner}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              <Feather
                name="alert-triangle"
                size={16}
                color={palette.errorText}
                style={registerExtras.errorIcon}
              />
              <Text style={registerExtras.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.footer}>
            {step < 3 ? (
              <Pressable
                onPress={next}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
              >
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <View style={registerExtras.primaryRow}>
                  <Text style={styles.primaryLabel}>Continuer</Text>
                  <Feather name="arrow-right" size={18} color={Colors.white} />
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={submit}
                disabled={loading}
                style={({ pressed }) => [
                  styles.primary,
                  (loading || pressed) && { opacity: 0.85 },
                ]}
              >
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <Text style={styles.primaryLabel}>
                  {loading ? 'Création…' : 'Créer mon compte'}
                </Text>
              </Pressable>
            )}

            {step === 3 ? (
              <Text style={registerExtras.legalText}>
                En créant un compte, tu acceptes nos{' '}
                <Text
                  style={registerExtras.legalLink}
                  onPress={() => router.push('/legal/terms')}
                >
                  Conditions d&apos;utilisation
                </Text>
                {' '}et notre{' '}
                <Text
                  style={registerExtras.legalLink}
                  onPress={() => router.push('/legal/privacy')}
                >
                  Politique de confidentialité
                </Text>
                . Tu dois avoir 13 ans ou plus.
              </Text>
            ) : null}

            <Link href="/(auth)/login" asChild>
              <Pressable>
                <Text style={styles.link}>
                  Déjà un compte ? <Text style={styles.linkAccent}>Se connecter</Text>
                </Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: Spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={Colors.tan400}
        {...rest}
        style={[styles.input, style, props.multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

function RecapLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.recapLine}>
      <Text style={styles.recapLabel}>{label}</Text>
      <Text style={styles.recapValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.tan200,
    gap: Spacing.md,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: Radii.md,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  stepCounter: { fontSize: Typography.sizes.sm, color: Colors.tan500, fontWeight: '600' },
  progressWrap: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  progressBar: { flex: 1, height: 4, borderRadius: 2 },
  progressBarActive: { backgroundColor: Colors.orange },
  progressBarIdle: { backgroundColor: Colors.tan200 },
  scroll: { padding: Spacing.xl, paddingTop: Spacing.md, paddingBottom: Spacing.xxxl },
  title: {
    fontSize: Typography.sizes.display,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
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
  recap: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  recapLine: { gap: 2 },
  recapLabel: { fontSize: Typography.sizes.xs, color: Colors.tan500, fontWeight: '600' },
  recapValue: { fontSize: Typography.sizes.md, color: Colors.brown },
  infoCard: {
    backgroundColor: Colors.successSoft,
    padding: Spacing.md + 2,
    borderRadius: Radii.lg,
  },
  infoTitle: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.successDark },
  infoText: { fontSize: Typography.sizes.sm, color: '#4CAF50', marginTop: 4, lineHeight: 19 },
  footer: { marginTop: Spacing.xl, gap: Spacing.md },
  primary: {
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
  primaryLabel: { color: Colors.white, fontSize: Typography.sizes.lg, fontWeight: '700' },
  link: { textAlign: 'center', color: Colors.tan500, fontSize: Typography.sizes.sm },
  linkAccent: { color: Colors.orange, fontWeight: '700' },
});

const gateStyles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  inviteScroll: { alignItems: 'stretch' },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.tan100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
    marginTop: Spacing.xl,
  },
  heading: {
    fontSize: Typography.sizes.xxl,
    fontFamily: Typography.fontFamily.serifBold,
    color: Colors.brown,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  body: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  link: { color: Colors.orange, fontWeight: '600' },
  secondaryBtn: {
    marginTop: Spacing.xl,
    height: 52,
    width: '100%',
    borderRadius: Radii.xl,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  secondaryBtnLabel: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.successSoft,
    borderWidth: 1,
    borderColor: palette.successBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  successText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.successDark,
  },
  modeErrorNote: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
});

const registerExtras = StyleSheet.create({
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  line: { flex: 1, height: 1, backgroundColor: Colors.tan300 },
  dividerText: {
    marginHorizontal: Spacing.md,
    color: Colors.tan500,
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.sm,
  },
  infoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: palette.errorBg,
    borderWidth: 1,
    borderColor: palette.errorBorder,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  errorIcon: { fontSize: 16, lineHeight: 20 },
  errorText: {
    flex: 1,
    color: palette.errorText,
    fontSize: Typography.sizes.sm,
    fontWeight: '500',
    lineHeight: 20,
  },
  legalText: {
    fontSize: Typography.sizes.xs + 1,
    color: Colors.tan500,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  legalLink: { color: Colors.orange, fontWeight: '600' },
});
