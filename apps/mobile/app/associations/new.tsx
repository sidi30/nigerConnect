import { useState } from 'react';
import {
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import {
  associationsApi,
  type AssociationCategory,
  type CreateAssociationInput,
} from '@/services/associationsApi';
import { pickAndUploadImage, UploadError } from '@/services/uploadService';
import { useAuthStore } from '@/stores/authStore';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  palette,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

const CATEGORIES: Array<{
  id: AssociationCategory;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}> = [
  { id: 'generaliste', label: 'Généraliste', icon: 'globe' },
  { id: 'etudiants', label: 'Étudiants', icon: 'book-open' },
  { id: 'femmes', label: 'Femmes', icon: 'user' },
  { id: 'jeunesse', label: 'Jeunesse', icon: 'star' },
  { id: 'culture', label: 'Culture', icon: 'feather' },
  { id: 'business', label: 'Business', icon: 'briefcase' },
  { id: 'sport', label: 'Sport', icon: 'activity' },
  { id: 'religieux', label: 'Religieux', icon: 'moon' },
];

const COUNTRY_CODES = Object.keys(Flags);

export default function NewAssociationScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<AssociationCategory>('generaliste');
  const [countryCode, setCountryCode] = useState<string>('');
  const [city, setCity] = useState('');
  const [website, setWebsite] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  const mut = useMutation({
    mutationFn: (input: CreateAssociationInput) => associationsApi.create(input),
    onSuccess: (assoc) => {
      void qc.invalidateQueries({ queryKey: ['associations'] });
      setFeedback({ kind: 'success', message: 'Association créée ✓' });
      setTimeout(() => router.replace(`/associations/${assoc.id}`), 800);
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

  async function pickImage(kind: 'logo' | 'cover') {
    setFeedback(null);
    setUploading(kind);
    try {
      const url = await pickAndUploadImage(kind === 'logo' ? 'avatar' : 'cover');
      if (!url) return;
      if (kind === 'logo') setLogoUrl(url);
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
        message: 'Vérification d’identité requise pour créer une association.',
      });
      return;
    }
    mut.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      category,
      countryCode: countryCode || undefined,
      city: city.trim() || undefined,
      website: website.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      logoUrl: logoUrl ?? undefined,
      coverUrl: coverUrl ?? undefined,
      requiresApproval,
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>‹ Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle association</Text>
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
                Seuls les membres avec identité vérifiée peuvent créer une association. Soumets ton
                document dans Paramètres → Vérification d&apos;identité.
              </Text>
            </View>
          ) : null}

          <Pressable onPress={() => pickImage('cover')} style={styles.coverWrap}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            )}
            <Text style={styles.coverHint}>
              {uploading === 'cover' ? 'Envoi…' : '🖼️  Ajouter une bannière'}
            </Text>
          </Pressable>

          <Pressable onPress={() => pickImage('logo')} style={styles.logoWrap}>
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.logo} contentFit="cover" />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoIcon}>
                  {uploading === 'logo' ? '…' : '📷'}
                </Text>
              </View>
            )}
          </Pressable>

          <Field label="Nom de l'association*" value={name} onChangeText={setName} />

          <Text style={styles.label}>Catégorie</Text>
          <View style={styles.grid}>
            {CATEGORIES.map((c) => {
              const active = c.id === category;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCategory(c.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Feather
                    name={c.icon}
                    size={15}
                    color={active ? Colors.orange : Colors.tan600}
                  />
                  <Text style={[styles.chipLabel, active && { color: Colors.orange }]}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Présente la mission de l'association…"
            multiline
          />

          <Text style={styles.label}>Pays</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {COUNTRY_CODES.map((code) => {
              const active = countryCode === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => setCountryCode(active ? '' : code)}
                  style={[styles.countryChip, active && styles.countryChipActive]}
                >
                  <Text style={styles.chipIcon}>{Flags[code]}</Text>
                  <Text
                    style={[
                      styles.countryName,
                      active && { color: Colors.orange, fontWeight: '700' },
                    ]}
                  >
                    {CountryNames[code] ?? code}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Field label="Ville" value={city} onChangeText={setCity} placeholder="Ex : Niamey" />
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
            placeholder="contact@asso.ne"
          />

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Adhésion sur validation</Text>
              <Text style={styles.switchHint}>
                Chaque demande sera soumise aux admins avant d&apos;être approuvée.
              </Text>
            </View>
            <Switch
              value={requiresApproval}
              onValueChange={setRequiresApproval}
              trackColor={{ false: Colors.tan300, true: Colors.orange }}
              thumbColor={Colors.white}
            />
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
  title: { flex: 1, textAlign: 'center', fontSize: Typography.sizes.md + 1, fontWeight: '700', color: Colors.brown },
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
  warnText: { flex: 1, color: palette.warningDark, fontSize: Typography.sizes.sm, lineHeight: 19 },
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
  logo: { width: 72, height: 72, borderRadius: Radii.xl, borderWidth: 3, borderColor: Colors.cream },
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    marginTop: Spacing.sm,
  },
  switchLabel: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  switchHint: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2, lineHeight: 17 },
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
