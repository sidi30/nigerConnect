import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

interface Props {
  size?: number;
}

export function VerifiedBadge({ size = 14 }: Props) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Feather name="check" size={size * 0.7} color={Colors.white} />
    </View>
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
