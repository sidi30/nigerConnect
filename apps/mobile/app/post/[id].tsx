import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Comment, CursorPage } from '@nigerconnect/shared-types';
import { PostCard } from '@/components/feed/PostCard';
import { CommentItem } from '@/components/feed/CommentItem';
import { MentionInput } from '@/components/ui/MentionInput';
import { FeedCardSkeleton, CommentSkeletonList } from '@/components/ui/Skeleton';
import { feedApi } from '@/services/feedApi';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const inputRef = useRef<TextInput>(null);

  const [draft, setDraft] = useState('');
  // Bumped after a successful send to clear the MentionInput's internal text.
  const [composerReset, setComposerReset] = useState(0);
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);

  const postQuery = useQuery({
    queryKey: ['post', id],
    queryFn: () => feedApi.getPost(id!),
    enabled: !!id,
  });
  const commentsQuery = useQuery({
    queryKey: ['post', id, 'comments'],
    queryFn: () => feedApi.getComments(id!),
    enabled: !!id,
  });

  const commentMut = useMutation({
    mutationFn: (input: { content: string; parentId?: string }) =>
      feedApi.comment(id!, input.content, input.parentId),
    onSuccess: () => {
      setDraft('');
      setComposerReset((n) => n + 1);
      setReplyTo(null);
      void qc.invalidateQueries({ queryKey: ['post', id, 'comments'] });
      void qc.invalidateQueries({ queryKey: ['post', id] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: () => toast.error('Commentaire non envoyé, réessaie'),
  });

  const deleteMut = useMutation({
    mutationFn: (commentId: string) => feedApi.deleteComment(commentId),
    // Optimistic: drop the comment (and any nested reply) from the cached page immediately
    onMutate: async (commentId) => {
      await qc.cancelQueries({ queryKey: ['post', id, 'comments'] });
      const prev = qc.getQueryData<CursorPage<Comment>>(['post', id, 'comments']);
      qc.setQueryData<CursorPage<Comment>>(['post', id, 'comments'], (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items
            .filter((c) => c.id !== commentId)
            .map((c) => ({
              ...c,
              replies: (c.replies ?? []).filter((r) => r.id !== commentId),
            })),
        };
      });
      return { prev };
    },
    onError: (_e, _commentId, ctx) => {
      if (ctx?.prev) qc.setQueryData(['post', id, 'comments'], ctx.prev);
      toast.error('Suppression impossible');
    },
    // Re-sync with the server: list, post comment counter, and the feed card counter.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['post', id, 'comments'] });
      void qc.invalidateQueries({ queryKey: ['post', id] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const editMut = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      feedApi.editComment(commentId, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['post', id, 'comments'] });
      void qc.invalidateQueries({ queryKey: ['post', id] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
    onError: () => toast.error('Modification non enregistrée'),
  });

  const likeMut = useMutation({
    mutationFn: (emoji?: string) => feedApi.toggleLike(id!, emoji),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['post', id] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  // CommentItem owns the optimistic UI; this just persists the toggle and
  // reconciles on error (refetch restores the true server state).
  const commentLikeMut = useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji?: string }) =>
      feedApi.toggleCommentLike(commentId, emoji),
    onError: () => {
      toast.error("Action impossible");
      void qc.invalidateQueries({ queryKey: ['post', id, 'comments'] });
    },
  });

  function handleSend() {
    if (!draft.trim()) return;
    commentMut.mutate({ content: draft.trim(), parentId: replyTo?.id });
  }

  function handleReply(commentId: string) {
    const root = commentsQuery.data?.items.find((c) => c.id === commentId);
    setReplyTo({
      id: commentId,
      author: root?.author.displayName ?? root?.author.firstName ?? 'utilisateur',
    });
    inputRef.current?.focus();
  }

  function handleDelete(commentId: string) {
    Alert.alert('Supprimer ce commentaire ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteMut.mutate(commentId) },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={15} style={styles.back}>
          <Feather name="arrow-left" size={26} color={Colors.brown} />
        </Pressable>
        <Text style={styles.title}>Publication</Text>
        <View style={{ width: 34 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <FlatList<Comment>
          data={commentsQuery.data?.items ?? []}
          keyExtractor={(c) => c.id}
          ListHeaderComponent={
            postQuery.isLoading ? (
              <View>
                <FeedCardSkeleton />
                <CommentSkeletonList count={3} />
              </View>
            ) : postQuery.data ? (
              <View>
                <PostCard
                  post={postQuery.data}
                  onLike={(_postId, emoji) => likeMut.mutate(emoji)}
                  onPhotoPress={(photos, index) =>
                    router.push({
                      pathname: '/photos/viewer',
                      params: { photos: JSON.stringify(photos), index: String(index) },
                    } as never)
                  }
                />
                <View style={styles.commentsHeader}>
                  <Text style={styles.commentsTitle}>
                    Commentaires ({postQuery.data.commentCount})
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.loading}>Introuvable</Text>
            )
          }
          renderItem={({ item }) => (
            <View style={styles.commentBlock}>
              <CommentItem
                comment={item}
                depth={0}
                onReply={handleReply}
                onDelete={handleDelete}
                onEdit={(commentId, content) =>
                  editMut.mutateAsync({ commentId, content }).then(() => undefined)
                }
                onLike={(commentId, emoji) => commentLikeMut.mutate({ commentId, emoji })}
                currentUserId={me?.id}
              />
              {/* Nested replies (levels 2 & 3) are rendered recursively inside CommentItem. */}
            </View>
          )}
          ListEmptyComponent={
            !commentsQuery.isLoading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Aucun commentaire encore.</Text>
                <Text style={styles.emptyHint}>Sois le premier à réagir ✨</Text>
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: Spacing.md }}
        />

        {replyTo ? (
          <View style={styles.replyHint}>
            <Text style={styles.replyHintText}>
              Réponse à <Text style={styles.replyHintName}>{replyTo.author}</Text>
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={10}>
              <Feather name="x" size={16} color={Colors.tan500} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.composer}>
          <MentionInput
            inputRef={inputRef}
            containerStyle={{ flex: 1 }}
            style={styles.input}
            placeholder={replyTo ? 'Écris une réponse… (@ pour mentionner)' : 'Ajouter un commentaire… (@ pour mentionner)'}
            placeholderTextColor={Colors.tan400}
            onChangeContent={setDraft}
            resetSignal={composerReset}
            multiline
            maxLength={1000}
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || commentMut.isPending}
            style={[
              styles.sendBtn,
              (!draft.trim() || commentMut.isPending) && { opacity: 0.5 },
            ]}
          >
            <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
            {commentMut.isPending ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Feather name="send" size={16} color={Colors.white} />
            )}
          </Pressable>
        </View>
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
    backgroundColor: Colors.cream,
  },
  back: { width: 34 },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  loading: { padding: Spacing.xl, textAlign: 'center', color: Colors.tan500 },
  commentsHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  commentsTitle: { fontSize: Typography.sizes.md, fontWeight: '800', color: Colors.brown },
  commentBlock: { paddingHorizontal: Spacing.md },
  empty: { padding: Spacing.xxl, alignItems: 'center' },
  emptyText: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.tan500 },
  emptyHint: { fontSize: Typography.sizes.sm, color: Colors.tan400, marginTop: 4 },
  replyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.peach50,
    borderTopWidth: 1,
    borderTopColor: Colors.peach100,
  },
  replyHintText: { flex: 1, fontSize: Typography.sizes.xs + 1, color: Colors.tan600 },
  replyHintName: { color: Colors.orange, fontWeight: '700' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.tan200,
  },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    borderRadius: Radii.xxl,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm + 2,
    maxHeight: 100,
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    backgroundColor: Colors.cream,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
