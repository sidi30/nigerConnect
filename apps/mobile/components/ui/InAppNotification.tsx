/**
 * InAppNotification — foreground banner shown when a new message/notification
 * arrives while the app is open but the user is NOT on that conversation screen.
 *
 * Visual design: slides in from the top, auto-hides after 4 s, dismissable by
 * tap (which also navigates to the relevant screen).
 *
 * Mount this once inside TabsLayout so it sits above the tab bar hierarchy but
 * is still within the authenticated subtree (so the router is ready).
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radii, Shadows, Spacing, Typography } from '@/constants/theme';
import {
  useInAppNotificationStore,
} from '@/stores/inAppNotificationStore';

// How long the banner stays visible before auto-hiding (ms).
const AUTO_HIDE_MS = 4000;
// Slide-in / slide-out animation duration (ms).
const ANIM_MS = 280;

export function InAppNotification() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { current, dismiss } = useInAppNotificationStore();

  // translateY starts off-screen (negative = above the top edge) and
  // animates to 0 (visible). We track the item id to restart the animation
  // whenever a new notification replaces the current one.
  const translateY = useRef(new Animated.Value(-120)).current;
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!current) {
      // Animate out if still visible.
      Animated.timing(translateY, {
        toValue: -120,
        duration: ANIM_MS,
        useNativeDriver: true,
      }).start();
      currentIdRef.current = null;
      return;
    }

    // Cancel any pending auto-hide for the previous banner.
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);

    // Animate in (even if one was already visible — snaps to new content).
    currentIdRef.current = current.id;
    Animated.timing(translateY, {
      toValue: 0,
      duration: ANIM_MS,
      useNativeDriver: true,
    }).start();

    // Schedule auto-hide.
    autoHideTimer.current = setTimeout(() => {
      dismiss();
    }, AUTO_HIDE_MS);

    return () => {
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    };
  }, [current, dismiss, translateY]);

  function handlePress() {
    dismiss();
    if (current?.route) {
      router.push(current.route as never);
    }
  }

  // Always render the Animated.View so it's available for the slide-out
  // animation even after `current` becomes null; opacity-driven visibility
  // would be simpler but then the old content flickers back mid-animation.
  return (
    <Animated.View
      style={[
        styles.container,
        {
          // Push the banner below the status bar / Dynamic Island.
          top: insets.top + 8,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents={current ? 'box-none' : 'none'}
    >
      {current && (
        <Pressable onPress={handlePress} style={styles.card}>
          <View style={styles.textColumn}>
            <Text style={styles.title} numberOfLines={1}>
              {current.title}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {current.body}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 9999,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.sm + 4,
    gap: Spacing.sm,
    // Subtle shadow so it floats above the screen content.
    ...Shadows.md,
    borderWidth: 1,
    borderColor: Colors.tan200,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: Typography.sizes.sm,
    fontWeight: '700',
    color: Colors.brown,
  },
  body: {
    fontSize: Typography.sizes.sm,
    color: Colors.tan500,
    lineHeight: 18,
  },
  chevron: {
    fontSize: 22,
    color: Colors.tan400,
    lineHeight: 24,
  },
});
