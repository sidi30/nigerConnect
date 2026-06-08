/**
 * Toast — bottom-anchored transient feedback pill driven by `toastStore`.
 *
 * Mounted once at the app root. Slides up + fades in with a spring, holds for
 * `duration`, then slides out. Tap to dismiss early. Colour + icon per variant.
 *
 * Reanimated drives the entrance/exit on the UI thread so it stays smooth even
 * while the JS thread is busy finishing the action that triggered the toast.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Radii, Shadows, Spacing, Typography } from '@/constants/theme';
import { useToastStore } from '@/stores/toastStore';

const VARIANT = {
  success: { bg: Colors.successText, icon: '✓' },
  error: { bg: Colors.danger, icon: '✕' },
  info: { bg: Colors.brownSoft, icon: 'ℹ' },
} as const;

export function Toast() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { current, dismiss } = useToastStore();

  // 0 = hidden (below screen, transparent), 1 = shown.
  const shown = useSharedValue(0);

  useEffect(() => {
    if (!current) {
      shown.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.ease) });
      return;
    }
    // Reset to 0 first so a *replacement* toast (current already truthy) still
    // plays the entrance — otherwise the text would swap silently.
    shown.value = reduceMotion ? 1 : 0;
    shown.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    const t = setTimeout(() => {
      // Animate out, then clear the store once the exit finishes.
      shown.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) }, (done) => {
        if (done) runOnJS(dismiss)();
      });
    }, current.duration);
    return () => clearTimeout(t);
  }, [current, dismiss, shown, reduceMotion]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 24 }, { scale: 0.96 + shown.value * 0.04 }],
  }));

  if (!current) return null;
  const v = VARIANT[current.variant];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + 28 }, animStyle]}
    >
      <Pressable onPress={dismiss} style={[styles.pill, { backgroundColor: v.bg }]}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>{v.icon}</Text>
        </View>
        <Text style={styles.message} numberOfLines={2}>
          {current.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    alignItems: 'center',
    zIndex: 10000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: '100%',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md + 2,
    borderRadius: Radii.full,
    ...Shadows.md,
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: Radii.full,
    backgroundColor: Colors.whiteAlpha25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: Colors.white,
    fontSize: Typography.sizes.sm,
    fontWeight: '800',
  },
  message: {
    flexShrink: 1,
    color: Colors.white,
    fontSize: Typography.sizes.md,
    fontWeight: '600',
  },
});
