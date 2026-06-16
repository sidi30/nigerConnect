import { useEffect, useRef, useState } from 'react';
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

export interface GoogleAuthOptions {
  /** Invitation code to forward on the first Google sign-in (account creation). */
  inviteCode?: string;
}

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
export function useGoogleAuth(options: GoogleAuthOptions = {}): GoogleAuthState {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: CLIENT_IDS.webClientId,
    androidClientId: CLIENT_IDS.androidClientId,
    iosClientId: CLIENT_IDS.iosClientId,
  });

  const setUser = useAuthStore((s) => s.setUser);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep a ref so the response effect always reads the latest inviteCode without
  // being added to the effect's dependency array (which would re-run the effect
  // on every keystroke in the invite-code field).
  const inviteCodeRef = useRef(options.inviteCode);
  inviteCodeRef.current = options.inviteCode;

  // Surface the resolved redirect URI in dev so the project owner knows
  // exactly which URL to whitelist in Google Cloud Console. Without this,
  // diagnosing "redirect_uri_mismatch" on Android is a 30-min google-fu
  // session every single time.
  useEffect(() => {
    if (__DEV__ && request?.redirectUri) {
      // eslint-disable-next-line no-console
      console.log(
        `[google-auth] redirectUri = ${request.redirectUri}\n` +
          `If sign-in fails with "redirect_uri_mismatch", add this URL to the\n` +
          `Authorized redirect URIs of your Web OAuth client in Google Cloud Console.`,
      );
    }
  }, [request?.redirectUri]);

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
          // Anti-replay: forward the request nonce (echoed into the ID token's
          // `nonce` claim) so the server can reject a replayed token. Optional —
          // older server builds ignore it.
          // inviteCode is forwarded only on account creation; the server ignores
          // it on login of an existing account.
          const { user, tokens } = await authApi.loginWithGoogle(
            idToken,
            undefined,
            request?.nonce,
            inviteCodeRef.current,
          );
          // Server auth succeeded — don't let a Keychain write failure surface as
          // a generic "Connexion Google échouée". Give a specific message.
          try {
            await tokenStore.save(tokens.accessToken, tokens.refreshToken);
          } catch {
            setError(
              'Connexion réussie mais impossible d’enregistrer la session sur cet appareil. Réessaie.',
            );
            return;
          }
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
      const errMsg = response.error?.message ?? response.error?.code ?? '';
      // Map Google's most common errors to actionable messages so the user
      // (and the dev) know what to fix without digging through web docs.
      let friendly = 'Connexion Google échouée.';
      if (/redirect_uri_mismatch/i.test(errMsg)) {
        const redirectUri = request?.redirectUri ?? '<unknown>';
        friendly = __DEV__
          ? `Redirect URI non autorisé. Ajoute cette URL aux Authorized redirect URIs du Web client Google Cloud Console:\n${redirectUri}`
          : 'Connexion Google indisponible — contacte le support.';
      } else if (/invalid_client/i.test(errMsg)) {
        friendly = __DEV__
          ? 'client_id Google invalide. Vérifie googleClientIdWeb/Android/Ios dans app.json.'
          : 'Connexion Google indisponible — contacte le support.';
      } else if (/access_denied/i.test(errMsg)) {
        friendly = 'Tu as refusé l’accès Google.';
      } else if (errMsg) {
        friendly = errMsg;
      }
      setError(friendly);
      setLoading(false);
    } else if (response?.type === 'cancel' || response?.type === 'dismiss') {
      setLoading(false);
    }
  }, [response, request?.redirectUri, setUser]);

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
