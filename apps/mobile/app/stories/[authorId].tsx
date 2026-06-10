import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/Avatar';
import { feedApi } from '@/services/feedApi';
import { useAuthStore } from '@/stores/authStore';
import { Colors, palette, Spacing, Typography } from '@/constants/theme';
import { colorForId, relativeTime } from '@/constants/lookups';

const { width: SW, height: SH } = Dimensions.get('window');
const STORY_DURATION = 5000; // 5s per story

export default function StoryViewerScreen() {
  const { authorId } = useLocalSearchParams<{ authorId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery({
    queryKey: ['stories'],
    queryFn: () => feedApi.stories(),
  });

  const group = data?.find((g) => g.author.id === authorId);
  const stories = group?.stories ?? [];
  const isOwn = me?.id === authorId;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const deleteMut = useMutation({
    mutationFn: (storyId: string) => feedApi.deleteStory(storyId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stories'] });
      setConfirmDelete(false);
      // If it was the last one left, exit; otherwise move to next/prev.
      if (stories.length <= 1) {
        router.back();
        return;
      }
      if (index >= stories.length - 1) {
        setIndex(Math.max(0, index - 1));
      } else {
        progress.setValue(0);
      }
    },
  });

  useEffect(() => {
    if (stories.length === 0) return;
    if (paused || confirmDelete) return;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (!finished) return;
      if (index < stories.length - 1) {
        setIndex(index + 1);
      } else {
        router.back();
      }
    });
    return () => anim.stop();
  }, [index, stories.length, progress, router, paused, confirmDelete]);

  function prev() {
    progress.setValue(0);
    setIndex((i) => Math.max(0, i - 1));
  }
  function next() {
    if (index < stories.length - 1) {
      progress.setValue(0);
      setIndex((i) => i + 1);
    } else {
      router.back();
    }
  }

  if (isLoading || !group) {
    return <SafeAreaView style={styles.blackContainer} />;
  }

  const current = stories[index];
  if (!current) {
    return <SafeAreaView style={styles.blackContainer} />;
  }
  const media = current.media[0];

  return (
    <View style={styles.container}>
      {media ? (
        <Image source={{ uri: media.mediaUrl }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, { backgroundColor: Colors.brown }]} />
      )}

      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        {/* Progress bars */}
        <View style={styles.progressRow}>
          {stories.map((_, i) => (
            <View key={i} style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  i < index && { width: '100%' },
                  i === index && {
                    width: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
          ))}
        </View>

        <View style={styles.authorRow}>
          <Pressable
            onPress={() => {
              if (isOwn) return;
              setPaused(true);
              router.push(`/user/${group.author.id}`);
            }}
            style={styles.authorBlock}
            hitSlop={4}
          >
            <Avatar
              uri={group.author.avatarUrl}
              name={group.author.displayName ?? 'N'}
              size={36}
              borderColor={colorForId(group.author.id)}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.authorName}>
                {group.author.displayName ??
                  `${group.author.firstName ?? ''} ${group.author.lastName ?? ''}`.trim()}
              </Text>
              <Text style={styles.time}>{relativeTime(current.createdAt)}</Text>
            </View>
          </Pressable>
          {isOwn ? (
            <Pressable
              onPress={() => {
                setPaused(true);
                setConfirmDelete(true);
              }}
              hitSlop={15}
              style={styles.trashBtn}
              accessibilityLabel="Supprimer cette story"
            >
              <Feather name="trash-2" size={16} color={Colors.white} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.back()} hitSlop={15} style={styles.close}>
            <Feather name="x" size={22} color={Colors.white} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Tap zones — left = prev, right = next. Disabled while the confirm modal is open. */}
      {!confirmDelete ? (
        <>
          <Pressable style={styles.tapLeft} onPress={prev} />
          <Pressable style={styles.tapRight} onPress={next} />
        </>
      ) : null}

      {confirmDelete ? (
        <View style={styles.confirmOverlay} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setConfirmDelete(false);
              setPaused(false);
            }}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Supprimer cette story ?</Text>
            <Text style={styles.confirmText}>Elle sera retirée immédiatement pour tes amis.</Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => {
                  setConfirmDelete(false);
                  setPaused(false);
                }}
                style={[styles.confirmBtn, styles.confirmBtnGhost]}
              >
                <Text style={styles.confirmBtnGhostLabel}>Annuler</Text>
              </Pressable>
              <Pressable
                onPress={() => deleteMut.mutate(current.id)}
                disabled={deleteMut.isPending}
                style={[
                  styles.confirmBtn,
                  styles.confirmBtnDanger,
                  deleteMut.isPending && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.confirmBtnDangerLabel}>
                  {deleteMut.isPending ? 'Suppression…' : 'Supprimer'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  blackContainer: { flex: 1, backgroundColor: '#000' },
  image: { width: SW, height: SH, position: 'absolute' },
  overlay: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  progressRow: { flexDirection: 'row', gap: 4, height: 3 },
  progressTrack: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.white },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    marginTop: Spacing.md,
  },
  authorBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2 },
  authorName: { fontSize: Typography.sizes.sm + 1, fontWeight: '700', color: Colors.white },
  time: { fontSize: Typography.sizes.xs, color: 'rgba(255,255,255,0.7)' },
  close: { padding: Spacing.xs },
  tapLeft: {
    position: 'absolute',
    top: 80,
    bottom: 0,
    left: 0,
    width: SW / 3,
  },
  tapRight: {
    position: 'absolute',
    top: 80,
    bottom: 0,
    right: 0,
    width: (SW * 2) / 3,
  },
  trashBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.whiteAlpha10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  confirmCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 340,
    gap: Spacing.sm,
  },
  confirmTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: '800',
    color: Colors.brown,
  },
  confirmText: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    lineHeight: 19,
    marginBottom: Spacing.sm,
  },
  confirmActions: { flexDirection: 'row', gap: Spacing.sm },
  confirmBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnGhost: {
    borderWidth: 1.5,
    borderColor: Colors.tan300,
    backgroundColor: Colors.white,
  },
  confirmBtnGhostLabel: {
    color: Colors.tan600,
    fontSize: Typography.sizes.md,
    fontWeight: '700',
  },
  confirmBtnDanger: { backgroundColor: Colors.danger },
  confirmBtnDangerLabel: {
    color: Colors.white,
    fontSize: Typography.sizes.md,
    fontWeight: '700',
  },
});
