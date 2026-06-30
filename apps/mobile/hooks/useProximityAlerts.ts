import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { geoApi } from '@/services/geoApi';
import { useAuthStore } from '@/stores/authStore';

// Minimum gap between two backend pings, even if the location watch fires more
// often. The server also enforces its own cooldown; this just protects battery
// and our API from a chatty GPS chip.
const MIN_PING_INTERVAL_MS = 60_000;

/**
 * Foreground-only proximity alerts.
 *
 * When the signed-in user has `proximityAlerts === true`, this hook runs an
 * expo-location foreground watch and pings `POST /geo/proximity/ping` at most
 * once per ~60s. The backend decides who is nearby and pushes a notification to
 * the OTHER opted-in members; this client only reports its own position and may
 * surface returned matches as a minimal local notification.
 *
 * Lifecycle / teardown:
 *  - Subscribes when mounted AND the user has opted in AND the app is active.
 *  - Removes the location watch on unmount, when the user opts out, and when
 *    the app goes to 'background'/'inactive' (resumes on 'active').
 *
 * There is deliberately NO background location: no expo-task-manager, no
 * background permission. The watch only lives while the app is foregrounded —
 * required to stay compliant with Play Store background-location policy.
 */
export function useProximityAlerts(): void {
  const enabled = useAuthStore((s) => s.user?.proximityAlerts ?? false);

  // Live across renders without re-triggering the watch effect.
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastPingAtRef = useRef(0);
  // Track which matches we've already locally notified this session so we don't
  // re-buzz the user for the same person on every fix.
  const notifiedRef = useRef<Set<string>>(new Set());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const stopWatch = () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };

    const handleFix = async (lat: number, lon: number) => {
      const now = Date.now();
      if (now - lastPingAtRef.current < MIN_PING_INTERVAL_MS) return;
      lastPingAtRef.current = now;
      try {
        const { matches } = await geoApi.proximityPing({ lat, lon });
        if (cancelled) return;
        await maybeNotify(matches, notifiedRef.current);
      } catch {
        // Network / server hiccup — drop this ping, the next fix retries.
      }
    };

    const startWatch = async () => {
      // Already watching, or app no longer active — nothing to do.
      if (subscriptionRef.current) return;
      if (AppState.currentState !== 'active') return;

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      // Guard against a race where two startWatch calls resolve together.
      if (subscriptionRef.current || AppState.currentState !== 'active') return;

      subscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 30,
          timeInterval: MIN_PING_INTERVAL_MS,
        },
        (pos) => {
          void handleFix(pos.coords.latitude, pos.coords.longitude);
        },
      );

      if (cancelled) stopWatch();
    };

    const onAppStateChange = (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === 'active' && prev !== 'active') {
        void startWatch();
      } else if (next !== 'active') {
        // Foreground-only: drop the watch as soon as we leave the foreground.
        stopWatch();
      }
    };

    const appStateSub = AppState.addEventListener('change', onAppStateChange);
    void startWatch();

    return () => {
      cancelled = true;
      appStateSub.remove();
      stopWatch();
    };
  }, [enabled]);
}

/**
 * Optional, minimal in-app notification for returned matches. The authoritative
 * push is sent server-side to the OTHER user; this is a courtesy heads-up. We
 * skip people already notified this session to avoid duplicate buzzes.
 */
async function maybeNotify(
  matches: Array<{ encounterId: string; distance: number }>,
  notified: Set<string>,
): Promise<void> {
  if (Platform.OS === 'web' || matches.length === 0) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Double-blind: we never know who the other person is here (no name/avatar).
  // Dedup by the opaque encounterId so we buzz once per encounter.
  for (const m of matches) {
    if (notified.has(m.encounterId)) continue;
    notified.add(m.encounterId);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Une rencontre à proximité',
          body: 'Quelqu’un de la communauté est tout près.',
        },
        trigger: null,
      });
    } catch {
      // Scheduling failure is non-fatal for the ping flow.
    }
  }
}
