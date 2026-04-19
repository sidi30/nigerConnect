import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';

interface Props extends PressableProps {
  label: string;
  variant?: Variant;
  loading?: boolean;
}

export function Button({ label, variant = 'primary', loading, disabled, ...rest }: Props) {
  const bg =
    variant === 'primary'
      ? Colors.orange
      : variant === 'secondary'
        ? Colors.brown
        : 'transparent';
  const color =
    variant === 'outline' || variant === 'ghost' ? Colors.brown : Colors.white;
  const borderColor = variant === 'outline' ? Colors.gray300 : 'transparent';

  return (
    <Pressable
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, borderColor, opacity: (disabled || loading) ? 0.5 : pressed ? 0.85 : 1 },
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.label, { color }]}>{label}</Text>
      )}
    </Pressable>
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
