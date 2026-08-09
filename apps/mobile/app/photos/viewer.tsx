import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SwipeToClose } from '@/components/ui/SwipeToClose';
import { useMediaOverlayLayout } from '@/hooks/useMediaOverlayLayout';

export default function PhotoViewer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ photos?: string; index?: string }>();
  // Mesuré au rendu (et pas au chargement du module) : rotation, écran pliable,
  // multi-fenêtre Android — sinon la pagination se décale. `contentH` est la
  // place qui reste sous l'entête : la photo n'y passe jamais dessous.
  const { screenW, topInset, headerH, contentH: pageH } = useMediaOverlayLayout();

  const photos = (() => {
    if (!params.photos) return [] as string[];
    try {
      const parsed = JSON.parse(params.photos);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  })();
  const initialIndex = Math.max(0, Math.min(Number(params.index ?? 0) || 0, photos.length - 1));
  const [current, setCurrent] = useState(initialIndex);
  const listRef = useRef<FlatList<string>>(null);

  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / screenW);
    if (idx !== current) setCurrent(idx);
  }

  const closeBtn = (
    <Pressable onPress={() => router.back()} hitSlop={12} style={styles.closeBtn}>
      <Text style={styles.closeIcon}>✕</Text>
    </Pressable>
  );

  if (photos.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Aucune photo à afficher</Text>
          {closeBtn}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SwipeToClose onClose={() => router.back()} style={{ marginTop: headerH }}>
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(uri, i) => `${i}-${uri}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: screenW, offset: screenW * i, index: i })}
          onMomentumScrollEnd={onMomentumScrollEnd}
          renderItem={({ item }) => (
            <View style={[styles.page, { width: screenW, height: pageH }]}>
              <Image
                source={{ uri: item }}
                style={{ width: screenW, height: pageH }}
                contentFit="contain"
              />
            </View>
          )}
        />
      </SwipeToClose>

      <View style={[styles.topOverlay, { paddingTop: topInset, height: headerH }]}>
        <View style={styles.topRow}>
          {closeBtn}
          {photos.length > 1 && (
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                {current + 1} / {photos.length}
              </Text>
            </View>
          )}
          <View style={{ width: 40 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  page: { alignItems: 'center', justifyContent: 'center' },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, justifyContent: 'center' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: { color: '#fff', fontSize: 20, fontWeight: '700' },
  counter: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  counterText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#fff', fontSize: 16, marginBottom: 24 },
});
