import { useEffect, useState } from 'react';
import {
  Alert,
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { NCImage } from '@/components/ui/NCImage';
import { Loader } from '@/components/ui/Loader';
import { servicesApi, type ServiceMediaInput } from '@/services/servicesApi';
import { pickImages, uploadLocalImage, UploadError, type PickedImage } from '@/services/uploadService';
import {
  Colors,
  CountryNames,
  Flags,
  Gradients,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';
import type { ServiceCategory, ServiceIntent, ServiceUrgency } from '@nigerconnect/shared-types';

const CATEGORIES: Array<{ id: ServiceCategory; icon: string; label: string }> = [
  { id: 'logement', icon: '🏠', label: 'Logement' },
  { id: 'transport', icon: '✈️', label: 'Transport' },
  { id: 'admin_category', icon: '📋', label: 'Admin' },
  { id: 'sante', icon: '🏥', label: 'Santé' },
  { id: 'emploi', icon: '💼', label: 'Emploi' },
  { id: 'business', icon: '💰', label: 'Business' },
  { id: 'education', icon: '🎓', label: 'Éducation' },
  { id: 'autre', icon: '📦', label: 'Autre' },
];

const MAX_MEDIA = 6;

/**
 * Gallery item: either an already-uploaded remote image (edit mode) or a
 * freshly-picked local one that still needs an S3 upload before submit.
 */
type GalleryItem =
  | { kind: 'remote'; id: string; mediaUrl: string; thumbnailUrl: string | null; blurhash: string | null }
  | { kind: 'local'; id: string; picked: PickedImage };

export default function NewServiceScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!editId;

  const [intent, setIntent] = useState<ServiceIntent>('help_free');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [urgency, setUrgency] = useState<ServiceUrgency>('normal');
  const [budget, setBudget] = useState('');
  const [city, setCity] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Edit mode: load the existing request and prefill the form once.
  const existingQuery = useQuery({
    queryKey: ['service', editId],
    queryFn: () => servicesApi.get(editId!),
    enabled: isEdit,
  });

  useEffect(() => {
    const svc = existingQuery.data;
    if (!svc || prefilled) return;
    setIntent(svc.intent);
    setTitle(svc.title);
    setDescription(svc.description ?? '');
    setCategory(svc.category);
    setUrgency(svc.urgency);
    setBudget(svc.budget ?? '');
    setCity(svc.city ?? '');
    setCountryCode(svc.countryCode ?? '');
    setGallery(
      svc.media.map((m) => ({
        kind: 'remote' as const,
        id: m.id,
        mediaUrl: m.mediaUrl,
        thumbnailUrl: m.thumbnailUrl,
        blurhash: m.blurhash,
      })),
    );
    setPrefilled(true);
  }, [existingQuery.data, prefilled]);

  async function handlePickImages() {
    const remaining = MAX_MEDIA - gallery.length;
    if (remaining <= 0) return;
    setPicking(true);
    try {
      const picked = await pickImages('photo', remaining);
      if (picked.length > 0) {
        setGallery((g) => [
          ...g,
          ...picked.map((p, i) => ({ kind: 'local' as const, id: `local-${Date.now()}-${i}`, picked: p })),
        ]);
      }
    } catch (error) {
      const message =
        error instanceof UploadError ? error.message : (error as Error).message ?? "Échec de la sélection.";
      Alert.alert('Photos', message);
    } finally {
      setPicking(false);
    }
  }

  function removeImage(itemId: string) {
    setGallery((g) => g.filter((it) => it.id !== itemId));
  }

  const mut = useMutation({
    mutationFn: async () => {
      // Upload every locally-picked image FIRST so we only ever send the
      // owner-bound canonical URLs to the API (never a local file URI).
      setUploading(true);
      const media: ServiceMediaInput[] = [];
      try {
        for (let i = 0; i < gallery.length; i++) {
          const item = gallery[i]!;
          if (item.kind === 'remote') {
            media.push({ mediaUrl: item.mediaUrl, thumbnailUrl: item.thumbnailUrl ?? undefined, sortOrder: i });
          } else {
            const url = await uploadLocalImage(item.picked, 'photo');
            media.push({ mediaUrl: url, sortOrder: i });
          }
        }
      } finally {
        setUploading(false);
      }

      const payload = {
        intent,
        title: title.trim(),
        description: description.trim() || undefined,
        category: category!,
        urgency,
        // budget belongs to paid services only — never sent for help_free.
        budget: intent === 'paid_service' ? budget.trim() || undefined : undefined,
        city: city.trim() || undefined,
        countryCode: countryCode || undefined,
        media,
      };

      return isEdit ? servicesApi.update(editId!, payload) : servicesApi.create(payload);
    },
    onSuccess: (svc) => {
      void qc.invalidateQueries({ queryKey: ['services'] });
      void qc.invalidateQueries({ queryKey: ['service', svc.id] });
      router.replace(`/services/${svc.id}` as never);
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string | string[] } } };
      const apiMsg = err.response?.data?.message;
      Alert.alert('Erreur', Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg ?? 'Impossible de publier');
    },
  });

  const busy = mut.isPending || uploading;
  const canPublish = title.trim().length > 0 && category !== null && !busy;
  const isPaid = intent === 'paid_service';

  if (isEdit && existingQuery.isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Loader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>‹ Annuler</Text>
        </Pressable>
        <Text style={styles.title}>{isEdit ? 'Modifier' : isPaid ? 'Nouveau service' : 'Nouvelle demande'}</Text>
        <Pressable
          onPress={() => mut.mutate()}
          disabled={!canPublish}
          style={[styles.publish, !canPublish && { opacity: 0.4 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>{busy ? '…' : isEdit ? 'Enregistrer' : 'Publier'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Intention-first: this choice drives which fields appear below. */}
          <Text style={styles.section}>Que veux-tu faire ?</Text>
          <View style={styles.intentRow}>
            <Pressable
              onPress={() => setIntent('help_free')}
              style={[styles.intentCard, !isPaid && styles.intentCardActive]}
            >
              <Feather name="heart" size={20} color={!isPaid ? Colors.orange : Colors.tan500} />
              <Text style={[styles.intentTitle, !isPaid && { color: Colors.orange }]}>
                J&apos;ai besoin d&apos;aide
              </Text>
              <Text style={styles.intentHint}>Gratuit · demande à la communauté</Text>
            </Pressable>
            <Pressable
              onPress={() => setIntent('paid_service')}
              style={[styles.intentCard, isPaid && styles.intentCardActive]}
            >
              <Feather name="briefcase" size={20} color={isPaid ? Colors.orange : Colors.tan500} />
              <Text style={[styles.intentTitle, isPaid && { color: Colors.orange }]}>
                Je propose un service
              </Text>
              <Text style={styles.intentHint}>Payant · avec tarif</Text>
            </Pressable>
          </View>

          <Text style={styles.section}>Catégorie</Text>
          <View style={styles.catGrid}>
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCategory(c.id)}
                  style={[styles.catCard, active && styles.catCardActive]}
                >
                  <Text style={styles.catIcon}>{c.icon}</Text>
                  <Text style={[styles.catLabel, active && { color: Colors.orange }]}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Urgence</Text>
          <View style={styles.urgencyRow}>
            {(
              [
                { id: 'urgent' as const, label: '🔴 Urgent', color: Colors.warningDark, bg: Colors.warningSoft },
                { id: 'normal' as const, label: '🟢 Normal', color: Colors.tan600, bg: Colors.tan100 },
              ] as const
            ).map((u) => {
              const active = urgency === u.id;
              return (
                <Pressable
                  key={u.id}
                  onPress={() => setUrgency(u.id)}
                  style={[
                    styles.urgencyPill,
                    active && { backgroundColor: u.bg, borderColor: u.color },
                  ]}
                >
                  <Text style={[styles.urgencyLabel, active && { color: u.color }]}>
                    {u.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Titre</Text>
          <TextInput
            style={styles.input}
            placeholder={isPaid ? 'Cours de soutien maths, transport aéroport…' : 'Cherche logement à Paris pour 2 mois'}
            placeholderTextColor={Colors.tan400}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
          />

          <Text style={styles.section}>Description</Text>
          <TextInput
            style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
            placeholder="Donne les détails (dates, besoins, contexte…)"
            placeholderTextColor={Colors.tan400}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={5000}
          />

          {/* Budget only appears for a paid service (intention-first). */}
          {isPaid ? (
            <>
              <Text style={styles.section}>Tarif</Text>
              <TextInput
                style={styles.input}
                placeholder="500-700€/mois, 20€/h ou À discuter"
                placeholderTextColor={Colors.tan400}
                value={budget}
                onChangeText={setBudget}
                maxLength={50}
              />
            </>
          ) : null}

          <Text style={styles.section}>Photos ({gallery.length}/{MAX_MEDIA})</Text>
          <View style={styles.mediaGrid}>
            {gallery.map((item) => (
              <View key={item.id} style={styles.mediaTile}>
                <NCImage
                  source={{ uri: item.kind === 'remote' ? (item.thumbnailUrl ?? item.mediaUrl) : item.picked.uri }}
                  placeholder={item.kind === 'remote' && item.blurhash ? { blurhash: item.blurhash } : undefined}
                  style={styles.mediaImage}
                  recyclingKey={item.id}
                />
                <Pressable onPress={() => removeImage(item.id)} style={styles.mediaRemove} hitSlop={6}>
                  <Feather name="x" size={13} color={Colors.white} />
                </Pressable>
              </View>
            ))}
            {gallery.length < MAX_MEDIA ? (
              <Pressable onPress={handlePickImages} disabled={picking} style={styles.mediaAdd}>
                <Feather name={picking ? 'loader' : 'plus'} size={22} color={Colors.tan500} />
                <Text style={styles.mediaAddLabel}>{picking ? '…' : 'Ajouter'}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.section}>Localisation</Text>
          <TextInput
            style={styles.input}
            placeholder="Ville"
            placeholderTextColor={Colors.tan400}
            value={city}
            onChangeText={setCity}
          />
          <View style={styles.countryGrid}>
            {Object.keys(Flags)
              .filter((c) => c !== 'NE')
              .map((code) => {
                const active = countryCode === code;
                return (
                  <Pressable
                    key={code}
                    onPress={() => setCountryCode(active ? '' : code)}
                    style={[styles.countryCard, active && styles.countryCardActive]}
                  >
                    <Text style={styles.flag}>{Flags[code]}</Text>
                    <Text style={styles.countryName}>{CountryNames[code]}</Text>
                  </Pressable>
                );
              })}
          </View>

          {uploading ? <Text style={styles.uploadHint}>Envoi des photos…</Text> : null}
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
  cancel: { color: Colors.brown, fontSize: Typography.sizes.md, fontWeight: '600' },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  publish: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  publishLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  section: {
    fontSize: Typography.sizes.xs,
    fontWeight: '800',
    color: Colors.tan500,
    letterSpacing: 1,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
  },
  intentRow: { flexDirection: 'row', gap: Spacing.sm },
  intentCard: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    gap: 4,
  },
  intentCardActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  intentTitle: { fontSize: Typography.sizes.sm, fontWeight: '800', color: Colors.brown, marginTop: 4 },
  intentHint: { fontSize: Typography.sizes.xxs, color: Colors.tan500 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catCard: {
    flexBasis: '23%',
    padding: Spacing.md - 2,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
  },
  catCardActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  catIcon: { fontSize: 22 },
  catLabel: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '700',
    color: Colors.tan600,
    marginTop: 2,
  },
  urgencyRow: { flexDirection: 'row', gap: 8 },
  urgencyPill: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
  },
  urgencyLabel: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.tan600 },
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
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaTile: {
    width: 84,
    height: 84,
    borderRadius: Radii.md,
    overflow: 'hidden',
    backgroundColor: Colors.tan100,
  },
  mediaImage: { width: '100%', height: '100%' },
  mediaRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaAdd: {
    width: 84,
    height: 84,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  mediaAddLabel: { fontSize: Typography.sizes.xxs, fontWeight: '700', color: Colors.tan500 },
  countryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  countryCard: {
    flexBasis: '48%',
    padding: Spacing.sm + 2,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  countryCardActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  flag: { fontSize: 20 },
  countryName: { fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.brown, marginTop: 2 },
  uploadHint: {
    marginTop: Spacing.md,
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
  },
});
