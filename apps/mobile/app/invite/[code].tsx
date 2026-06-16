/**
 * Deep-link handler for https://nigerconnect.app/invite/CODE
 *
 * When the app is installed and the user opens an invitation link, Expo Router
 * matches this screen via the Android intentFilter + iOS associatedDomains
 * already declared in app.json (no new native scheme needed).
 *
 * Behaviour:
 *  - Pre-fills the invitation code and navigates to /(auth)/register.
 *  - If the user is already authenticated it navigates to the invite tab instead.
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { Colors, Spacing, Typography } from '@/constants/theme';

export default function InviteDeepLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (!isHydrated) return;

    if (isAuthenticated) {
      // Already logged in — send them to the invite tab so they can see their
      // own invitations or share one themselves.
      router.replace('/(tabs)/invite');
      return;
    }

    // Not logged in — go to register with the code pre-filled.
    // expo-router typed routes require params in the `params` option.
    if (code) {
      router.replace({
        pathname: '/(auth)/register',
        params: { code },
      });
    } else {
      router.replace('/(auth)/register');
    }
  }, [isHydrated, isAuthenticated, code, router]);

  return (
    <View style={styles.root} accessibilityRole="none">
      <ActivityIndicator size="large" color={Colors.orange} />
      <Text style={styles.label}>Chargement de l'invitation…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  label: {
    fontSize: Typography.sizes.md,
    color: Colors.tan500,
  },
});
