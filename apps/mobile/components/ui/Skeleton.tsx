/**
 * Skeleton — shimmer placeholders shown while content loads.
 *
 * Replaces the "blank → spinner → content pops in" jank with a content-shaped
 * grey placeholder that pulses softly, so the layout is stable from the first
 * frame and the wait reads as "loading this card" rather than "nothing here".
 *
 * Perf: a SINGLE module-level shared value drives every skeleton on screen
 * (one UI-thread timer total, not one per block) and each block animates a
 * cheap `opacity` pulse — no per-block LinearGradient compositing. A
 * FeedSkeletonList of 4 cards is then ~0 extra timers and zero gradient views.
 *
 * Respects the OS "Reduce Motion" setting (renders a static block).
 */
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Radii, Spacing } from '@/constants/theme';

// One shared value for the whole app, started once on first import. Every
// Skeleton's animated style reads it, so N skeletons cost 1 timer, not N.
const pulse = makeMutable(0);
let started = false;
function ensurePulse() {
  if (started) return;
  started = true;
  pulse.value = withRepeat(
    withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) }),
    -1,
    true, // reverse — 0→1→0, a smooth breathing pulse
  );
}

interface SkeletonProps {
  /** Width — number (px) or percentage string. Defaults to '100%'. */
  w?: DimensionValue;
  /** Height in px. Defaults to 14. */
  h?: number;
  /** Corner radius. Defaults to Radii.sm. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Single shimmering placeholder block. */
export function Skeleton({ w = '100%', h = 14, radius = Radii.sm, style }: SkeletonProps) {
  const reduceMotion = useReducedMotion();
  if (!reduceMotion) ensurePulse();

  const pulseStyle = useAnimatedStyle(() => ({
    // 0.45 → 0.85 opacity breathing. Static mid value when reduce-motion is on.
    opacity: reduceMotion ? 0.6 : 0.45 + pulse.value * 0.4,
  }));

  return (
    <Animated.View
      style={[
        { width: w, height: h, borderRadius: radius, backgroundColor: Colors.tan200 },
        pulseStyle,
        style,
      ]}
    />
  );
}

/** Loading placeholder shaped like a feed PostCard. */
export function FeedCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Skeleton w={44} h={44} radius={Radii.full} />
        <View style={styles.headerText}>
          <Skeleton w="55%" h={13} />
          <Skeleton w="35%" h={11} />
        </View>
      </View>
      <Skeleton w="92%" h={13} style={{ marginTop: Spacing.md }} />
      <Skeleton w="78%" h={13} style={{ marginTop: Spacing.sm }} />
      <Skeleton w="100%" h={170} radius={Radii.lg} style={{ marginTop: Spacing.md }} />
      <View style={[styles.row, { marginTop: Spacing.md, gap: Spacing.xl }]}>
        <Skeleton w={60} h={20} radius={Radii.full} />
        <Skeleton w={60} h={20} radius={Radii.full} />
        <Skeleton w={60} h={20} radius={Radii.full} />
      </View>
    </View>
  );
}

/** Renders N feed-card skeletons — drop straight into a loading feed. */
export function FeedSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <FeedCardSkeleton key={`fc-${i}`} />
      ))}
    </View>
  );
}

/** Loading placeholder shaped like a conversation/list row. */
export function ConversationRowSkeleton() {
  return (
    <View style={[styles.row, styles.listRow]}>
      <Skeleton w={52} h={52} radius={Radii.full} />
      <View style={styles.headerText}>
        <Skeleton w="45%" h={14} />
        <Skeleton w="70%" h={12} />
      </View>
      <Skeleton w={32} h={10} />
    </View>
  );
}

export function ConversationSkeletonList({ count = 7 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <ConversationRowSkeleton key={`cr-${i}`} />
      ))}
    </View>
  );
}

/** Loading placeholder shaped like a comment. */
export function CommentSkeleton() {
  return (
    <View style={[styles.row, { padding: Spacing.md, alignItems: 'flex-start' }]}>
      <Skeleton w={36} h={36} radius={Radii.full} />
      <View style={styles.headerText}>
        <Skeleton w="40%" h={12} />
        <Skeleton w="90%" h={12} />
        <Skeleton w="65%" h={12} />
      </View>
    </View>
  );
}

export function CommentSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <CommentSkeleton key={`cm-${i}`} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.tan100,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  listRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
});
