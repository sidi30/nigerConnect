import { Image, type ImageProps } from 'expo-image';

/**
 * Project-wide `<NCImage>` wrapper around `expo-image` with the cache and
 * transition defaults we want everywhere. Using a wrapper instead of
 * scattering the same options across 20 call sites keeps the policy
 * consistent and tweakable from one place.
 *
 * Defaults:
 *   - `cachePolicy="memory-disk"` — keeps the bitmap in RAM for the next
 *     mount AND on disk between cold starts. Default in expo-image is
 *     "disk" only, which forces a re-decode on every scroll.
 *   - `transition={150}` — smooth fade-in instead of a hard pop when an
 *     image lands from the network.
 *   - `recyclingKey` exposed at the top level so callers in virtualised
 *     lists (FlatList, FlashList) can pass `item.id` and avoid bitmap
 *     reuse bugs (one user's avatar briefly flashing on another row).
 *   - `placeholder` honored: pass `{ blurhash: post.media[0].blurhash }`
 *     and expo-image renders the LQIP while fetching. Great for the feed.
 */
export function NCImage(props: ImageProps & { recyclingKey?: string }) {
  return (
    <Image
      cachePolicy="memory-disk"
      transition={150}
      contentFit="cover"
      {...props}
    />
  );
}

export type { ImageProps } from 'expo-image';
