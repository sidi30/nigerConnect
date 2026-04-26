import { Stack } from 'expo-router';
import { Colors } from '@/constants/theme';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.cream },
        headerTitleStyle: { fontWeight: '700', color: Colors.brown },
        headerTintColor: Colors.brown,
        contentStyle: { backgroundColor: Colors.cream },
      }}
    >
      <Stack.Screen name="edit-profile" options={{ title: 'Modifier profil' }} />
      <Stack.Screen name="identity" options={{ title: 'Vérification identité' }} />
      <Stack.Screen name="associations" options={{ title: 'Mes associations' }} />
      <Stack.Screen name="requests" options={{ title: 'Mes demandes' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="privacy" options={{ title: 'Confidentialité' }} />
      <Stack.Screen name="language" options={{ title: 'Langue' }} />
    </Stack>
  );
}
