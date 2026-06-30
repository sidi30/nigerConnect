import { StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';

interface Props {
  size?: number;
}

export function VerifiedBadge({ size = 14 }: Props) {
  const reduce = useReducedMotion();
  return (
    <Animated.View
      entering={reduce ? undefined : ZoomIn.springify().damping(8).stiffness(180)}
      style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Feather name="check" size={size * 0.7} color={Colors.white} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: Colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 3,
  },
});
