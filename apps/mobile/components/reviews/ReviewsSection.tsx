import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewTargetType } from '@nigerconnect/shared-types';
import { Avatar } from '@/components/ui/Avatar';
import { Loader } from '@/components/ui/Loader';
import { StarRating } from '@/components/ui/StarRating';
import { reviewsApi } from '@/services/reviewsApi';
import { relativeTime } from '@/constants/lookups';
import {
  Colors,
  palette,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

interface Props {
  targetType: ReviewTargetType;
  targetId: string;
  canReview: boolean;
}

/**
 * Reusable reviews section for both user profiles and pages.
 * Shows summary (avg, distribution), a write-review form when canReview,
 * and the list of individual reviews.
 */
export function ReviewsSection({ targetType, targetId, canReview }: Props) {
  const qc = useQueryClient();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );

  const summaryQuery = useQuery({
    queryKey: ['reviews', targetType, targetId, 'summary'],
    queryFn: () => reviewsApi.summary(targetType, targetId),
    enabled: !!targetId,
  });

  const listQuery = useQuery({
    queryKey: ['reviews', targetType, targetId, 'list'],
    queryFn: () => reviewsApi.list(targetType, targetId),
    enabled: !!targetId,
  });

  const upsertMut = useMutation({
    mutationFn: () =>
      reviewsApi.upsert({ targetType, targetId, rating, comment: comment.trim() || undefined }),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Avis enregistré ✓' });
      void qc.invalidateQueries({ queryKey: ['reviews', targetType, targetId] });
      void qc.invalidateQueries({ queryKey: [targetType === 'user' ? 'user' : 'page', targetId] });
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setFeedback({ kind: 'error', message: msg ?? err.message ?? 'Impossible de soumettre.' });
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => reviewsApi.remove(id),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Avis supprimé.' });
      setRating(0);
      setComment('');
      void qc.invalidateQueries({ queryKey: ['reviews', targetType, targetId] });
      void qc.invalidateQueries({ queryKey: [targetType === 'user' ? 'user' : 'page', targetId] });
    },
    onError: (e) => {
      const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const apiMsg = err.response?.data?.message;
      const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
      setFeedback({ kind: 'error', message: msg ?? err.message ?? 'Impossible de supprimer.' });
    },
  });

  const summary = summaryQuery.data;
  const reviews = listQuery.data?.items ?? [];
  const myReview = summary?.myReview ?? null;
  const total = summary?.ratingCount ?? 0;

  // Pre-fill form from existing review
  function startEdit() {
    if (myReview) {
      setRating(myReview.rating);
      setComment(myReview.comment ?? '');
    } else {
      setRating(0);
      setComment('');
    }
    setFeedback(null);
  }

  function submitReview() {
    setFeedback(null);
    if (rating < 1) {
      setFeedback({ kind: 'error', message: 'Choisis une note (1–5 étoiles).' });
      return;
    }
    upsertMut.mutate();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Avis</Text>

      {summaryQuery.isLoading ? (
        <Loader style={{ marginTop: Spacing.sm }} />
      ) : summary ? (
        <>
          {/* Summary header */}
          <View style={styles.summaryRow}>
            <View style={styles.avgCol}>
              <Text style={styles.avgNumber}>
                {total > 0 ? summary.ratingAvg.toFixed(1) : '—'}
              </Text>
              <StarRating value={summary.ratingAvg} size={18} />
              <Text style={styles.countText}>{total} avis</Text>
            </View>

            {/* Distribution bars (5★ … 1★) */}
            <View style={styles.barsCol}>
              {[5, 4, 3, 2, 1].map((star, i) => {
                const starCount = summary.distribution[star - 1] ?? 0;
                const pct = total > 0 ? starCount / total : 0;
                return (
                  <View key={star} style={styles.barRow}>
                    <View style={styles.barLabel}>
                      <Text style={styles.barLabelText}>{star}</Text>
                      <Feather name="star" size={10} color={Colors.tan500} />
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { flex: pct }]} />
                      <View style={{ flex: 1 - pct }} />
                    </View>
                    <Text style={styles.barCount}>{starCount}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Write / edit / delete review form */}
          {canReview ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>
                {myReview ? 'Mon avis' : 'Laisser un avis'}
              </Text>

              <View style={styles.starsRow}>
                <StarRating
                  value={myReview && rating === 0 ? myReview.rating : rating}
                  size={28}
                  onChange={(v) => {
                    setRating(v);
                    setFeedback(null);
                  }}
                />
              </View>

              <TextInput
                style={styles.commentInput}
                placeholder="Ton commentaire (optionnel)…"
                placeholderTextColor={Colors.tan400}
                multiline
                numberOfLines={3}
                value={myReview && comment === '' && rating === 0 ? myReview.comment ?? '' : comment}
                onChangeText={(t) => {
                  setComment(t);
                  setFeedback(null);
                }}
                onFocus={startEdit}
              />

              <View style={styles.formActions}>
                <Pressable
                  onPress={submitReview}
                  disabled={upsertMut.isPending}
                  style={[styles.submitBtn, upsertMut.isPending && { opacity: 0.5 }]}
                >
                  <Text style={styles.submitLabel}>
                    {upsertMut.isPending ? '…' : myReview ? 'Modifier' : 'Publier'}
                  </Text>
                </Pressable>

                {myReview ? (
                  <Pressable
                    onPress={() => removeMut.mutate(myReview.id)}
                    disabled={removeMut.isPending}
                    style={styles.deleteBtn}
                    accessibilityLabel="Supprimer mon avis"
                  >
                    {removeMut.isPending ? (
                      <Text style={styles.deleteBtnLabel}>…</Text>
                    ) : (
                      <Feather name="x" size={18} color={Colors.danger} />
                    )}
                  </Pressable>
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
                    size={15}
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
            </View>
          ) : null}

          {/* Reviews list */}
          {listQuery.isLoading ? (
            <Loader style={{ marginTop: Spacing.sm }} />
          ) : reviews.length === 0 ? (
            <Text style={styles.emptyText}>Aucun avis pour le moment.</Text>
          ) : (
            <View style={styles.reviewsList}>
              {reviews.map((review) => (
                <View key={review.id} style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <Avatar
                      uri={review.author.avatarUrl}
                      name={
                        review.author.displayName ??
                        `${review.author.firstName ?? ''} ${review.author.lastName ?? ''}`.trim()
                      }
                      size={36}
                      border={false}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.authorName}>
                        {review.author.displayName ??
                          `${review.author.firstName ?? ''} ${review.author.lastName ?? ''}`.trim()}
                      </Text>
                      <View style={styles.ratingRow}>
                        <StarRating value={review.rating} size={12} />
                        <Text style={styles.timeText}>{relativeTime(review.createdAt)}</Text>
                      </View>
                    </View>
                  </View>
                  {review.comment ? (
                    <Text style={styles.reviewComment}>{review.comment}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </>
      ) : summaryQuery.isError ? (
        <Text style={styles.emptyText}>Impossible de charger les avis.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.md,
    fontWeight: '800',
    color: Colors.brown,
    marginBottom: Spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  avgCol: {
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  avgNumber: {
    fontSize: Typography.sizes.display,
    fontWeight: '800',
    color: Colors.brown,
    lineHeight: 34,
  },
  countText: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
  },
  barsCol: {
    flex: 1,
    gap: 4,
    justifyContent: 'center',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  barLabel: {
    width: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  barLabelText: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: Radii.full,
    backgroundColor: Colors.tan200,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  barFill: {
    backgroundColor: Colors.orange,
    borderRadius: Radii.full,
  },
  barCount: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
    width: 20,
  },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  formTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.brown,
  },
  starsRow: {
    alignItems: 'flex-start',
  },
  commentInput: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: Typography.sizes.md,
    backgroundColor: Colors.cream,
    color: Colors.brown,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  submitBtn: {
    flex: 1,
    backgroundColor: Colors.orange,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.sm + 2,
    alignItems: 'center',
  },
  submitLabel: {
    color: Colors.white,
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
  },
  deleteBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.lg,
    backgroundColor: Colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnLabel: {
    color: Colors.danger,
    fontSize: Typography.sizes.md,
    fontWeight: '700',
  },
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
  reviewsList: { gap: Spacing.sm },
  reviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  authorName: {
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.brown,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  timeText: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan400,
  },
  reviewComment: {
    fontSize: Typography.sizes.sm,
    color: Colors.brownSoft,
    lineHeight: 19,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    marginBottom: Spacing.md,
  },
});
