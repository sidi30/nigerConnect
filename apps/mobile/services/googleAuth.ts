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

/**
 * Empty strings in app.json (e.g. `"googleClientIdAndroid": ""`) coerce to a
 * falsy-but-not-nullish value, which `??` would happily forward to the OAuth
 * library — the request then fires with an empty `client_id` and Google
 * responds with `invalid_request`. Treat empty strings the same as undefined.
 */
function asClientId(...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    const trimmed = c?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

const CLIENT_IDS = {
  webClientId: asClientId(extra.googleClientIdWeb, process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB),
  androidClientId: asClientId(
    extra.googleClientIdAndroid,
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID,
  ),
  iosClientId: asClientId(extra.googleClientIdIos, process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS),
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
 *
 * Setup notes (for the project owner):
 *  - The API verifies the ID token's `aud` against GOOGLE_CLIENT_ID_{WEB,ANDROID,IOS}.
 *    Whatever client ID the mobile app uses, the server must have the SAME value
 *    in its env, otherwise sign-in returns "Invalid Google ID token".
 *  - Android native flow needs an Android-type OAuth client (package
 *    `com.nigerconnect.app` + signing SHA-1) → set `extra.googleClientIdAndroid`.
 *    Without it, the proxy fallback uses the WEB client; that requires
 *    `https://auth.expo.io/@<owner>/<slug>` to be registered as redirect URI.
 *  - iOS native flow needs an iOS-type client (bundle id `com.nigerconnect.app`)
 *    → set `extra.googleClientIdIos`.
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
          const apiErr = e as {
            response?: { data?: { message?: string | string[] } };
            message?: string;
          };
          const apiMsg = apiErr.response?.data?.message;
          const msg = Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg;
          setError(msg ?? apiErr.message ?? 'Connexion Google échouée');
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
    if (!request) {
      // useIdTokenAuthRequest returns null until the discovery doc loads.
      setError('Connexion Google en cours d’initialisation, réessaie dans un instant.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await promptAsync();
    } catch (e) {
      setError((e as Error).message ?? 'Connexion Google échouée');
      setLoading(false);
    }
  };

  return { isLoading, error, signIn, isConfigured };
}
