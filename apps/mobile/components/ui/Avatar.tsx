import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Colors, Radii } from '@/constants/theme';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
  online?: boolean;
}

export function Avatar({ uri, name, size = 48, online }: Props) {
  const initials = (name ?? '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={[styles.wrapper, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initials, { fontSize: size / 2.6 }]}>{initials || '?'}</Text>
        </View>
      )}
      {online && (
        <View
          style={[
            styles.onlineDot,
            { width: size / 4, height: size / 4, borderRadius: size / 8 },
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
