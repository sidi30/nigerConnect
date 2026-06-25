import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as AppleAuth from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { api } from './api';
import { tokenStore } from './secureStore';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@nigerconnect/shared-types';

interface AppleAuthHookOptions {
  /** Invitation code to forward on the first Apple sign-in (account creation). */
  inviteCode?: string;
}

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
export function useAppleAuth(options: AppleAuthHookOptions = {}): AppleAuthHookResult {
  const { inviteCode } = options;
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
    // Capture `inviteCode` from closure at call time.
    const currentInviteCode = inviteCode;
    try {
      // Anti-replay nonce: we send Apple the SHA-256 of a random raw value, and
      // forward the raw value to our API. The server hashes it and asserts it
      // equals the token's `nonce` claim, so a stolen identityToken can't be
      // replayed.
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuth.signInAsync({
        requestedScopes: [
          AppleAuth.AppleAuthenticationScope.FULL_NAME,
          AppleAuth.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
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
        rawNonce,
        // Only sent on first sign-in — Apple doesn't repeat them.
        fullName:
          credential.fullName && (credential.fullName.givenName || credential.fullName.familyName)
            ? {
                givenName: credential.fullName.givenName ?? undefined,
                familyName: credential.fullName.familyName ?? undefined,
              }
            : undefined,
        email: credential.email ?? undefined,
        // Forwarded only on account creation; ignored by the server if the
        // account already exists (login branch).
        inviteCode: currentInviteCode,
      });
      // Server auth succeeded — a Keychain write failure here must not surface as
      // the generic "Connexion Apple impossible". Give a specific, actionable msg.
      try {
        await tokenStore.save(data.tokens.accessToken, data.tokens.refreshToken);
      } catch {
        setError('Connexion réussie mais impossible d’enregistrer la session sur cet appareil. Réessaie.');
        return;
      }
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
  }, [setUser, inviteCode]);

  return { signIn, isLoading, error, isAvailable };
}
