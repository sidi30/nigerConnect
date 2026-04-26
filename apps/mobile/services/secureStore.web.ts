const ACCESS = 'nc.accessToken';
const REFRESH = 'nc.refreshToken';

const safeStorage = () => (typeof window !== 'undefined' ? window.localStorage : null);

export const tokenStore = {
  async save(accessToken: string, refreshToken: string): Promise<void> {
    const s = safeStorage();
    if (!s) return;
    s.setItem(ACCESS, accessToken);
    s.setItem(REFRESH, refreshToken);
  },
  async getAccess(): Promise<string | null> {
    return safeStorage()?.getItem(ACCESS) ?? null;
  },
  async getRefresh(): Promise<string | null> {
    return safeStorage()?.getItem(REFRESH) ?? null;
  },
  async clear(): Promise<void> {
    const s = safeStorage();
    if (!s) return;
    s.removeItem(ACCESS);
    s.removeItem(REFRESH);
  },
};
