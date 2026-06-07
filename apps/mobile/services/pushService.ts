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
      importance: Notifications.AndroidImportance.DEFAULT,
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

export async function unregisterCurrentDevice(token: string | null): Promise<void> {
  if (!token) return;
  try {
    // Best-effort — backend endpoint is fire-and-forget
    await notificationApi.registerDevice(token, Platform.OS as 'ios' | 'android' | 'web');
  } catch {
    // noop
  }
}
