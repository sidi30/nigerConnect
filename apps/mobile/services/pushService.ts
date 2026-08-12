import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { notificationApi } from './notificationApi';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    // In the foreground we render our OWN in-app banner (see the
    // addNotificationReceivedListener in app/(tabs)/_layout.tsx). Letting the OS
    // ALSO show its system banner/alert here double-stacks the same notification.
    // So suppress the OS visual surfaces (alert + banner) while keeping sound,
    // badge, and the notification-centre list entry.
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: false,
      shouldShowList: true,
    }),
  });
}

/**
 * Request permission + register the device's Expo push token with the API.
 * Safe to call multiple times — the backend upserts on (userId, token).
 * Silently returns null on simulators / web / denied permission.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const { status: asked } = await Notifications.requestPermissionsAsync();
    status = asked;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      // HIGH, pas DEFAULT : en DEFAULT Android range la notification dans le
      // tiroir sans bandeau. Application fermée, le membre ne voyait donc rien
      // avant de dérouler la barre d'état — ce qui se vit comme « je ne reçois
      // pas les notifications ». HIGH affiche le bandeau par-dessus l'écran.
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E67E22',
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  try {
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))
      .data;
    const platform: 'ios' | 'android' | 'web' =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    await notificationApi.registerDevice(token, platform);
    return token;
  } catch {
    return null;
  }
}

/**
 * À la déconnexion : détacher le token du compte. Appelait `registerDevice`,
 * c'est-à-dire l'exact inverse — le token restait attaché et l'appareil
 * continuait de recevoir les notifications d'un compte déconnecté.
 */
export async function unregisterCurrentDevice(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await notificationApi.deleteDevice(token);
  } catch {
    // Best-effort : une déconnexion ne doit jamais échouer pour ça.
  }
}
