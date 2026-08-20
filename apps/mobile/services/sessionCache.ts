import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@nigerconnect/shared-types';

const KEY = 'nc.lastUser';

/**
 * Dernier profil connu, gardé sur l'appareil.
 *
 * Sert à UNE chose : ouvrir l'application quand le réseau ne répond pas au
 * démarrage. Sans lui, `hydrate()` n'a aucun moyen d'afficher autre chose que
 * l'écran de connexion, et l'utilisatrice a l'impression que l'application
 * « se réinitialise » — c'est très exactement le symptôme remonté le
 * 20/08/2026 depuis un Motorola sur réseau mobile.
 *
 * Ce n'est PAS une session : les jetons restent dans SecureStore, et le profil
 * en cache ne donne aucun droit. Le premier appel réseau réel revalide ou
 * déconnecte. On stocke donc dans AsyncStorage, comme le cache React Query qui
 * contient déjà ces mêmes champs.
 */
export const sessionCache = {
  async save(user: User): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(user));
    } catch {
      // Disque plein, quota : le cache est un confort, jamais une condition.
    }
  },

  async load(): Promise<User | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as User;
      // Un objet tronqué (écriture coupée par une extinction) ne doit pas
      // faire planter le démarrage : on le traite comme absent.
      return parsed && typeof parsed.id === 'string' ? parsed : null;
    } catch {
      return null;
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
