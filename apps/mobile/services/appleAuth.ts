import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as AppleAuth from 'expo-apple-authentication';
import { api } from './api';
import { tokenStore } from './secureStore';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@nigerconnect/shared-types';

interface AppleAuthHookResult {
  signIn: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
  isAvailable: boolean;
}

/**
 * Sign in with Apple. Required by App Store Guideline 4.8 when another social
 * login (Google, Facebook) is offered. Only renders on iOS — Apple does not
 * allow Sign-in-with-Apple on Android officially, and the web flow uses a
 * different OAuth route we don't need for the mobile-first MVP.
 */
export function useAppleAuth(): AppleAuthHookResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      setIsAvailable(false);
      return;
    }
    let active = true;
    AppleAuth.isAvailableAsync()
      .then((v) => {
        if (active) setIsAvailable(v);
      })
      .catch(() => {
        if (active) setIsAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const credential = await AppleAuth.signInAsync({
        requestedScopes: [
          AppleAuth.AppleAuthenticationScope.FULL_NAME,
          AppleAuth.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error('Apple ID token manquant');
      }
      const { data } = await api.post<{
        user: User;
        tokens: { accessToken: string; refreshToken: string };
      }>('/auth/apple', {
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode ?? undefined,
        // Only sent on first sign-in — Apple doesn't repeat them.
        fullName:
          credential.fullName && (credential.fullName.givenName || credential.fullName.familyName)
            ? {
                givenName: credential.fullName.givenName ?? undefined,
                familyName: credential.fullName.familyName ?? undefined,
              }
            : undefined,
        email: credential.email ?? undefined,
      });
      await tokenStore.save(data.tokens.accessToken, data.tokens.refreshToken);
      setUser(data.user);
    } catch (e) {
      const err = e as {
        code?: string;
        message?: string;
        response?: { data?: { message?: string } };
      };
      if (err.code === 'ERR_REQUEST_CANCELED') {
        // User dismissed the Apple sheet — silent.
        return;
      }
      setError(err.response?.data?.message ?? err.message ?? 'Connexion Apple impossible');
    } finally {
      setIsLoading(false);
    }
  }, [setUser]);

  return { signIn, isLoading, error, isAvailable };
}
