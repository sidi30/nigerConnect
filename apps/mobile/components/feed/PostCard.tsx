import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Post, SharedPost } from '@nigerconnect/shared-types';
import { Avatar } from '../ui/Avatar';
import { NCImage } from '../ui/NCImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { Colors, palette, Radii, Spacing, Typography } from '@/constants/theme';
import { colorForId, relativeTime } from '@/constants/lookups';

interface Props {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onComment?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onPhotoPress?: (photos: string[], index: number) => void;
  onEdit?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  onReport?: (postId: string) => void;
}

/**
 * Memoised so that scrolling the feed (which mutates intra-page React Query
 * caches and triggers parent re-renders) doesn't re-mount every card. The
 * comparator covers the fields that actually drive the render: identity,
 * counters, like state, and the author avatar/name. Callbacks are reference-
 * stable from the parent (`useCallback`), so we don't have to compare them.
 */
function arePostPropsEqual(prev: Props, next: Props): boolean {
  if (prev.post === next.post) return true;
  if (prev.post.id !== next.post.id) return false;
  return (
    prev.post.likeCount === next.post.likeCount &&
    prev.post.commentCount === next.post.commentCount &&
    prev.post.shareCount === next.post.shareCount &&
    prev.post.isLikedByMe === next.post.isLikedByMe &&
    prev.post.content === next.post.content &&
    prev.post.author.avatarUrl === next.post.author.avatarUrl &&
    prev.post.author.displayName === next.post.author.displayName &&
    prev.currentUserId === next.currentUserId
  );
}

function PostCardImpl({
  post,
  currentUserId,
  onLike,
  onComment,
  onShare,
  onPhotoPress,
  onEdit,
  onDelete,
  onReport,
}: Props) {
  const router = useRouter();
  const author = post.author;
  const [liked, setLiked] = useState(post.isLikedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [menuOpen, setMenuOpen] = useState(false);

  const isOwn = currentUserId && currentUserId === author.id;
  const goToAuthor = () => router.push(`/user/${author.id}`);

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
        <Pressable onPress={goToAuthor} hitSlop={4}>
          <Avatar
            uri={author.avatarUrl}
            name={author.displayName ?? author.firstName ?? 'N'}
            size={42}
            borderColor={colorForId(author.id)}
          />
        </Pressable>
        <Pressable onPress={goToAuthor} style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {author.displayName ?? `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim()}
            </Text>
            {author.identityStatus === 'approved' && <VerifiedBadge />}
          </View>
          <Text style={styles.meta}>
            {author.city ? `${author.city} · ` : ''}
            {relativeTime(post.createdAt)}
          </Text>
        </Pressable>
        <View>
          <Pressable hitSlop={10} onPress={() => setMenuOpen((v) => !v)}>
            <Text style={styles.more}>⋯</Text>
          </Pressable>
          {menuOpen ? (
            <>
              <Pressable
                style={styles.menuBackdrop}
                onPress={() => setMenuOpen(false)}
                accessibilityLabel="Fermer le menu"
              />
              <View style={styles.menu}>
                {isOwn ? (
                  <>
                    <Pressable
                      style={styles.menuItem}
                      onPress={() => {
                        setMenuOpen(false);
                        onEdit?.(post.id);
                      }}
                    >
                      <Text style={styles.menuText}>✏️  Modifier</Text>
                    </Pressable>
                    <Pressable
                      style={styles.menuItem}
                      onPress={() => {
                        setMenuOpen(false);
                        onDelete?.(post.id);
                      }}
                    >
                      <Text style={[styles.menuText, { color: Colors.danger }]}>🗑️  Supprimer</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      setMenuOpen(false);
                      onReport?.(post.id);
                    }}
                  >
                    <Text style={styles.menuText}>🚩  Signaler</Text>
                  </Pressable>
                )}
              </View>
            </>
          ) : null}
        </View>
      </View>

      {post.content ? <Text style={styles.content}>{post.content}</Text> : null}

      {post.media.length > 0 ? (
        <PhotoGallery
          photos={post.media.map((m) => m.mediaUrl)}
          onPress={onPhotoPress}
        />
      ) : null}

      {post.sharedPost ? (
        <SharedPostPreview
          shared={post.sharedPost}
          onPhotoPress={onPhotoPress}
          onOpen={() => router.push(`/post/${post.sharedPost!.id}`)}
        />
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          icon={liked ? '❤️' : '🤍'}
          label={String(likeCount)}
          active={liked}
          onPress={handleLike}
        />
        <ActionButton
          icon="💬"
          label={String(post.commentCount)}
          onPress={() => onComment?.(post.id)}
        />
        <ActionButton
          icon="🔄"
          label={String(post.shareCount)}
          onPress={() => onShare?.(post.id)}
        />
        <ActionButton icon="📤" />
      </View>
    </View>
  );
}

export const PostCard = memo(PostCardImpl, arePostPropsEqual);

function SharedPostPreview({
  shared,
  onPhotoPress,
  onOpen,
}: {
  shared: SharedPost;
  onPhotoPress?: (photos: string[], index: number) => void;
  onOpen: () => void;
}) {
  const author = shared.author;
  const name =
    author.displayName ?? `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim() ?? 'Anonyme';
  return (
    <Pressable onPress={onOpen} style={styles.shared}>
      <View style={styles.sharedHeader}>
        <Avatar uri={author.avatarUrl} name={name} size={28} borderColor={colorForId(author.id)} />
        <Text style={styles.sharedName} numberOfLines={1}>
          {name}
        </Text>
        {author.identityStatus === 'approved' && <VerifiedBadge size={11} />}
        <Text style={styles.sharedTime}>· {relativeTime(shared.createdAt)}</Text>
      </View>
      {shared.content ? (
        <Text style={styles.sharedContent} numberOfLines={4}>
          {shared.content}
        </Text>
      ) : null}
      {shared.media.length > 0 ? (
        <PhotoGallery
          photos={shared.media.map((m) => m.mediaUrl)}
          onPress={onPhotoPress}
        />
      ) : null}
    </Pressable>
  );
}

function PhotoGallery({
  photos,
  onPress,
}: {
  photos: string[];
  onPress?: (photos: string[], index: number) => void;
}) {
  if (photos.length === 1) {
    return (
      <Pressable onPress={() => onPress?.(photos, 0)}>
        <NCImage source={{ uri: photos[0] }} style={styles.singlePhoto} recyclingKey={photos[0]} />
      </Pressable>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gallery}>
      {photos.map((ph, i) => (
        <Pressable key={i} onPress={() => onPress?.(photos, i)}>
          <NCImage source={{ uri: ph }} style={styles.galleryPhoto} recyclingKey={ph} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ActionButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label?: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.action} hitSlop={8}>
      <Text style={[styles.actionIcon, active && { color: Colors.orange }]}>{icon}</Text>
      {label ? <Text style={styles.actionLabel}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.tan200,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.md + 2,
    paddingTop: Spacing.md + 2,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  name: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.brown },
  meta: { fontSize: Typography.sizes.xs, color: Colors.tan500, marginTop: 2 },
  more: { fontSize: 18, color: Colors.tan400, paddingHorizontal: Spacing.xs },
  content: {
    fontSize: Typography.sizes.md,
    lineHeight: 21,
    color: Colors.brownSoft,
    paddingHorizontal: Spacing.md + 2,
    marginTop: Spacing.sm + 2,
    marginBottom: Spacing.md,
  },
  shared: {
    marginHorizontal: Spacing.md + 2,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.tan200,
    borderRadius: Radii.md,
    padding: Spacing.md,
    backgroundColor: Colors.tan50 ?? '#FAF6F0',
    gap: 6,
  },
  sharedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sharedName: {
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.brown,
    flexShrink: 1,
  },
  sharedTime: { fontSize: Typography.sizes.xs, color: Colors.tan500 },
  sharedContent: {
    fontSize: Typography.sizes.sm,
    lineHeight: 19,
    color: Colors.brownSoft,
  },
  singlePhoto: { width: '100%', height: 240, backgroundColor: Colors.tan100 },
  gallery: { paddingHorizontal: 2 },
  galleryPhoto: {
    width: 260,
    height: 200,
    borderRadius: Radii.md,
    marginHorizontal: 2,
    backgroundColor: Colors.tan100,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.tan200,
    marginTop: Spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
  },
  actionIcon: { fontSize: 18 },
  actionLabel: { fontSize: Typography.sizes.sm, color: Colors.tan500, fontWeight: '600' },
  menuBackdrop: {
    position: 'absolute',
    top: -1000,
    bottom: -1000,
    left: -1000,
    right: -1000,
    zIndex: 50,
  },
  menu: {
    position: 'absolute',
    top: 28,
    right: 0,
    zIndex: 60,
    minWidth: 170,
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.tan200,
    paddingVertical: 4,
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 12,
  },
  menuItem: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 10,
  },
  menuText: {
    fontSize: Typography.sizes.sm,
    color: Colors.brown,
    fontWeight: '600',
  },
});
