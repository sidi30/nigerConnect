import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Typography } from '@/constants/theme';

interface Props {
  value: number;
  size?: number;
  onChange?: (v: number) => void;
  count?: number;
}

/**
 * Star rating display + optional interactive picker.
 *
 * - When `onChange` is provided, each star is pressable (rating picker).
 * - When `count` is provided and `onChange` is NOT, shows the numeric average
 *   and total count beside the stars.
 */
export function StarRating({ value, size = 16, onChange, count }: Props) {
  const stars = [1, 2, 3, 4, 5];
  const showMeta = typeof count === 'number' && !onChange;

  return (
    <View style={styles.row}>
      {stars.map((star) => {
        const filled = star <= Math.round(value);
        const color = filled ? Colors.orange : Colors.tan300;
        const icon = <Feather name="star" size={size} color={color} />;
        if (onChange) {
          return (
            <Pressable
              key={star}
              onPress={() => onChange(star)}
              hitSlop={4}
              accessibilityLabel={`${star} étoile${star > 1 ? 's' : ''}`}
              accessibilityRole="button"
            >
              {icon}
            </Pressable>
          );
        }
        return <View key={star}>{icon}</View>;
      })}
      {showMeta ? (
        <Text style={[styles.meta, { fontSize: size * 0.75 }]}>
          {value > 0 ? value.toFixed(1) : '—'} ({count})
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  meta: {
    color: Colors.tan500,
    fontWeight: '600',
    marginLeft: 4,
  },
});
