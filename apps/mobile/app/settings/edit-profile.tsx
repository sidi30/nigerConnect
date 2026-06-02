import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Colors,
  Gradients,
  palette,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';
import { profileApi } from '@/services/profileApi';
import { pickAndUploadImage, UploadError } from '@/services/uploadService';
import { Avatar } from '@/components/ui/Avatar';
import { CitySearchField } from '@/components/ui/CitySearchField';
import { useAuthStore } from '@/stores/authStore';

export default function EditProfileScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [city, setCity] = useState(user?.city ?? '');
  const [countryCode, setCountryCode] = useState(user?.countryCode ?? '');
  const [privacyLevel, setPrivacyLevel] = useState(user?.privacyLevel ?? 'friends');
  const [showOnMap, setShowOnMap] = useState(user?.showOnMap ?? true);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
      setDisplayName(user.displayName ?? '');
      setBio(user.bio ?? '');
      setCity(user.city ?? '');
      setCountryCode(user.countryCode ?? '');
      setPrivacyLevel(user.privacyLevel ?? 'friends');
      setShowOnMap(user.showOnMap ?? true);
    }
  }, [user]);

  const mut = useMutation({
    mutationFn: () => {
      // Only send non-empty required strings; allow explicit null only on truly nullable fields.
      const payload: Record<string, unknown> = {
        bio: bio.trim() || null,
        city: city.trim() || null,
        countryCode: countryCode || null,
        privacyLevel,
        showOnMap,
      };
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      if (displayName.trim()) payload.displayName = displayName.trim();
      return profileApi.updateMe(payload as never);
    },
    onSuccess: (updated) => {
      setUser(updated);
      void qc.invalidateQueries();
      setFeedback({ kind: 'success', message: 'Modifications enregistrées ✓' });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      const err = e as {
        response?: { data?: { message?: string | string[] } };
        message?: string;
        code?: string;
      };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      const isNetwork =
        err.code === 'ERR_NETWORK' || err.message === 'Network Error' || !err.response;
      setFeedback({
        kind: 'error',
        message:
          msg ??
          (isNetwork
            ? "Impossible de joindre le serveur. Vérifie ta connexion."
            : err.message ?? 'Impossible de sauvegarder.'),
      });
    },
  });

  function handleSubmit() {
    setFeedback(null);
    if (!firstName.trim()) {
      setFeedback({ kind: 'error', message: 'Le prénom est requis.' });
      return;
    }
    if (!lastName.trim()) {
      setFeedback({ kind: 'error', message: 'Le nom est requis.' });
      return;
    }
    mut.mutate();
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.orange} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarRow}>
          <Avatar uri={user.avatarUrl} name={user.displayName ?? ''} size={80} border={false} />
          <Pressable
            onPress={async () => {
              setFeedback(null);
              try {
                const url = await pickAndUploadImage('avatar');
                if (!url) return;
                const updated = await profileApi.updateAvatar(url);
                setUser(updated);
                void qc.invalidateQueries();
                setFeedback({ kind: 'success', message: 'Avatar mis à jour ✓' });
              } catch (error) {
                const message =
                  error instanceof UploadError
                    ? error.message
                    : (error as Error).message ?? "Échec de l'envoi de l'avatar.";
                setFeedback({ kind: 'error', message });
              }
            }}
            style={styles.changePhotoBtn}
          >
            <Text style={styles.changePhotoLabel}>📷 Changer la photo</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Identité</Text>
        <Field label="Prénom" value={firstName} onChangeText={setFirstName} />
        <Field label="Nom" value={lastName} onChangeText={setLastName} />
        <Field
          label="Nom affiché (facultatif)"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={`${firstName} ${lastName}`.trim()}
        />
        <Field
          label="Bio"
          value={bio}
          onChangeText={setBio}
          placeholder="Ingénieur • Passionné de…"
          multiline
        />

        <Text style={styles.section}>Localisation</Text>
        <CitySearchField
          label="Ville"
          city={city}
          countryCode={countryCode}
          onChange={(nextCity, nextCountry) => {
            setCity(nextCity);
            setCountryCode(nextCountry);
          }}
        />

        <Text style={styles.section}>Apparaître sur la carte</Text>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Me montrer aux membres</Text>
            <Text style={styles.switchHint}>
              Ton avatar s&apos;affiche sur la carte selon ton niveau de confidentialité
            </Text>
          </View>
          <Switch
            value={showOnMap}
            onValueChange={setShowOnMap}
            trackColor={{ false: Colors.tan300, true: Colors.orange }}
            thumbColor={Colors.white}
          />
        </View>

        <Text style={styles.section}>Qui peut voir mon profil</Text>
        <View style={styles.privacyRow}>
          {(['public', 'friends', 'private'] as const).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPrivacyLevel(p)}
              style={[styles.privacyPill, privacyLevel === p && styles.privacyPillActive]}
            >
              <Text
                style={[
                  styles.privacyLabel,
                  privacyLevel === p && { color: Colors.white },
                ]}
              >
                {p === 'public' ? '🌍 Public' : p === 'friends' ? '👥 Amis' : '🔒 Privé'}
              </Text>
            </Pressable>
          ))}
        </View>

        {feedback ? (
          <View
            style={[
              styles.feedbackBanner,
              feedback.kind === 'success' ? styles.feedbackSuccess : styles.feedbackError,
            ]}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            <Text style={styles.feedbackIcon}>
              {feedback.kind === 'success' ? '✅' : '⚠️'}
            </Text>
            <Text
              style={[
                styles.feedbackText,
                feedback.kind === 'success' ? { color: palette.successText } : { color: palette.errorText },
              ]}
            >
              {feedback.message}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleSubmit}
          disabled={mut.isPending}
          style={({ pressed }) => [
            styles.saveBtn,
            (pressed || mut.isPending) && { opacity: 0.85 },
          ]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.saveLabel}>
            {mut.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: {
    fontSize: Typography.sizes.xs,
    fontWeight: '800',
    color: Colors.tan500,
    letterSpacing: 1,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  switchLabel: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  switchHint: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 2 },
  privacyRow: { flexDirection: 'row', gap: 8 },
  privacyPill: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    alignItems: 'center',
    backgroundColor: Colors.white,
  },
  privacyPillActive: { backgroundColor: Colors.orange, borderColor: Colors.orange },
  privacyLabel: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.tan600 },
  saveBtn: {
    height: 54,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xxl,
  },
  saveLabel: { color: Colors.white, fontSize: Typography.sizes.md + 1, fontWeight: '700' },
  avatarRow: {
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  changePhotoBtn: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    borderRadius: Radii.md,
    backgroundColor: Colors.peach50,
  },
  changePhotoLabel: { color: Colors.orange, fontSize: Typography.sizes.sm, fontWeight: '700' },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginTop: Spacing.lg,
  },
  feedbackSuccess: { backgroundColor: palette.successBg, borderColor: palette.successBorder },
  feedbackError: { backgroundColor: palette.errorBg, borderColor: palette.errorBorder },
  feedbackIcon: { fontSize: 16, lineHeight: 20 },
  feedbackText: { flex: 1, fontSize: Typography.sizes.sm, fontWeight: '500', lineHeight: 20 },
});
