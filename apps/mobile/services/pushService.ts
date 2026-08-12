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
 * Dernier token enregistré pour la session en cours. Le récupérer au moment de
 * la déconnexion coûterait une permission et un aller-retour Expo, alors qu'on
 * l'a déjà en main à l'ouverture de session.
 */
let lastRegisteredToken: string | null = null;

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
    lastRegisteredToken = token;
    return token;
  } catch {
    return null;
  }
}

/**
 * À la déconnexion : détacher le token du compte. Appelait `registerDevice`,
 * c'est-à-dire l'exact inverse — et personne ne l'appelait, si bien que le
 * téléphone restait rattaché au compte quitté et continuait de recevoir ses
 * messages privés (le push porte l'aperçu du message). À appeler AVANT
 * d'invalider la session : la route exige un access token encore valide.
 */
export async function unregisterCurrentDevice(token?: string | null): Promise<void> {
  const target = token ?? lastRegisteredToken;
  lastRegisteredToken = null;
  if (!target) return;
  try {
    await notificationApi.deleteDevice(target);
  } catch {
    // Best-effort : une déconnexion ne doit jamais échouer pour ça.
  }
}
