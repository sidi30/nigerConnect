import { create } from 'zustand';
import type { User } from '@nigerconnect/shared-types';
import { authApi } from '@/services/authApi';
import { friendsApi } from '@/services/friendsApi';
import { profileApi } from '@/services/profileApi';
import { tokenStore } from '@/services/secureStore';
import { registerEmailUnverifiedHandler, registerLogoutHandler } from '@/services/api';
import { registerForPushNotifications } from '@/services/pushService';
import { prefetchImages } from '@/services/imagePrefetch';

// Best-effort background push registration — never blocks auth flow.
const kickOffPushRegistration = (): void => {
  void registerForPushNotifications().catch(() => {
    // ignore: permissions denied, simulator, or network glitch
  });
};

/**
 * Warm the image cache with the freshly-authenticated user's avatar plus
 * their friends'. Fire-and-forget: any failure (offline, expired URL) is
 * swallowed by `prefetchImages` itself.
 */
function kickOffImagePrefetch(user: User | null): void {
  if (!user) return;
  void (async () => {
    try {
      const friends = await friendsApi.list();
      const urls = [user.avatarUrl, ...friends.items.map((f) => f.avatarUrl)];
      await prefetchImages(urls);
    } catch {
      /* ignore */
    }
  })();
}

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
    /** WGS-84 latitude from the city autocomplete; forwarded to POST /auth/register
     *  so the server stores precise map coordinates without a second geocode. */
    latitude?: number;
    /** WGS-84 longitude from the city autocomplete. */
    longitude?: number;
    /** Invitation code (required in invite_only mode, ignored otherwise). */
    inviteCode?: string;
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
      kickOffPushRegistration();
      kickOffImagePrefetch(user);
    } catch {
      await tokenStore.clear();
      set({ isHydrated: true });
    }
  },

  async login(email, password) {
    const { user, tokens } = await authApi.login({ email, password });
    await tokenStore.save(tokens.accessToken, tokens.refreshToken);
    set({ user, isAuthenticated: true });
    kickOffPushRegistration();
    kickOffImagePrefetch(user);
  },

  async register(input) {
    const { user, tokens } = await authApi.register(input);
    await tokenStore.save(tokens.accessToken, tokens.refreshToken);
    set({ user, isAuthenticated: true });
    kickOffPushRegistration();
    kickOffImagePrefetch(user);
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

  async deleteAccount() {
    await profileApi.deleteAccount();
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

// When the API reports the email as unverified, flip the cached user so
// AuthGate redirects to /verify-email on the next render.
registerEmailUnverifiedHandler(() => {
  const current = useAuthStore.getState().user;
  if (current && current.emailVerified) {
    useAuthStore.getState().setUser({ ...current, emailVerified: false });
  }
});
