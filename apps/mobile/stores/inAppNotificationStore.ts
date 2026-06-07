/**
 * In-app notification store — tiny Zustand slice that holds a single queued
 * banner item and exposes actions to show / dismiss it.
 *
 * Architecture note: we keep this separate from the tab-layout component so any
 * piece of the app (socket handler, push listener) can trigger a banner without
 * prop-drilling or context gymnastics.
 *
 * Only one banner is queued at a time — if a new message arrives before the
 * current one is dismissed, the newer one replaces the older one.  A small
 * auto-hide timeout (set inside InAppNotification.tsx) handles the common case;
 * the dismiss action is provided for tap/swipe interactions.
 */

import { create } from 'zustand';

export interface InAppNotificationItem {
  /** Unique key used as React key + to detect replacements. */
  id: string;
  /** Bold headline — usually the sender's display name or notification title. */
  title: string;
  /** Body text — message preview or notification body. */
  body: string;
  /** Optional deep-link route that expo-router should push() to when tapped. */
  route?: string;
  /** If this banner belongs to a conversation, store the id so we can suppress
   *  it when the user is already viewing that conversation. */
  conversationId?: string;
}

interface InAppNotificationState {
  current: InAppNotificationItem | null;
  /** Show a new banner, replacing any currently visible one. */
  show: (item: InAppNotificationItem) => void;
  /** Dismiss the current banner (called by the banner itself after auto-hide). */
  dismiss: () => void;
}

export const useInAppNotificationStore = create<InAppNotificationState>((set) => ({
  current: null,

  show(item) {
    set({ current: item });
  },

  dismiss() {
    set({ current: null });
  },
}));
