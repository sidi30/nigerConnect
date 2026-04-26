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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { feedApi } from '@/services/feedApi';
import {
  Colors,
  Gradients,
  palette,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

type Visibility = 'public' | 'friends' | 'association';

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('friends');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  const postQuery = useQuery({
    queryKey: ['post', id],
    queryFn: () => feedApi.getPost(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (postQuery.data) {
      setContent(postQuery.data.content ?? '');
      setVisibility((postQuery.data.visibility as Visibility) ?? 'friends');
    }
  }, [postQuery.data]);

  const mut = useMutation({
    mutationFn: () =>
      feedApi.updatePost(id!, {
        content: content.trim(),
        visibility,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['post', id] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      setFeedback({ kind: 'success', message: 'Modifications enregistrées ✓' });
      setTimeout(() => router.back(), 700);
    },
    onError: (e) => {
      const err = e as {
        response?: { data?: { message?: string | string[] } };
        message?: string;
      };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setFeedback({ kind: 'error', message: msg ?? err.message ?? "Échec de l'enregistrement." });
    },
  });

  if (postQuery.isLoading || !postQuery.data) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Colors.orange} style={{ marginTop: Spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Modifier</Text>
        <Pressable
          onPress={() => mut.mutate()}
          disabled={mut.isPending}
          style={[styles.publish, mut.isPending && { opacity: 0.5 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>{mut.isPending ? '…' : 'Enregistrer'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            Tu peux modifier une publication dans les 24 h suivant sa création.
          </Text>

          <Text style={styles.label}>Visibilité</Text>
          <View style={styles.visRow}>
            {(['public', 'friends'] as const).map((v) => (
              <Pressable
                key={v}
                onPress={() => setVisibility(v)}
                style={[styles.visChip, visibility === v && styles.visChipActive]}
              >
                <Text
                  style={[
                    styles.visLabel,
                    visibility === v && { color: Colors.orange },
                  ]}
                >
                  {v === 'public' ? '🌍 Public' : '👥 Amis'}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="Que veux-tu partager ?"
            placeholderTextColor={Colors.tan400}
            multiline
            style={styles.textarea}
            maxLength={5000}
          />
          <Text style={styles.counter}>{content.length} / 5000</Text>

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
    gap: Spacing.md,
  },
  cancel: { color: Colors.tan500, fontSize: Typography.sizes.md, fontWeight: '600' },
  title: { flex: 1, textAlign: 'center', fontSize: Typography.sizes.md + 1, fontWeight: '700', color: Colors.brown },
  publish: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  publishLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  hint: {
    fontSize: Typography.sizes.xs + 1,
    color: Colors.tan500,
    marginBottom: Spacing.sm,
    lineHeight: 17,
  },
  label: {
    fontSize: Typography.sizes.xs + 1,
    fontWeight: '700',
    color: Colors.tan600,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  visRow: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md },
  visChip: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  visChipActive: { borderColor: Colors.orange, backgroundColor: Colors.peach50 },
  visLabel: { fontSize: Typography.sizes.sm, fontWeight: '600', color: Colors.brown },
  textarea: {
    minHeight: 160,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    padding: Spacing.md + 2,
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    backgroundColor: Colors.white,
    textAlignVertical: 'top',
  },
  counter: {
    alignSelf: 'flex-end',
    fontSize: Typography.sizes.xs,
    color: Colors.tan400,
    marginTop: -4,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  feedbackSuccess: { backgroundColor: palette.successBg, borderColor: palette.successBorder },
  feedbackError: { backgroundColor: palette.errorBg, borderColor: palette.errorBorder },
  feedbackIcon: { fontSize: 16, lineHeight: 20 },
  feedbackText: { flex: 1, fontSize: Typography.sizes.sm, fontWeight: '500', lineHeight: 20 },
});
