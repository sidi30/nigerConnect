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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { pagesApi, type CreatePageInput, type PageKind } from '@/services/pagesApi';
import { pickAndUploadImage, UploadError } from '@/services/uploadService';
import { useAuthStore } from '@/stores/authStore';
import { CitySearchField } from '@/components/ui/CitySearchField';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';

const KINDS: Array<{ id: PageKind; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { id: 'community', label: 'Communauté', icon: 'globe' },
  { id: 'cause', label: 'Cause', icon: 'heart' },
  { id: 'business', label: 'Business', icon: 'briefcase' },
  { id: 'official', label: 'Officiel', icon: 'award' },
  { id: 'group', label: 'Groupe', icon: 'users' },
];

export default function NewPageScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<PageKind>('community');
  const [countryCode, setCountryCode] = useState('');
  const [city, setCity] = useState('');
  const [website, setWebsite] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  const mut = useMutation({
    mutationFn: (input: CreatePageInput) => pagesApi.create(input),
    onSuccess: (page) => {
      void qc.invalidateQueries({ queryKey: ['pages'] });
      void qc.invalidateQueries({ queryKey: ['geo'] });
      setFeedback({ kind: 'success', message: 'Page créée ✓' });
      setTimeout(() => router.replace(`/pages/${page.id}`), 800);
    },
    onError: (e) => {
      const err = e as {
        response?: { data?: { message?: string | string[] } };
        message?: string;
      };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setFeedback({ kind: 'error', message: msg ?? err.message ?? 'Impossible de créer.' });
    },
  });

  async function pickImage(kind: 'avatar' | 'cover') {
    setFeedback(null);
    setUploading(kind);
    try {
      const url = await pickAndUploadImage(kind === 'avatar' ? 'avatar' : 'cover');
      if (!url) return;
      if (kind === 'avatar') setAvatarUrl(url);
      else setCoverUrl(url);
    } catch (error) {
      const message =
        error instanceof UploadError
          ? error.message
          : (error as Error).message ?? "Échec de l'envoi.";
      setFeedback({ kind: 'error', message });
    } finally {
      setUploading(null);
    }
  }

  function submit() {
    setFeedback(null);
    if (!name.trim()) {
      setFeedback({ kind: 'error', message: 'Le nom est requis.' });
      return;
    }
    if (user?.identityStatus !== 'approved') {
      setFeedback({
        kind: 'error',
        message: "Vérification d'identité requise pour créer une page.",
      });
      return;
    }
    if (!city.trim() || !countryCode) {
      setFeedback({
        kind: 'error',
        message: 'Choisis une ville — sans elle, la page n’apparaît pas sur la carte.',
      });
      return;
    }
    mut.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      kind,
      countryCode,
      city: city.trim(),
      website: website.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      avatarUrl: avatarUrl ?? undefined,
      coverUrl: coverUrl ?? undefined,
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>‹ Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle page</Text>
        <Pressable
          onPress={submit}
          disabled={mut.isPending}
          style={[styles.publish, mut.isPending && { opacity: 0.5 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>{mut.isPending ? '…' : 'Créer'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {user?.identityStatus !== 'approved' ? (
            <View style={styles.warnBanner}>
              <Text style={styles.warnIcon}>ℹ️</Text>
              <Text style={styles.warnText}>
                Seuls les membres avec identité vérifiée peuvent créer une page. Soumets ton
                document dans Paramètres → Vérification d&apos;identité.
              </Text>
            </View>
          ) : null}

          {/* Cover picker */}
          <Pressable onPress={() => pickImage('cover')} style={styles.coverWrap}>
            {coverUrl ? (
              <Image
                source={{ uri: coverUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : (
              <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            )}
            <Text style={styles.coverHint}>
              {uploading === 'cover' ? 'Envoi…' : '🖼️  Ajouter une bannière'}
            </Text>
          </Pressable>

          {/* Avatar/logo picker */}
          <Pressable onPress={() => pickImage('avatar')} style={styles.logoWrap}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.logo} contentFit="cover" />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoIcon}>{uploading === 'avatar' ? '…' : '📷'}</Text>
              </View>
            )}
          </Pressable>

          <Field label="Nom de la page*" value={name} onChangeText={setName} />

          <Text style={styles.label}>Type de page</Text>
          <View style={styles.grid}>
            {KINDS.map((k) => {
              const active = k.id === kind;
              return (
                <Pressable
                  key={k.id}
                  onPress={() => setKind(k.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Feather
                    name={k.icon}
                    size={15}
                    color={active ? Colors.orange : Colors.tan600}
                  />
                  <Text style={[styles.chipLabel, active && { color: Colors.orange }]}>
                    {k.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Décris l'objet de ta page…"
            multiline
          />

          <Text style={styles.label}>Ville</Text>
          <Text style={styles.fieldHint}>
            Choisis la ville — le pays est défini automatiquement. La page apparaît alors sur la
            carte.
          </Text>
          <CitySearchField
            city={city}
            countryCode={countryCode}
            onChange={(c, cc) => {
              setCity(c);
              setCountryCode(cc);
            }}
          />
          <Field
            label="Site web"
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://…"
          />
          <Field
            label="Email de contact"
            value={contactEmail}
            onChangeText={setContactEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="contact@page.ne"
          />

          {feedback ? (
            <View
              style={[
                styles.feedbackBanner,
                feedback.kind === 'success' ? styles.feedbackSuccess : styles.feedbackError,
              ]}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              <Feather
                name={feedback.kind === 'success' ? 'check-circle' : 'alert-triangle'}
                size={16}
                color={feedback.kind === 'success' ? palette.successText : palette.errorText}
                style={styles.feedbackIcon}
              />
              <Text
                style={[
                  styles.feedbackText,
                  feedback.kind === 'success'
                    ? { color: palette.successText }
                    : { color: palette.errorText },
                ]}
              >
                {feedback.message}
              </Text>
            </View>
          ) : null}
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
    gap: Spacing.md,
  },
  cancel: { color: Colors.brown, fontSize: Typography.sizes.md, fontWeight: '600' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.sizes.md + 1,
    fontWeight: '700',
    color: Colors.brown,
  },
  publish: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  publishLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  warnBanner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radii.lg,
    backgroundColor: palette.warningSoft,
    borderWidth: 1,
    borderColor: palette.warning,
    marginBottom: Spacing.md,
  },
  warnIcon: { fontSize: 18 },
  warnText: {
    flex: 1,
    color: palette.warningDark,
    fontSize: Typography.sizes.sm,
    lineHeight: 19,
  },
  coverWrap: {
    height: 110,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverHint: {
    color: Colors.white,
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    backgroundColor: palette.overlayMedium,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.md,
  },
  logoWrap: { alignSelf: 'center', marginTop: -36, marginBottom: Spacing.sm },
  logo: {
    width: 72,
    height: 72,
    borderRadius: Radii.xl,
    borderWidth: 3,
    borderColor: Colors.cream,
  },
  logoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: Radii.xl,
    backgroundColor: Colors.peach50,
    borderWidth: 3,
    borderColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIcon: { fontSize: 26 },
  label: {
    fontSize: Typography.sizes.xs + 1,
    fontWeight: '700',
    color: Colors.tan600,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.md,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.white,
    color: Colors.brown,
  },
  fieldHint: {
    fontSize: Typography.sizes.xs + 1,
    color: Colors.tan500,
    marginBottom: Spacing.sm,
    lineHeight: 16,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.md },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  chipIcon: { fontSize: 16 },
  chipLabel: { fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.brown },
  countryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countryChipActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  countryName: { fontSize: Typography.sizes.sm, color: Colors.brown },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: Radii.lg,
    padding: Spacing.md,
  },
  feedbackSuccess: { backgroundColor: palette.successBg, borderColor: palette.successBorder },
  feedbackError: { backgroundColor: palette.errorBg, borderColor: palette.errorBorder },
  feedbackIcon: { fontSize: 16, lineHeight: 20 },
  feedbackText: { flex: 1, fontSize: Typography.sizes.sm, fontWeight: '500', lineHeight: 20 },
});
