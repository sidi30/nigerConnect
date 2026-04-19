import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { tokenStore } from './secureStore';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://localhost:3000';

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

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retry) {
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
