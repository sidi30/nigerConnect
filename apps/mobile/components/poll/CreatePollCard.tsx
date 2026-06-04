import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pollsApi } from '@/services/pollsApi';
import {
  Colors,
  palette,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

interface Props {
  pageId?: string;
  onCreated?: () => void;
}

const EXPIRY_OPTIONS: Array<{ label: string; hours: number | null }> = [
  { label: 'Aucune', hours: null },
  { label: '24h', hours: 24 },
  { label: '3j', hours: 72 },
  { label: '7j', hours: 168 },
];

/**
 * Inline poll composer. Validates question + >=2 non-empty options.
 * Expiry chip selection (24h / 3j / 7j / aucune) + multiChoice switch.
 */
export function CreatePollCard({ pageId, onCreated }: Props) {
  const qc = useQueryClient();

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiChoice, setMultiChoice] = useState(false);
  const [expiryHours, setExpiryHours] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  const createMut = useMutation({
    mutationFn: () =>
      pollsApi.create({
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        multiChoice,
        pageId,
        expiresInHours: expiryHours ?? undefined,
      }),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Sondage créé ✓' });
      setQuestion('');
      setOptions(['', '']);
      setMultiChoice(false);
      setExpiryHours(null);
      void qc.invalidateQueries({ queryKey: ['polls'] });
      if (pageId) void qc.invalidateQueries({ queryKey: ['polls', 'page', pageId] });
      onCreated?.();
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setFeedback({ kind: 'error', message: msg ?? err.message ?? 'Impossible de créer.' });
    },
  });

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    if (options.length >= 6) return;
    setOptions((prev) => [...prev, '']);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    setFeedback(null);
    if (!question.trim()) {
      setFeedback({ kind: 'error', message: 'La question est requise.' });
      return;
    }
    const filled = options.map((o) => o.trim()).filter(Boolean);
    if (filled.length < 2) {
      setFeedback({ kind: 'error', message: 'Au minimum 2 options sont requises.' });
      return;
    }
    createMut.mutate();
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Créer un sondage</Text>

      <TextInput
        style={styles.questionInput}
        placeholder="Ta question…"
        placeholderTextColor={Colors.tan400}
        value={question}
        onChangeText={(t) => {
          setQuestion(t);
          setFeedback(null);
        }}
        multiline
      />

      <Text style={styles.label}>Options</Text>
      {options.map((opt, i) => (
        <View key={i} style={styles.optionRow}>
          <TextInput
            style={[styles.optionInput, { flex: 1 }]}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={Colors.tan400}
            value={opt}
            onChangeText={(t) => updateOption(i, t)}
          />
          {options.length > 2 ? (
            <Pressable
              onPress={() => removeOption(i)}
              hitSlop={8}
              style={styles.removeBtn}
              accessibilityLabel={`Supprimer l'option ${i + 1}`}
            >
              <Text style={styles.removeBtnLabel}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {options.length < 6 ? (
        <Pressable onPress={addOption} style={styles.addOptionBtn}>
          <Text style={styles.addOptionLabel}>＋ Ajouter une option</Text>
        </Pressable>
      ) : null}

      {/* Multi-choice switch */}
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Choix multiple</Text>
          <Text style={styles.switchHint}>Autoriser plusieurs réponses</Text>
        </View>
        <Switch
          value={multiChoice}
          onValueChange={setMultiChoice}
          trackColor={{ false: Colors.tan300, true: Colors.orange }}
          thumbColor={Colors.white}
        />
      </View>

      {/* Expiry chips */}
      <Text style={styles.label}>Expiration</Text>
      <View style={styles.expiryRow}>
        {EXPIRY_OPTIONS.map((opt) => {
          const active = expiryHours === opt.hours;
          return (
            <Pressable
              key={opt.label}
              onPress={() => setExpiryHours(opt.hours)}
              style={[styles.expiryChip, active && styles.expiryChipActive]}
            >
              <Text style={[styles.expiryLabel, active && { color: Colors.orange, fontWeight: '700' }]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
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
          <Text style={styles.feedbackIcon}>{feedback.kind === 'success' ? '✅' : '⚠️'}</Text>
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

      <Pressable
        onPress={submit}
        disabled={createMut.isPending}
        style={[styles.submitBtn, createMut.isPending && { opacity: 0.5 }]}
      >
        <Text style={styles.submitLabel}>{createMut.isPending ? '…' : 'Publier le sondage'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  cardTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '800',
    color: Colors.brown,
  },
  label: {
    fontSize: Typography.sizes.xs + 1,
    fontWeight: '700',
    color: Colors.tan600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.xs,
  },
  questionInput: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.cream,
    color: Colors.brown,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  optionInput: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.cream,
    color: Colors.brown,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: Radii.md,
    backgroundColor: Colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnLabel: { color: Colors.danger, fontSize: 14, fontWeight: '700' },
  addOptionBtn: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
  },
  addOptionLabel: {
    color: Colors.orange,
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm + 2,
    backgroundColor: Colors.cream,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  switchLabel: { fontSize: Typography.sizes.sm, fontWeight: '700', color: Colors.brown },
  switchHint: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 1 },
  expiryRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  expiryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.full,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.cream,
  },
  expiryChipActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  expiryLabel: { fontSize: Typography.sizes.sm, color: Colors.brown },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: Radii.lg,
    padding: Spacing.sm + 2,
  },
  feedbackSuccess: { backgroundColor: palette.successBg, borderColor: palette.successBorder },
  feedbackError: { backgroundColor: palette.errorBg, borderColor: palette.errorBorder },
  feedbackIcon: { fontSize: 14 },
  feedbackText: { flex: 1, fontSize: Typography.sizes.sm, fontWeight: '500', lineHeight: 18 },
  submitBtn: {
    backgroundColor: Colors.orange,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.sm + 4,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  submitLabel: {
    color: Colors.white,
    fontSize: Typography.sizes.md,
    fontWeight: '700',
  },
});
