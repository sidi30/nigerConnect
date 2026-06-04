import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Poll } from '@nigerconnect/shared-types';
import { pollsApi } from '@/services/pollsApi';
import { useAuthStore } from '@/stores/authStore';
import { relativeTime } from '@/constants/lookups';
import {
  Colors,
  Radii,
  Spacing,
  Typography,
} from '@/constants/theme';

interface Props {
  poll: Poll;
  /** True when the viewer administers the page this poll belongs to. */
  isPageAdmin?: boolean;
  onChanged?: () => void;
}

/**
 * Renders a poll with vote controls or results depending on state.
 * Single-choice: tap an option to vote immediately.
 * Multi-choice: toggle options, then press "Voter".
 */
export function PollCard({ poll, isPageAdmin = false, onChanged }: Props) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);

  // Local selection set for multi-choice before submitting
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isAuthor = !!me && poll.author?.id === me.id;
  // Author OR a page admin may delete (matches the API authorization).
  const canDelete = isAuthor || isPageAdmin;
  const hasVoted = poll.myVotes.length > 0;
  const showResults = poll.closed || hasVoted;

  const total = poll.voteCount;

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['polls'] });
    if (poll.pageId) {
      void qc.invalidateQueries({ queryKey: ['polls', 'page', poll.pageId] });
    }
    onChanged?.();
  }

  const voteMut = useMutation({
    mutationFn: (optionIds: string[]) => pollsApi.vote(poll.id, optionIds),
    onSuccess: () => invalidate(),
    onError: () => Alert.alert('Erreur', 'Impossible de voter. Réessaie.'),
  });

  const removeMut = useMutation({
    mutationFn: () => pollsApi.remove(poll.id),
    onSuccess: () => invalidate(),
    onError: () => Alert.alert('Erreur', 'Impossible de supprimer le sondage.'),
  });

  function handleSingleVote(optionId: string) {
    if (showResults || voteMut.isPending) return;
    voteMut.mutate([optionId]);
  }

  function toggleMulti(optionId: string) {
    if (showResults || voteMut.isPending) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  function submitMulti() {
    if (selected.size === 0) return;
    voteMut.mutate(Array.from(selected));
  }

  function confirmDelete() {
    Alert.alert('Supprimer le sondage', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => removeMut.mutate(),
      },
    ]);
  }

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.question}>{poll.question}</Text>
          {poll.author ? (
            <Text style={styles.meta}>
              Par {poll.author.displayName ??
                `${poll.author.firstName ?? ''} ${poll.author.lastName ?? ''}`.trim()} ·{' '}
              {relativeTime(poll.createdAt)}
            </Text>
          ) : null}
        </View>
        {canDelete ? (
          <Pressable
            onPress={confirmDelete}
            disabled={removeMut.isPending}
            hitSlop={8}
            style={styles.deleteBtn}
            accessibilityLabel="Supprimer le sondage"
          >
            <Text style={styles.deleteBtnLabel}>{removeMut.isPending ? '…' : '✕'}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Options */}
      <View style={styles.options}>
        {poll.options.map((opt) => {
          const pct = total > 0 ? opt.voteCount / total : 0;
          const pctPretty = Math.round(pct * 100);
          const isMine = poll.myVotes.includes(opt.id);
          const isSelectedLocal = selected.has(opt.id);

          if (showResults) {
            return (
              <View key={opt.id} style={[styles.resultRow, isMine && styles.resultRowMine]}>
                <View style={[styles.resultFill, { flex: pct === 0 ? undefined : pct }]} />
                <View style={styles.resultContent}>
                  <Text style={[styles.optionLabel, isMine && styles.optionLabelMine]}>
                    {opt.label}
                    {isMine ? ' ✓' : ''}
                  </Text>
                  <Text style={styles.optionPct}>{pctPretty}%</Text>
                </View>
              </View>
            );
          }

          // Voting UI
          if (poll.multiChoice) {
            return (
              <Pressable
                key={opt.id}
                onPress={() => toggleMulti(opt.id)}
                style={[styles.optionBtn, isSelectedLocal && styles.optionBtnSelected]}
              >
                <View
                  style={[
                    styles.checkbox,
                    isSelectedLocal && styles.checkboxChecked,
                  ]}
                >
                  {isSelectedLocal ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <Text style={[styles.optionLabel, isSelectedLocal && { color: Colors.orange }]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={opt.id}
              onPress={() => handleSingleVote(opt.id)}
              disabled={voteMut.isPending}
              style={({ pressed }) => [
                styles.optionBtn,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.optionLabel}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Multi-choice submit button */}
      {poll.multiChoice && !showResults ? (
        <Pressable
          onPress={submitMulti}
          disabled={selected.size === 0 || voteMut.isPending}
          style={[
            styles.voteBtn,
            (selected.size === 0 || voteMut.isPending) && { opacity: 0.5 },
          ]}
        >
          <Text style={styles.voteBtnLabel}>{voteMut.isPending ? '…' : 'Voter'}</Text>
        </Pressable>
      ) : null}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {total} vote{total !== 1 ? 's' : ''}
        </Text>
        {poll.closed ? (
          <Text style={[styles.footerText, { color: Colors.danger }]}>· Sondage clos</Text>
        ) : poll.expiresAt ? (
          <Text style={styles.footerText}>· Expire {relativeTime(poll.expiresAt)}</Text>
        ) : null}
      </View>
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
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  question: {
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    color: Colors.brown,
    lineHeight: 20,
  },
  meta: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan400,
    marginTop: 2,
  },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: Radii.md,
    backgroundColor: Colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnLabel: {
    color: Colors.danger,
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
  },
  options: { gap: 6 },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.cream,
  },
  optionBtnSelected: {
    borderColor: Colors.orange,
    backgroundColor: Colors.peach50,
  },
  optionLabel: {
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
    flex: 1,
  },
  optionLabelMine: { color: Colors.orange, fontWeight: '700' },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.tan300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: Colors.orange,
    backgroundColor: Colors.orange,
  },
  checkmark: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  // Results
  resultRow: {
    height: 38,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cream,
  },
  resultRowMine: {
    borderColor: Colors.orange,
  },
  resultFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.peach100,
  },
  resultContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  optionPct: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan500,
    fontWeight: '700',
  },
  voteBtn: {
    backgroundColor: Colors.orange,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.sm + 2,
    alignItems: 'center',
  },
  voteBtnLabel: {
    color: Colors.white,
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  footerText: {
    fontSize: Typography.sizes.xs,
    color: Colors.tan400,
  },
});
