import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Loader } from '@/components/ui/Loader';
import { identityApi } from '@/services/identityApi';
import { pickAndUploadImage, UploadError } from '@/services/uploadService';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';

type DocType = 'passport' | 'id_card' | 'driver_license' | 'residence_permit';

const DOC_TYPES: Array<{ id: DocType; icon: keyof typeof Feather.glyphMap; label: string }> = [
  { id: 'passport', icon: 'book', label: 'Passeport' },
  { id: 'id_card', icon: 'credit-card', label: "Carte d'identité" },
  { id: 'driver_license', icon: 'truck', label: 'Permis' },
  { id: 'residence_permit', icon: 'home', label: 'Carte consulaire' },
];

const STATUS_LABELS: Record<
  string,
  { icon: keyof typeof Feather.glyphMap; title: string; desc: string; color: string }
> = {
  not_submitted: {
    icon: 'upload',
    title: 'Non soumis',
    desc: 'Prouve ton identité nigérienne pour obtenir le badge ✓ et débloquer toutes les fonctionnalités',
    color: Colors.tan500,
  },
  pending: {
    icon: 'clock',
    title: 'En cours de vérification',
    desc: 'Tes documents sont en cours d\u2019examen par notre équipe (48-72h).',
    color: Colors.warningDark,
  },
  approved: {
    icon: 'check',
    title: 'Identité vérifiée',
    desc: 'Tu es un membre certifié de la diaspora nigérienne.',
    color: Colors.green,
  },
  rejected: {
    icon: 'x',
    title: 'Refusé',
    desc: 'Ta soumission n\u2019a pas été validée. Tu peux réessayer.',
    color: Colors.danger,
  },
};

export default function IdentityScreen() {
  const qc = useQueryClient();
  const [selectedType, setSelectedType] = useState<DocType>('passport');
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );
  const { data, isLoading } = useQuery({
    queryKey: ['identity', 'status'],
    queryFn: () => identityApi.status(),
  });

  const submitMut = useMutation({
    mutationFn: (payload: { documentType: DocType; fileUrl: string }) =>
      identityApi.submit(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['identity'] });
      setFeedback({
        kind: 'success',
        message: 'Ton document a bien été soumis. Vérification sous 48-72h.',
      });
    },
    onError: (e) => {
      const err = e as {
        response?: { data?: { message?: string | string[] } };
        message?: string;
      };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setFeedback({ kind: 'error', message: msg ?? err.message ?? "Échec de l'envoi." });
    },
  });

  async function handleSubmit() {
    setFeedback(null);
    setUploading(true);
    try {
      const url = await pickAndUploadImage('identity');
      if (!url) return;
      submitMut.mutate({ documentType: selectedType, fileUrl: url });
    } catch (error) {
      const message =
        error instanceof UploadError
          ? error.message
          : (error as Error).message ?? "Échec de l'envoi du document.";
      setFeedback({ kind: 'error', message });
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) {
    return <Loader />;
  }

  const state = STATUS_LABELS[data?.status ?? 'not_submitted']!;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={[styles.card, { borderColor: state.color + '40' }]}>
        <View style={[styles.emojiCircle, { backgroundColor: state.color }]}>
          <Feather name={state.icon} size={30} color={Colors.white} />
        </View>
        <Text style={[styles.title, { color: state.color }]}>{state.title}</Text>
        <Text style={styles.desc}>{state.desc}</Text>
        {data?.rejectionReason ? (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonLabel}>Motif</Text>
            <Text style={styles.reasonText}>{data.rejectionReason}</Text>
          </View>
        ) : null}
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
              feedback.kind === 'success' ? { color: palette.successText } : { color: palette.errorText },
            ]}
          >
            {feedback.message}
          </Text>
        </View>
      ) : null}

      {(data?.status === 'not_submitted' || data?.status === 'rejected') && (
        <View style={styles.actions}>
          <Text style={styles.sectionLabel}>Type de document</Text>
          <View style={styles.docTypes}>
            {DOC_TYPES.map((d) => {
              const active = selectedType === d.id;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => setSelectedType(d.id)}
                  style={[styles.docType, active && styles.docTypeActive]}
                >
                  <Feather
                    name={d.icon}
                    size={22}
                    color={active ? Colors.orange : Colors.tan600}
                  />
                  <Text style={[styles.docLabel, active && { color: Colors.orange }]}>
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={uploading || submitMut.isPending}
            style={({ pressed }) => [
              styles.submitBtn,
              (uploading || submitMut.isPending || pressed) && { opacity: 0.85 },
            ]}
          >
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            <Feather name="upload" size={16} color={Colors.white} />
            <Text style={styles.submitLabel}>
              {uploading ? 'Envoi…' : 'Soumettre un document'}
            </Text>
          </Pressable>
          <Text style={styles.hint}>
            Format accepté : JPEG, PNG · max 10 Mo · chiffré AES-256 · supprimé 30j après
            validation
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, gap: Spacing.lg },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  emojiCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: { fontSize: Typography.sizes.xl, fontWeight: '800', marginBottom: 4 },
  desc: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 20,
  },
  reasonBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.dangerSoft,
    borderRadius: Radii.md,
    width: '100%',
  },
  reasonLabel: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '700',
    color: Colors.danger,
    textTransform: 'uppercase',
  },
  reasonText: { fontSize: Typography.sizes.sm, color: Colors.danger, marginTop: 2 },
  actions: { gap: Spacing.md },
  sectionLabel: {
    fontSize: Typography.sizes.xs,
    fontWeight: '800',
    color: Colors.tan500,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  docTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  docType: {
    flexBasis: '48%',
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan200,
    alignItems: 'center',
  },
  docTypeActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  docLabel: { fontSize: Typography.sizes.xs + 1, fontWeight: '600', color: Colors.brown, marginTop: 4 },
  submitBtn: {
    height: 54,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  hint: { fontSize: Typography.sizes.xs, color: Colors.tan500, textAlign: 'center', lineHeight: 17 },
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
