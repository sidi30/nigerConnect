import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Colors } from '@/constants/theme';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
  online?: boolean;
  border?: boolean;
  borderColor?: string;
}

export function Avatar({
  uri,
  name,
  size = 48,
  online,
  border = true,
  borderColor = Colors.orange,
}: Props) {
  const initials = (name ?? '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const radius = Math.round(size * 0.35);

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: border ? 2.5 : 0,
            borderColor,
            backgroundColor: Colors.tan100,
          }}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            {
              width: size,
              height: size,
              borderRadius: radius,
              borderWidth: border ? 2.5 : 0,
              borderColor,
            },
          ]}
        >
          <Text style={[styles.initials, { fontSize: size / 2.8 }]}>{initials || '?'}</Text>
        </View>
      )}
      {online && (
        <View
          style={[
            styles.onlineDot,
            {
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: (size * 0.28) / 2,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  placeholder: {
    backgroundColor: Colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: Colors.white, fontWeight: '700' },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: Colors.green,
    borderWidth: 2,
    borderColor: Colors.white,
  },
});
