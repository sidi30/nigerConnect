import { Platform, StyleSheet, Text, View } from 'react-native';
import * as AppleAuth from 'expo-apple-authentication';
import { useAppleAuth } from '@/services/appleAuth';
import { Radii, Typography } from '@/constants/theme';

interface Props {
  /** Override the label (defaults to "Continuer avec Apple" / "S'inscrire avec Apple"). */
  label?: string;
  /** Used to swap the button label for the sign-up screen. */
  mode?: 'signIn' | 'signUp';
}

/**
 * Apple's Human Interface Guidelines *require* using their native button —
 * custom drawings of the Apple mark can get the app rejected. We use
 * `AppleAuthenticationButton` on iOS and render nothing on Android/web.
 */
export function AppleButton({ mode = 'signIn', label }: Props) {
  const { signIn, isLoading, error, isAvailable } = useAppleAuth();

  if (Platform.OS !== 'ios' || !isAvailable) return null;

  const buttonType =
    mode === 'signUp'
      ? AppleAuth.AppleAuthenticationButtonType.SIGN_UP
      : AppleAuth.AppleAuthenticationButtonType.CONTINUE;

  return (
    <View style={{ width: '100%' }}>
      <AppleAuth.AppleAuthenticationButton
        buttonType={buttonType}
        buttonStyle={AppleAuth.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={Radii.md}
        style={[styles.btn, isLoading && { opacity: 0.6 }]}
        onPress={signIn}
      />
      {label ? <Text style={styles.hiddenLabel}>{label}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: '100%',
    height: 48,
  },
  hiddenLabel: { display: 'none' },
  error: {
    marginTop: 4,
    color: '#C0392B',
    fontSize: Typography.sizes.sm,
    textAlign: 'center',
  },
});
