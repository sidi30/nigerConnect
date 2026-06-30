import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { HeartBurst } from '../ui/HeartBurst';
import { ReactionBar } from './ReactionBar';
import type { Comment } from '@nigerconnect/shared-types';
import { Avatar } from '../ui/Avatar';
import { MentionText } from '../ui/MentionText';
import { Colors, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId, relativeTime } from '@/constants/lookups';

interface Props {
  comment: Comment;
  depth?: number;
  onReply?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string, content: string) => Promise<void> | void;
  onLike?: (commentId: string, emoji?: string) => void;
  currentUserId?: string;
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;
// 3 indentation levels: root (0) → reply (1) → reply-to-reply (2). Replying is
// offered up to MAX_DEPTH-1 so a new reply never exceeds level 3.
const MAX_DEPTH = 2;

export function CommentItem({
  comment,
  depth = 0,
  onReply,
  onDelete,
  onEdit,
  onLike,
  currentUserId,
}: Props) {
  const router = useRouter();
  const author = comment.author;
  const isMine = author.id === currentUserId;
  const canEdit =
    isMine && Date.now() - new Date(comment.createdAt).getTime() < EDIT_WINDOW_MS;
  const goToAuthor = () => router.push(`/user/${author.id}`);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const [myReaction, setMyReaction] = useState<string | null>(
    comment.myReaction ?? (comment.isLikedByMe ? '❤️' : null),
  );
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [burst, setBurst] = useState(0);
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const heartScale = useSharedValue(1);
  const liked = myReaction !== null;

  const heartAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  function react(emoji: string) {
    setReactionBarOpen(false);
    setMyReaction((prev) => {
      const up = prev !== emoji;
      if (prev === emoji) setLikeCount((c) => Math.max(0, c - 1));
      else if (prev === null) setLikeCount((c) => c + 1);
      heartScale.value = withSequence(
        withTiming(up ? 1.35 : 0.85, { duration: 110 }),
        withSpring(1, { damping: 6, stiffness: 220 }),
      );
      if (up && emoji === '❤️') setBurst((n) => n + 1);
      onLike?.(comment.id, emoji);
      return prev === emoji ? null : emoji;
    });
  }

  function handleLike() {
    react(myReaction ?? '❤️');
  }

  async function submitEdit() {
    if (!onEdit) return;
    const next = draft.trim();
    if (!next || next === comment.content) {
      setEditing(false);
      setDraft(comment.content);
      return;
    }
    setSaving(true);
    try {
      await onEdit(comment.id, next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const replies = comment.replies ?? [];

  return (
    <View>
    <View style={[styles.wrap, depth > 0 && styles.reply]}>
      <Pressable onPress={goToAuthor} hitSlop={4}>
        <Avatar
          uri={author.avatarUrl}
          name={author.displayName ?? author.firstName ?? 'N'}
          size={depth > 0 ? 30 : 36}
          borderColor={colorForId(author.id)}
        />
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={styles.bubble}>
          <Pressable onPress={goToAuthor} hitSlop={2}>
            <Text style={styles.name} numberOfLines={1}>
              {author.displayName ??
                `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim()}
            </Text>
          </Pressable>
          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              editable={!saving}
              style={styles.editInput}
              placeholderTextColor={Colors.tan400}
              maxLength={1000}
            />
          ) : (
            <MentionText content={comment.content} style={styles.content} />
          )}
        </View>
        <View style={styles.actions}>
          <Text style={styles.time}>{relativeTime(comment.createdAt)}</Text>
          {editing ? (
            <>
              <Pressable onPress={submitEdit} disabled={saving} hitSlop={8}>
                <Text style={[styles.actionBtn, { color: Colors.orange }]}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setEditing(false);
                  setDraft(comment.content);
                }}
                hitSlop={8}
              >
                <Text style={styles.actionBtn}>Annuler</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.likeWrap}>
                <ReactionBar
                  visible={reactionBarOpen}
                  onSelect={react}
                  onClose={() => setReactionBarOpen(false)}
                />
                <Pressable
                  onPress={handleLike}
                  onLongPress={() => setReactionBarOpen(true)}
                  delayLongPress={220}
                  hitSlop={8}
                  style={styles.likeBtn}
                  accessibilityLabel={liked ? 'Retirer ma réaction' : 'Réagir au commentaire'}
                >
                  <View>
                    <Animated.View style={heartAnimStyle}>
                      {myReaction ? (
                        <Text style={styles.commentReactionEmoji}>{myReaction}</Text>
                      ) : (
                        <Feather name="heart" size={13} color={Colors.tan500} />
                      )}
                    </Animated.View>
                    <View pointerEvents="none" style={styles.commentBurst}>
                      <HeartBurst trigger={burst} size={13} particles={false} />
                    </View>
                  </View>
                  {likeCount > 0 ? (
                    <Text style={[styles.actionBtn, liked && { color: Colors.danger }]}>
                      {likeCount}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
              {depth < MAX_DEPTH && onReply ? (
                <Pressable onPress={() => onReply(comment.id)} hitSlop={8}>
                  <Text style={styles.actionBtn}>Répondre</Text>
                </Pressable>
              ) : null}
              {canEdit && onEdit ? (
                <Pressable onPress={() => setEditing(true)} hitSlop={8}>
                  <Text style={styles.actionBtn}>Modifier</Text>
                </Pressable>
              ) : null}
              {isMine && onDelete ? (
                <Pressable onPress={() => onDelete(comment.id)} hitSlop={8}>
                  <Text style={[styles.actionBtn, { color: Colors.danger }]}>Supprimer</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
    {replies.length > 0 ? (
      <View style={styles.repliesContainer}>
        {replies.map((r) => (
          <CommentItem
            key={r.id}
            comment={r}
            depth={depth + 1}
            onReply={onReply}
            onDelete={onDelete}
            onEdit={onEdit}
            onLike={onLike}
            currentUserId={currentUserId}
          />
        ))}
      </View>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: Spacing.sm,
  },
  reply: {
    paddingVertical: Spacing.xs + 2,
  },
  // Indents each nesting level; compounds through recursion (levels 2 and 3).
  // A left rail hints the thread without eating too much width on a phone.
  repliesContainer: {
    marginLeft: 22,
    borderLeftWidth: 1,
    borderLeftColor: Colors.tan200,
    paddingLeft: Spacing.sm,
  },
  bubble: {
    backgroundColor: Colors.tan100,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  name: {
    fontSize: Typography.sizes.xs + 1,
    fontWeight: '700',
    color: Colors.brown,
  },
  content: {
    fontSize: Typography.sizes.sm + 1,
    color: Colors.brownSoft,
    marginTop: 2,
    lineHeight: 19,
  },
  editInput: {
    fontSize: Typography.sizes.sm + 1,
    color: Colors.brown,
    marginTop: 4,
    minHeight: 36,
    backgroundColor: palette.white,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.tan300,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: 4,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
  },
  time: { fontSize: Typography.sizes.xxs, color: Colors.tan400 },
  likeWrap: { position: 'relative' },
  commentReactionEmoji: { fontSize: 13, lineHeight: 16 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  commentBurst: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '700',
    color: Colors.tan600,
  },
});
