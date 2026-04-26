import { create } from 'zustand';
import type { User } from '@nigerconnect/shared-types';
import { authApi } from '@/services/authApi';
import { profileApi } from '@/services/profileApi';
import { tokenStore } from '@/services/secureStore';
import { registerLogoutHandler } from '@/services/api';
import { registerForPushNotifications } from '@/services/pushService';
import { setSentryUser } from '@/services/sentry';

// Best-effort background push registration — never blocks auth flow.
const kickOffPushRegistration = (): void => {
  void registerForPushNotifications().catch(() => {
    // ignore: permissions denied, simulator, or network glitch
  });
};

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
    phone?: string;
    city?: string;
    countryCode?: string;
    bio?: string;
    avatarUrl?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
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
      setSentryUser({ id: user.id, email: user.email });
      kickOffPushRegistration();
    } catch {
      await tokenStore.clear();
      set({ isHydrated: true });
    }
  },

  async login(email, password) {
    const { user, tokens } = await authApi.login({ email, password });
    await tokenStore.save(tokens.accessToken, tokens.refreshToken);
    set({ user, isAuthenticated: true });
    setSentryUser({ id: user.id, email: user.email });
    kickOffPushRegistration();
  },

  async register(input) {
    const { user, tokens } = await authApi.register(input);
    await tokenStore.save(tokens.accessToken, tokens.refreshToken);
    set({ user, isAuthenticated: true });
    setSentryUser({ id: user.id, email: user.email });
    kickOffPushRegistration();
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
    setSentryUser(null);
  },

  async deleteAccount() {
    await profileApi.deleteAccount();
    await tokenStore.clear();
    set({ user: null, isAuthenticated: false });
    setSentryUser(null);
  },

  setUser(user) {
    set({ user, isAuthenticated: !!user });
  },
}));

registerLogoutHandler(() => {
  useAuthStore.getState().setUser(null);
});
