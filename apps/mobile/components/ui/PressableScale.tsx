/**
 * PressableScale — a Pressable that springs down slightly on press, giving
 * every tap a tactile, responsive feel instead of a flat opacity flash.
 *
 * Drop-in replacement for Pressable on buttons, cards, FABs, list rows. The
 * scale runs on the UI thread (Reanimated) so it stays smooth even while the
 * press handler does heavy JS work.
 */
import { forwardRef } from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends PressableProps {
  /** How far to shrink on press. Default 0.96 (subtle). */
  activeScale?: number;
  /** Dim while pressed in addition to scaling. Default true. */
  dim?: boolean;
}

export const PressableScale = forwardRef<View, Props>(function PressableScale(
  { activeScale = 0.96, dim = true, style, children, onPressIn, onPressOut, disabled, ...rest },
  ref,
) {
  const pressed = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - activeScale) }],
    opacity: dim ? 1 - pressed.value * 0.15 : 1,
  }));

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) });
        onPressOut?.(e);
      }}
      style={(state) => [animStyle, typeof style === 'function' ? style(state) : style]}
      {...rest}
    >
      {children as React.ReactNode}
    </AnimatedPressable>
  );
});
