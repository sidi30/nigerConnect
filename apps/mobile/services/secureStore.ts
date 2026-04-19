import * as SecureStore from 'expo-secure-store';

const ACCESS = 'nc.accessToken';
const REFRESH = 'nc.refreshToken';

export const tokenStore = {
  async save(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS, accessToken),
      SecureStore.setItemAsync(REFRESH, refreshToken),
    ]);
  },
  async getAccess(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS);
  },
  async getRefresh(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH);
  },
  async clear(): Promise<void> {
    await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
  },
};
