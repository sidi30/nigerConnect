import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends PressableProps {
  label: string;
  variant?: Variant;
  loading?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading,
  disabled,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const bg =
    variant === 'primary'
      ? Colors.orange
      : variant === 'secondary'
        ? Colors.brown
        : 'transparent';
  const color =
    variant === 'outline' || variant === 'ghost' ? Colors.brown : Colors.white;
  const borderColor = variant === 'outline' ? Colors.gray300 : 'transparent';
  const isDisabled = disabled || loading;

  // Spring-scale on press for a tactile feel (runs on the UI thread).
  const pressed = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.04 }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={isDisabled}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) });
        onPressOut?.(e);
      }}
      style={[
        styles.base,
        { backgroundColor: bg, borderColor, opacity: isDisabled ? 0.5 : 1 },
        animStyle,
        typeof style === 'function' ? undefined : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.label, { color }]}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: Typography.sizes.md,
    fontWeight: '600',
  },
});
