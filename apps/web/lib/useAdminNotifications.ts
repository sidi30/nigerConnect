"use client";

// Live notification counts for the admin shell (badges on Identité, Support &
// Modération…). Design choice: short-interval polling with visibility-aware
// revalidation rather than SSE/WebSocket.
//
// Rationale: admin auth is a Bearer token in localStorage (no cookie), so an
// EventSource — which can't set headers — would force the token into the URL
// (logged by Traefik) or a cookie migration. A WebSocket is overkill for a few
// integer counts. Polling every POLL_MS, paused while the tab is hidden and
// refetched immediately on focus, gives near-real-time updates with zero infra
// and works behind Traefik. Reuses GET /admin/metrics (admin + moderator).
//
// Failures are swallowed: a transient metrics error must not blank the badges
// or kill the session. A real 401/403 already redirects to login inside
// adminFetch.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMetrics } from "./adminApi";

export interface AdminNotificationCounts {
  identityPending: number;
  reportsPending: number;
}

const EMPTY: AdminNotificationCounts = {
  identityPending: 0,
  reportsPending: 0,
};

const POLL_MS = 30_000;

export function useAdminNotifications(
  enabled: boolean,
): AdminNotificationCounts {
  const [counts, setCounts] = useState<AdminNotificationCounts>(EMPTY);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Cancel any still-pending request so a slow response can't clobber a fresh
    // one (focus + interval can fire close together).
    inFlight.current?.abort();
    const ac = new AbortController();
    inFlight.current = ac;
    try {
      const m = await fetchMetrics(ac.signal);
      setCounts({
        identityPending: m.identity.pending,
        reportsPending: m.moderation.reportsPending,
      });
    } catch {
      // Swallow (incl. AbortError + transient network). 401/403 is handled by
      // adminFetch (clears session + redirects).
    }
  }, []);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    void refresh(); // initial fetch

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    // Catch up the instant the operator returns to the tab/window.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      inFlight.current?.abort();
    };
  }, [enabled, refresh]);

  return counts;
}
