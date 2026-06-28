import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

interface Props {
  size?: number;
}

// Gold star badge for community ambassadors. Deliberately distinct in shape
// (star) AND colour (gold) from the green check VerifiedBadge, so the two can
// sit side-by-side and stay legible — a user may carry both.
const GOLD = '#E8A300';

export function AmbassadorBadge({ size = 14 }: Props) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Feather name="star" size={size * 0.66} color={Colors.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 3,
  },
});
