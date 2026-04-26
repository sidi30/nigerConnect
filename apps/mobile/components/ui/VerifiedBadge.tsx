import { StyleSheet, Text, View } from 'react-native';
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
      <Text style={{ fontSize: size * 0.6, color: Colors.white, fontWeight: '900', lineHeight: size }}>
        ✓
      </Text>
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
