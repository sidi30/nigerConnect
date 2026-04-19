import { create } from 'zustand';
import type { User } from '@nigerconnect/shared-types';
import { authApi } from '@/services/authApi';
import { tokenStore } from '@/services/secureStore';
import { registerLogoutHandler } from '@/services/api';

interface AuthState {
  user: User | null;
  isHydrated: boolean;
  isAuthenticated: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isHydrated: false,
  isAuthenticated: false,

  async hydrate() {
    const access = await tokenStore.getAccess();
    if (!access) {
      set({ isHydrated: true });
      return;
    }
    try {
      const { user } = await authApi.me();
      set({ user, isAuthenticated: true, isHydrated: true });
    } catch {
      await tokenStore.clear();
      set({ isHydrated: true });
    }
  },

  async login(email, password) {
    const { user, tokens } = await authApi.login({ email, password });
    await tokenStore.save(tokens.accessToken, tokens.refreshToken);
    set({ user, isAuthenticated: true });
  },

  async register(input) {
    const { user, tokens } = await authApi.register(input);
    await tokenStore.save(tokens.accessToken, tokens.refreshToken);
    set({ user, isAuthenticated: true });
  },

  async logout() {
    const refresh = await tokenStore.getRefresh();
    if (refresh) {
      try {
        await authApi.logout(refresh);
      } catch {
        // silent
      }
    }
    await tokenStore.clear();
    set({ user: null, isAuthenticated: false });
  },

  setUser(user) {
    set({ user, isAuthenticated: !!user });
  },
}));

registerLogoutHandler(() => {
  useAuthStore.getState().setUser(null);
});
