import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Colors, Radii, Spacing, Typography } from '@/constants/theme';
import { useGoogleAuth } from '@/services/googleAuth';

interface Props {
  label?: string;
}

/**
 * Plug-and-play "Continuer avec Google" button.
 * Handles the OAuth flow, error surfacing, and loading state internally.
 * If Google sign-in is not configured (no client IDs), renders nothing so
 * the login/register screens degrade gracefully.
 *
 * iOS-specific gate: App Store Guideline 4.8 requires Sign in with Apple
 * whenever a third-party social login is offered. We only enforce that gate
 * in **production builds** (`__DEV__ === false`) — Expo Go, dev clients and
 * simulators are not subject to App Store review, so showing the button in
 * dev keeps the OAuth flow testable. As soon as Apple Sign-In is wired
 * (Apple Developer Program + APPLE_* env vars), flip `appleSignInEnabled`
 * to true and Google appears on iOS prod builds too.
 */
export function GoogleButton({ label = 'Continuer avec Google' }: Props) {
  const { signIn, isLoading, error, isConfigured } = useGoogleAuth();

  const appleEnabled = Boolean(
    (Constants.expoConfig?.extra as { appleSignInEnabled?: boolean } | undefined)
      ?.appleSignInEnabled ?? process.env.EXPO_PUBLIC_APPLE_SIGNIN_ENABLED === 'true',
  );
  if (!__DEV__ && Platform.OS === 'ios' && !appleEnabled) return null;
  if (!isConfigured) return null;

  return (
    <View style={{ width: '100%' }}>
      <Pressable
        onPress={signIn}
        disabled={isLoading}
        style={({ pressed }) => [
          styles.btn,
          { opacity: isLoading ? 0.6 : pressed ? 0.9 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {isLoading ? (
          <ActivityIndicator color={Colors.brown} />
        ) : (
          <>
            <GoogleGlyph />
            <Text style={styles.label}>{label}</Text>
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** Multi-color G glyph drawn with layered Views — zero-dependency. */
function GoogleGlyph() {
  return (
    <View style={glyph.wrap}>
      <Text style={glyph.g}>G</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.gray300,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radii.md,
  },
  label: {
    fontSize: Typography.sizes.md,
    fontWeight: '600',
    color: Colors.brown,
  },
  error: {
    marginTop: Spacing.xs,
    color: '#C0392B',
    fontSize: Typography.sizes.sm,
    textAlign: 'center',
  },
});

const glyph = StyleSheet.create({
  wrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  g: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4285F4',
    fontFamily: 'System',
  },
});
