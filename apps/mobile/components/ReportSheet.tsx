import { useState } from 'react';
import {
  Modal,
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
import {
  moderationApi,
  type ReportReason,
  type ReportTargetType,
} from '@/services/moderationApi';
import { Colors, Gradients, palette, Radii, Spacing, Typography } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  onReported?: () => void;
}

const REASONS: Array<{ id: ReportReason; emoji: string; label: string; desc: string }> = [
  {
    id: 'harassment',
    emoji: '😡',
    label: 'Harcèlement',
    desc: 'Insultes, menaces, intimidation',
  },
  {
    id: 'inappropriate',
    emoji: '🚫',
    label: 'Contenu inapproprié',
    desc: 'Nudité, violence, discours haineux',
  },
  {
    id: 'spam',
    emoji: '📨',
    label: 'Spam',
    desc: 'Publicité non sollicitée, répétitif',
  },
  {
    id: 'scam',
    emoji: '💸',
    label: 'Arnaque',
    desc: 'Fausse demande d’argent, escroquerie',
  },
  {
    id: 'fake_identity',
    emoji: '🎭',
    label: 'Usurpation d’identité',
    desc: 'Faux profil, se fait passer pour un autre',
  },
  {
    id: 'other',
    emoji: '❓',
    label: 'Autre',
    desc: 'Décris-nous le problème',
  },
];

/**
 * Bottom-sheet for reporting a post / comment / user / message. Works on web and native —
 * uses React Native's <Modal> which renders as an overlay in both.
 */
export function ReportSheet({ visible, onClose, targetType, targetId, onReported }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setReason(null);
    setDescription('');
    setLoading(false);
    setSubmitted(false);
    setError(null);
  }

  async function submit() {
    if (!reason) return;
    setLoading(true);
    setError(null);
    try {
      await moderationApi.create({
        targetType,
        targetId,
        reason,
        description: description.trim() || undefined,
      });
      setSubmitted(true);
      onReported?.();
    } catch (e) {
      const err = e as {
        response?: { data?: { message?: string | string[] } };
        message?: string;
      };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setError(msg ?? err.message ?? "Envoi impossible, réessaie plus tard.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      // avoid the iOS default "page sheet" look on web; we render our own backdrop below.
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : 'overFullScreen'}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          accessibilityLabel="Fermer le signalement"
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>
              {submitted ? 'Signalement envoyé' : 'Signaler'}
            </Text>
            <Pressable onPress={handleClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {submitted ? (
            <View style={styles.successBox}>
              <Text style={styles.successEmoji}>✅</Text>
              <Text style={styles.successTitle}>Merci pour ton signalement</Text>
              <Text style={styles.successText}>
                Notre équipe l’examinera sous 24 h ouvrées. Tu restes anonyme vis-à-vis de la
                personne signalée.
              </Text>
              <Pressable style={styles.ctaPrimary} onPress={handleClose}>
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <Text style={styles.ctaLabel}>Fermer</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.intro}>
                Dis-nous ce qui ne va pas. Les signalements anonymes sont traités sous 24 h
                ouvrées.
              </Text>

              <View style={styles.reasons}>
                {REASONS.map((r) => {
                  const active = reason === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => setReason(r.id)}
                      style={[styles.reason, active && styles.reasonActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={styles.reasonEmoji}>{r.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reasonLabel}>{r.label}</Text>
                        <Text style={styles.reasonDesc}>{r.desc}</Text>
                      </View>
                      {active ? <Text style={styles.check}>✓</Text> : null}
                    </Pressable>
                  );
                })}
              </View>

              {reason === 'other' || description.length > 0 ? (
                <>
                  <Text style={styles.label}>Précise (optionnel)</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    maxLength={1000}
                    placeholder="Décris-nous la situation…"
                    placeholderTextColor={Colors.tan400}
                    style={styles.textarea}
                  />
                </>
              ) : null}

              {error ? (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <Text style={styles.errorIcon}>⚠️</Text>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={submit}
                disabled={!reason || loading}
                style={[
                  styles.ctaPrimary,
                  (!reason || loading) && { opacity: 0.5 },
                ]}
              >
                <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
                <Text style={styles.ctaLabel}>
                  {loading ? 'Envoi…' : 'Envoyer le signalement'}
                </Text>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.overlayMedium,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    maxHeight: '90%',
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.tan300,
    alignSelf: 'center',
    marginTop: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  title: { fontSize: Typography.sizes.lg, fontWeight: '800', color: Colors.brown },
  close: { fontSize: 20, color: Colors.tan500 },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  intro: { fontSize: Typography.sizes.sm, color: Colors.tan500, lineHeight: 20 },
  reasons: { gap: 8 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  reasonActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  reasonEmoji: { fontSize: 22 },
  reasonLabel: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  reasonDesc: { fontSize: Typography.sizes.xs + 1, color: Colors.tan500, marginTop: 2 },
  check: { color: Colors.orange, fontSize: 20, fontWeight: '800' },
  label: {
    fontSize: Typography.sizes.xs + 1,
    fontWeight: '800',
    color: Colors.tan600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.sm,
  },
  textarea: {
    minHeight: 100,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    backgroundColor: Colors.white,
    textAlignVertical: 'top',
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
  },
  errorIcon: { fontSize: 16, lineHeight: 20 },
  errorText: { flex: 1, color: palette.errorText, fontSize: Typography.sizes.sm, fontWeight: '500' },
  ctaPrimary: {
    height: 54,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
  },
  ctaLabel: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '700' },
  successBox: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  successEmoji: { fontSize: 56 },
  successTitle: { fontSize: Typography.sizes.xl, fontWeight: '800', color: Colors.brown },
  successText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
});
