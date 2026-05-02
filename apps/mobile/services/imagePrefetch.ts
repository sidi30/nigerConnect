import { Image } from 'expo-image';

/**
 * Warm the on-disk image cache with a small set of URLs without blocking
 * the UI. Used after login to fetch the user's friend avatars in the
 * background — the messages list and feed then render instantly without
 * a flash of fallback initials.
 *
 * Cap on the number of URLs is intentional: prefetching 1 000 photos on a
 * cold cellular connection burns the user's data plan for no benefit
 * (most won't be visible in the next 60 seconds).
 */
const MAX_PREFETCH = 24;

export async function prefetchImages(urls: Array<string | null | undefined>): Promise<void> {
  const valid = urls.filter((u): u is string => typeof u === 'string' && u.length > 0);
  const slice = valid.slice(0, MAX_PREFETCH);
  if (slice.length === 0) return;
  // Don't await — let it run in the background. Errors are swallowed: a 404
  // on a stale avatar URL must never break login.
  await Promise.allSettled(slice.map((u) => Image.prefetch(u, 'memory-disk')));
}
