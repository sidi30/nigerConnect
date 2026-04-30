import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
  useFonts as useDMSans,
} from '@expo-google-fonts/dm-sans';
import {
  PlayfairDisplay_700Bold,
  PlayfairDisplay_800ExtraBold,
  PlayfairDisplay_900Black,
  useFonts as usePlayfair,
} from '@expo-google-fonts/playfair-display';
import { useAuthStore } from '@/stores/authStore';
import { ThemeProvider } from '@/constants/theme-provider';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function RootLayout() {
  const [dmLoaded] = useDMSans({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  const [playfairLoaded] = usePlayfair({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_800ExtraBold,
    PlayfairDisplay_900Black,
  });
  const fontsLoaded = dmLoaded && playfairLoaded;
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              {/* Translucent on Android so content sits BEHIND the status bar,
                  letting react-native-safe-area-context calculate insets.top
                  correctly. Without this, headers can stick to the very top
                  of the screen and overlap the system clock/battery row. */}
              <StatusBar style="dark" translucent backgroundColor="transparent" />
              <AuthGate />
              <NotificationDeepLink />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FDFBF7' } }}>
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="chat/[id]" options={{ presentation: 'card' }} />
                <Stack.Screen name="chat/new" options={{ presentation: 'modal' }} />
                <Stack.Screen name="user/[id]" />
                <Stack.Screen name="post/[id]" />
                <Stack.Screen name="post/new" options={{ presentation: 'modal' }} />
                <Stack.Screen name="post/edit/[id]" options={{ presentation: 'modal' }} />
                <Stack.Screen name="services/[id]" />
                <Stack.Screen name="services/new" options={{ presentation: 'modal' }} />
                <Stack.Screen name="stories/[authorId]" options={{ presentation: 'fullScreenModal' }} />
                <Stack.Screen name="stories/new" options={{ presentation: 'fullScreenModal' }} />
                <Stack.Screen
                  name="photos/viewer"
                  options={{ presentation: 'fullScreenModal', animation: 'fade' }}
                />
                <Stack.Screen name="associations/new" options={{ presentation: 'modal' }} />
                <Stack.Screen name="friends" />
                <Stack.Screen name="settings" options={{ presentation: 'card' }} />
                <Stack.Screen name="verify-email" options={{ presentation: 'card' }} />
                <Stack.Screen name="legal" options={{ presentation: 'card' }} />
                <Stack.Screen name="legal/terms" options={{ presentation: 'card' }} />
                <Stack.Screen name="legal/privacy" options={{ presentation: 'card' }} />
                <Stack.Screen name="legal/community" options={{ presentation: 'card' }} />
              </Stack>
            </QueryClientProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

/**
 * Routes the user to the right screen when they tap on a push notification.
 * The notification's `data` payload — set on the backend in NotificationService
 * — carries one of: conversationId, postId, friendshipId. We map each to the
 * matching screen, falling back to the in-app notification list.
 *
 * Also handles the cold-start case (`getLastNotificationResponseAsync`) so a
 * tap that launched the app from terminated state still deep-links once the
 * router is ready.
 */
function NotificationDeepLink() {
  const router = useRouter();
  const navState = useRootNavigationState();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!navState?.key || !isAuthenticated) return;

    function handle(data: Record<string, unknown> | null | undefined): void {
      if (!data) return;
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;
      const postId = typeof data.postId === 'string' ? data.postId : null;
      if (conversationId) router.push(`/chat/${conversationId}` as never);
      else if (postId) router.push(`/post/${postId}` as never);
      else if (data.type === 'friend_request' || data.type === 'friend_accepted') {
        router.push('/friends' as never);
      } else {
        router.push('/settings/notifications' as never);
      }
    }

    // Cold start: the user tapped a notif while the app was killed.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response.notification.request.content.data as Record<string, unknown>);
    });

    // Warm start: every subsequent tap.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handle(response.notification.request.content.data as Record<string, unknown>);
    });
    return () => sub.remove();
  }, [navState?.key, isAuthenticated, router]);

  return null;
}

function AuthGate() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();

  useEffect(() => {
    if (!navState?.key || !isHydrated) return;
    const first = segments[0];
    const inAuth = first === '(auth)';
    if (!isAuthenticated && !inAuth) {
      router.replace('/(auth)/welcome');
    } else if (isAuthenticated && inAuth) {
      router.replace('/(tabs)');
    }
  }, [navState?.key, isHydrated, isAuthenticated, segments, router]);

  return null;
}
