import type { User, AuthTokens } from '@nigerconnect/shared-types';
import { api } from './api';

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export const authApi = {
  async register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    city?: string;
    countryCode?: string;
    bio?: string;
    avatarUrl?: string;
    // Precise coordinates from the /geo/cities autocomplete. Sent so the server
    // pins the user exactly instead of geocoding from the city name.
    latitude?: number;
    longitude?: number;
  }): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/register', input);
    return data;
  },

  async login(input: { email: string; password: string; deviceName?: string }): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/login', input);
    return data;
  },

  async loginWithGoogle(
    idToken: string,
    deviceName?: string,
    nonce?: string,
  ): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/google', { idToken, deviceName, nonce });
    return data;
  },

  async logout(refreshToken: string): Promise<void> {
    await api.post('/auth/logout', { refreshToken });
  },

  async me(): Promise<{ user: User }> {
    const { data } = await api.get<{ user: User }>('/auth/me');
    return data;
  },

  async forgotPassword(email: string): Promise<void> {
    await api.post('/auth/forgot-password', { email });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await api.post('/auth/reset-password', { token, password });
  },

  async resendVerification(): Promise<void> {
    await api.post('/auth/verify-email/send');
  },

  async verifyEmailCode(code: string): Promise<void> {
    await api.post('/auth/verify-email/code', { code });
  },
};
