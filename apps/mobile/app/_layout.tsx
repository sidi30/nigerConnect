import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
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
import { OfflineBanner } from '@/components/OfflineBanner';
import { Toast } from '@/components/ui/Toast';
import { captureRenderError, initSentry } from '@/services/sentry';

// Boot Sentry as early as possible — before any React render — so the very
// first error during font loading or auth hydration still gets captured.
initSentry();

// Wire React Query to NetInfo so queries auto-pause when the device drops
// offline and resume on reconnection — no per-call retry logic needed.
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(Boolean(state.isConnected));
  });
});

// Background → foreground triggers a refetch of stale queries. Without this
// the app shows the bitmap-frozen state when the user comes back from another
// app — feels like the app didn't update.
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
}
AppState.addEventListener('change', onAppStateChange);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 s stale: avoid flicker on tab switches but still refresh hourly content.
      staleTime: 30_000,
      // Keep cached data 24h so a cold start renders instantly while we
      // background-refetch.
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      // Skip refetch when the device is offline — `onlineManager` flips this
      // back automatically once connectivity returns.
      networkMode: 'online',
    },
    mutations: {
      networkMode: 'online',
    },
  },
});

// Persist the cache to AsyncStorage. Cold-start cost: a few MB read once;
// gain: feed/profile/messages render instantly from cache while the network
// fetches the latest. Cache survives app kill, but expires after 24 h to
// avoid serving stale-by-a-week data.
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'nigerconnect:rq',
  // Throttle writes so we don't churn AsyncStorage on every cache update.
  throttleTime: 1000,
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
    <ErrorBoundary onError={captureRenderError}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <PersistQueryClientProvider
              client={queryClient}
              persistOptions={{
                persister,
                maxAge: 24 * 60 * 60 * 1000,
                // Bust the persisted cache when the app version changes — a
                // schema change in shared-types would otherwise leave the user
                // with a hydrated cache that no longer matches the new types.
                buster: 'v1',
              }}
            >
              {/* Translucent on Android so content sits BEHIND the status bar,
                  letting react-native-safe-area-context calculate insets.top
                  correctly. Without this, headers can stick to the very top
                  of the screen and overlap the system clock/battery row. */}
              <StatusBar style="dark" translucent backgroundColor="transparent" />
              <OfflineBanner />
              <Toast />
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
                <Stack.Screen name="associations/[id]" />
                <Stack.Screen name="associations/new" options={{ presentation: 'modal' }} />
                <Stack.Screen name="pages/index" />
                <Stack.Screen name="pages/[id]" />
                <Stack.Screen name="pages/new" options={{ presentation: 'modal' }} />
                <Stack.Screen name="friends" />
                <Stack.Screen name="settings" options={{ presentation: 'card' }} />
                <Stack.Screen name="verify-email" options={{ presentation: 'card' }} />
                <Stack.Screen name="reset-password" options={{ presentation: 'card' }} />
                <Stack.Screen name="complete-profile" options={{ presentation: 'card', gestureEnabled: false }} />
                <Stack.Screen name="legal" options={{ presentation: 'card' }} />
                <Stack.Screen name="legal/terms" options={{ presentation: 'card' }} />
                <Stack.Screen name="legal/privacy" options={{ presentation: 'card' }} />
                <Stack.Screen name="legal/community" options={{ presentation: 'card' }} />
              </Stack>
            </PersistQueryClientProvider>
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
      const pageId = typeof data.pageId === 'string' ? data.pageId : null;
      const postId = typeof data.postId === 'string' ? data.postId : null;
      const associationId = typeof data.associationId === 'string' ? data.associationId : null;
      const requestId = typeof data.requestId === 'string' ? data.requestId : null;
      const proximityUserId =
        data.type === 'proximity' && typeof data.userId === 'string' ? data.userId : null;
      // review_received carries { reviewTargetType: 'user'|'page', targetId }.
      const reviewTargetType =
        data.reviewTargetType === 'user' || data.reviewTargetType === 'page'
          ? data.reviewTargetType
          : null;
      const reviewTargetId = typeof data.targetId === 'string' ? data.targetId : null;
      if (conversationId) router.push(`/chat/${conversationId}` as never);
      else if (reviewTargetType && reviewTargetId) {
        router.push(
          (reviewTargetType === 'page'
            ? `/pages/${reviewTargetId}`
            : `/user/${reviewTargetId}`) as never,
        );
      } else if (pageId) router.push(`/pages/${pageId}` as never);
      else if (postId) router.push(`/post/${postId}` as never);
      else if (associationId) router.push(`/associations/${associationId}` as never);
      else if (requestId) router.push(`/services/${requestId}` as never);
      else if (proximityUserId) router.push(`/user/${proximityUserId}` as never);
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
  const user = useAuthStore((s) => s.user);
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();

  useEffect(() => {
    if (!navState?.key || !isHydrated) return;
    const first = segments[0];
    const inAuth = first === '(auth)';
    const onVerifyEmail = first === 'verify-email';
    // Reset-password is reachable while logged-out (opened from the email
    // link / universal link) — don't bounce it to the welcome screen.
    const onResetPassword = first === 'reset-password';
    const onCompleteProfile = first === 'complete-profile';
    // OAuth (Google/Apple) signups are email-verified but arrive with no
    // city/country (the provider doesn't give it) → no map presence. Password
    // signups always set countryCode at registration, so a missing countryCode
    // on a verified account means "OAuth, profile not completed yet".
    const needsProfile = Boolean(isAuthenticated && user?.emailVerified && !user?.countryCode);
    if (!isAuthenticated && !inAuth && !onResetPassword) {
      router.replace('/(auth)/welcome');
    } else if (isAuthenticated && user && !user.emailVerified && !onVerifyEmail) {
      // Authenticated but email not confirmed → corral them onto the
      // verify-email screen until they confirm (mirrors the API guard).
      router.replace('/verify-email');
    } else if (needsProfile && !onCompleteProfile) {
      // Verified but no location yet (OAuth) → collect city before entering.
      router.replace('/complete-profile');
    } else if (isAuthenticated && user?.emailVerified && !needsProfile && inAuth) {
      router.replace('/(tabs)');
    }
  }, [navState?.key, isHydrated, isAuthenticated, user, segments, router]);

  return null;
}
