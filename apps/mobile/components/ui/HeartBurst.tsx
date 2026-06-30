/**
 * HeartBurst — a one-shot "like" burst: a heart pops with a spring and a ring of
 * particles flies outward, then everything fades. Reusable across feed posts,
 * comments and the double-tap photo gesture.
 *
 * Perf: pure reanimated worklets on the UI thread (one shared `progress` per
 * burst), interpolated into transform/opacity only — no per-frame React state.
 * Respects the OS "Reduce Motion" setting (renders nothing / no motion).
 *
 * Usage: keep a counter in the parent and bump it to fire:
 *   const [burst, setBurst] = useState(0);
 *   <HeartBurst trigger={burst} size={28} />     // overlay, absolutely centered
 *   onLike={() => setBurst((n) => n + 1)}
 */
import { memo, useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';

interface Props {
  /** Bump this number to play the burst once. 0 = idle (no play on mount). */
  trigger: number;
  /** Heart size in px (particles scale with it). Default 28. */
  size?: number;
  color?: string;
  /** Show the outward particle ring. Default true. */
  particles?: boolean;
  style?: StyleProp<ViewStyle>;
}

const PARTICLE_COUNT = 6;
// Fixed angles (deg) so the ring looks intentional, not random.
const ANGLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => (360 / PARTICLE_COUNT) * i);

function HeartBurstImpl({ trigger, size = 28, color = Colors.danger, particles = true, style }: Props) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (trigger <= 0) return;
    if (reduceMotion) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [trigger, reduceMotion, progress]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.12, 0.7, 1], [0, 1, 1, 0]),
    transform: [
      { scale: interpolate(progress.value, [0, 0.25, 0.5, 1], [0.2, 1.25, 1, 1.05]) },
    ],
  }));

  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      {particles
        ? ANGLES.map((deg) => <Particle key={deg} deg={deg} size={size} color={color} progress={progress} />)
        : null}
      <Animated.View style={heartStyle}>
        <Feather name="heart" size={size} color={color} style={styles.heart} />
      </Animated.View>
    </View>
  );
}

function Particle({
  deg,
  size,
  color,
  progress,
}: {
  deg: number;
  size: number;
  color: string;
  progress: { value: number };
}) {
  const rad = (deg * Math.PI) / 180;
  const distance = size * 1.1;
  const dot = size * 0.16;

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const travel = interpolate(p, [0, 0.6, 1], [0, distance, distance]);
    return {
      opacity: interpolate(p, [0, 0.15, 0.65, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: Math.cos(rad) * travel },
        { translateY: Math.sin(rad) * travel },
        { scale: interpolate(p, [0, 0.5, 1], [0.4, 1, 0.6]) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  heart: {
    // a soft glow so the burst reads as celebratory
    textShadowColor: 'rgba(224,82,6,0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});

export const HeartBurst = memo(HeartBurstImpl);
