import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Post } from '@nigerconnect/shared-types';
import { Avatar } from './ui/Avatar';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

interface Props {
  post: Post;
  onLike?: (postId: string) => void;
  onOpenComments?: (postId: string) => void;
}

export function PostCard({ post, onLike, onOpenComments }: Props) {
  const [liked, setLiked] = useState(post.isLikedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const firstMedia = post.media[0];

  function handleLike() {
    setLiked((prev) => {
      const next = !prev;
      setLikeCount((c) => c + (next ? 1 : -1));
      return next;
    });
    onLike?.(post.id);
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar uri={post.author.avatarUrl} name={post.author.displayName} size={40} />
        <View style={{ flex: 1, marginLeft: Spacing.md }}>
          <Text style={styles.name}>{post.author.displayName ?? 'Utilisateur'}</Text>
          <Text style={styles.meta}>
            {post.author.city ? `${post.author.city} · ` : ''}{formatTime(post.createdAt)}
          </Text>
        </View>
      </View>

      {post.content ? <Text style={styles.content}>{post.content}</Text> : null}

      {firstMedia ? (
        <Image
          source={{ uri: firstMedia.mediaUrl }}
          placeholder={firstMedia.blurhash ?? undefined}
          contentFit="cover"
          style={styles.media}
        />
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={handleLike} style={styles.action} hitSlop={10}>
          <Text style={[styles.actionIcon, liked && { color: Colors.orange }]}>
            {liked ? '♥' : '♡'}
          </Text>
          <Text style={styles.actionLabel}>{likeCount}</Text>
        </Pressable>
        <Pressable onPress={() => onOpenComments?.(post.id)} style={styles.action} hitSlop={10}>
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionLabel}>{post.commentCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'à l\'instant';
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}j`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    padding: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  name: { fontSize: Typography.sizes.md, fontWeight: '600', color: Colors.brown },
  meta: { fontSize: Typography.sizes.xs, color: Colors.gray500, marginTop: 2 },
  content: {
    fontSize: Typography.sizes.md,
    color: Colors.brown,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  media: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: Radii.md,
    backgroundColor: Colors.gray100,
    marginBottom: Spacing.md,
  },
  actions: { flexDirection: 'row', gap: Spacing.xl },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  actionIcon: { fontSize: 22, color: Colors.gray600 },
  actionLabel: { fontSize: Typography.sizes.sm, color: Colors.gray600 },
});
