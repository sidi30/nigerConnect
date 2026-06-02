import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { tokenStore } from './secureStore';

const resolvedUrl =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL;

// In dev builds we transparently fall back to localhost so the app still boots;
// in production (any build that is not __DEV__), a missing URL is a hard failure
// — shipping without it would silently hit the wrong server.
const BASE_URL = resolvedUrl ?? (__DEV__ ? 'http://localhost:3000' : undefined);
if (!BASE_URL) {
  throw new Error(
    'EXPO_PUBLIC_API_URL / extra.apiUrl is required in production builds. Configure it in eas.json (production profile) or app.json > extra.apiUrl.',
  );
}

if (__DEV__) {
  // Surface the resolved URL once at boot — saves an hour debugging "why does
  // login fail" when the mobile app silently points at prod.
  // eslint-disable-next-line no-console
  console.log(`[api] BASE_URL = ${BASE_URL}`);
}

export const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 15000,
});

let refreshPromise: Promise<string | null> | null = null;

api.interceptors.request.use(async (config) => {
  const token = await tokenStore.getAccess();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

type OnLogoutCallback = () => void | Promise<void>;
let onLogout: OnLogoutCallback | null = null;
export function registerLogoutHandler(cb: OnLogoutCallback): void {
  onLogout = cb;
}

// Fired when the API rejects a request with 403 EMAIL_NOT_VERIFIED. The auth
// store registers a handler that flips the local user to unverified, which lets
// AuthGate corral the user onto /verify-email. We use a callback (same pattern
// as the logout handler) because the expo-router `router` isn't available from
// this non-React module.
type OnEmailUnverifiedCallback = () => void | Promise<void>;
let onEmailUnverified: OnEmailUnverifiedCallback | null = null;
export function registerEmailUnverifiedHandler(cb: OnEmailUnverifiedCallback): void {
  onEmailUnverified = cb;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    // The user's email is no longer (or never was) verified server-side. Notify
    // the auth store so the UI redirects to the verification screen.
    const data = error.response?.data as { code?: string } | undefined;
    if (error.response?.status === 403 && data?.code === 'EMAIL_NOT_VERIFIED') {
      if (onEmailUnverified) await onEmailUnverified();
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && original && !original._retry) {
      // Skip the silent refresh for routes where 401 is the *expected* failure
      // signal (login + OAuth). Without this, a wrong password would trigger
      // a refresh attempt that itself 401s, then the catch logs the user out
      // mid-typing. The login UI handles the 401 itself.
      const url = original.url ?? '';
      const isAuthEntryPoint = /\/auth\/(login|register|google|apple|forgot-password|reset-password|refresh)/.test(
        url,
      );
      if (isAuthEntryPoint) return Promise.reject(error);
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = (async () => {
            const refresh = await tokenStore.getRefresh();
            if (!refresh) return null;
            const { data } = await axios.post<{ tokens: { accessToken: string; refreshToken: string } }>(
              `${BASE_URL}/api/auth/refresh`,
              { refreshToken: refresh },
            );
            await tokenStore.save(data.tokens.accessToken, data.tokens.refreshToken);
            return data.tokens.accessToken;
          })().finally(() => {
            refreshPromise = null;
          });
        }
        const newToken = await refreshPromise;
        if (!newToken) {
          await tokenStore.clear();
          if (onLogout) await onLogout();
          return Promise.reject(error);
        }
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        return api.request(original);
      } catch (refreshError) {
        await tokenStore.clear();
        if (onLogout) await onLogout();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

export { BASE_URL };
