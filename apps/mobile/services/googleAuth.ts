import { useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import Constants from 'expo-constants';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from './authApi';
import { tokenStore } from './secureStore';
import { registerForPushNotifications } from './pushService';

// Needed on web + Android to close the auth popup cleanly.
WebBrowser.maybeCompleteAuthSession();

type ExtraConfig = {
  googleClientIdWeb?: string;
  googleClientIdAndroid?: string;
  googleClientIdIos?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

const CLIENT_IDS = {
  webClientId:
    extra.googleClientIdWeb ?? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? undefined,
  androidClientId:
    extra.googleClientIdAndroid ?? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? undefined,
  iosClientId:
    extra.googleClientIdIos ?? process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? undefined,
} as const;

export interface GoogleAuthState {
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  isConfigured: boolean;
}

/**
 * React hook encapsulating the full Google sign-in dance.
 * 1. Opens the Google OAuth screen (native or web fallback)
 * 2. Receives the ID token
 * 3. Sends it to our backend /auth/google
 * 4. Stores tokens + hydrates the auth store
 */
export function useGoogleAuth(): GoogleAuthState {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: CLIENT_IDS.webClientId,
    androidClientId: CLIENT_IDS.androidClientId,
    iosClientId: CLIENT_IDS.iosClientId,
  });

  const setUser = useAuthStore((s) => s.setUser);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken =
        response.authentication?.idToken ?? (response.params as Record<string, string>)?.id_token;
      if (!idToken) {
        setError('Réponse Google invalide — id_token manquant');
        setLoading(false);
        return;
      }
      (async () => {
        try {
          const { user, tokens } = await authApi.loginWithGoogle(idToken);
          await tokenStore.save(tokens.accessToken, tokens.refreshToken);
          setUser(user);
          // Fire-and-forget push registration
          void registerForPushNotifications().catch(() => {});
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Connexion Google échouée';
          setError(msg);
        } finally {
          setLoading(false);
        }
      })();
    } else if (response?.type === 'error') {
      setError(response.error?.message ?? 'Connexion Google échouée');
      setLoading(false);
    } else if (response?.type === 'cancel' || response?.type === 'dismiss') {
      setLoading(false);
    }
  }, [response, setUser]);

  const isConfigured = Boolean(
    CLIENT_IDS.webClientId ?? CLIENT_IDS.androidClientId ?? CLIENT_IDS.iosClientId,
  );

  const signIn = async (): Promise<void> => {
    if (!isConfigured) {
      setError('Google sign-in non configuré');
      return;
    }
    if (!request) return;
    setError(null);
    setLoading(true);
    await promptAsync();
  };

  return { isLoading, error, signIn, isConfigured };
}
