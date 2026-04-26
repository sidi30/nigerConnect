import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Comment } from '@nigerconnect/shared-types';
import { Avatar } from '../ui/Avatar';
import { Colors, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId, relativeTime } from '@/constants/lookups';

interface Props {
  comment: Comment;
  depth?: number;
  onReply?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string, content: string) => Promise<void> | void;
  currentUserId?: string;
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function CommentItem({
  comment,
  depth = 0,
  onReply,
  onDelete,
  onEdit,
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

  return (
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
            <Text style={styles.content}>{comment.content}</Text>
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
              {depth === 0 && onReply ? (
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
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: Spacing.sm,
  },
  reply: {
    marginLeft: Spacing.xxl + 6,
    paddingVertical: Spacing.xs + 2,
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
  actionBtn: {
    fontSize: Typography.sizes.xxs,
    fontWeight: '700',
    color: Colors.tan600,
  },
});
