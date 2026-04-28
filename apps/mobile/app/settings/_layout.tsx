import { Stack, useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { Colors, Spacing, Typography } from '@/constants/theme';

/**
 * The settings flow lives in its own nested stack so the page chrome (title,
 * background) stays consistent. React Navigation hides the default back button
 * on the first screen of any stack — but in our case every settings screen IS
 * the entry point (we push to `/settings/<name>` from elsewhere), so we must
 * force a back arrow ourselves on every screen via a shared headerLeft.
 */
export default function SettingsLayout() {
  const router = useRouter();
  const headerLeft = () => (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      style={{ paddingHorizontal: Spacing.sm }}
    >
      <Text style={{ fontSize: 22, color: Colors.brown, fontWeight: '600' }}>‹</Text>
    </Pressable>
  );

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.cream },
        headerTitleStyle: {
          fontWeight: '700',
          color: Colors.brown,
          fontSize: Typography.sizes.md,
        },
        headerTintColor: Colors.brown,
        headerLeft,
        headerBackVisible: false,
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
      <Stack.Screen name="photos" options={{ title: 'Mes photos' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Supprimer le compte', headerShown: false }} />
    </Stack>
  );
}
