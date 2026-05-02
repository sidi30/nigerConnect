import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Colors, Spacing, Typography } from '@/constants/theme';

/**
 * Slim banner that drops in at the top of the screen the moment the device
 * loses connectivity. Hides itself again as soon as we're back online.
 *
 * On web `NetInfo.addEventListener` falls back to `navigator.onLine` which
 * is fine for our marketing/landing builds.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }
    let cancel = false;
    void NetInfo.fetch().then((s) => {
      if (!cancel) setOnline(Boolean(s.isConnected));
    });
    const unsub = NetInfo.addEventListener((state) => {
      if (!cancel) setOnline(Boolean(state.isConnected));
    });
    return () => {
      cancel = true;
      unsub();
    };
  }, []);

  if (online) return null;

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={styles.text}>📡  Hors ligne — les actions en cours seront synchronisées au retour.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: Colors.brown,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    alignItems: 'center',
  },
  text: {
    color: Colors.white,
    fontSize: Typography.sizes.xs,
    fontWeight: '600',
    textAlign: 'center',
  },
});
