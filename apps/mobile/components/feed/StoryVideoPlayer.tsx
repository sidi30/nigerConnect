import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Colors, Spacing, Typography } from '@/constants/theme';

interface Props {
  uri: string;
  posterUri?: string | null;
  /** Whether this clip is the one currently on screen in the viewer. */
  isActive: boolean;
  /** Viewer-level pause (delete confirm, backgrounded, etc.). */
  paused: boolean;
  /** Fired once playback reaches the end — the viewer advances. */
  onComplete: () => void;
  /** 0..1 playback progress, drives the story progress bar. */
  onProgress: (fraction: number) => void;
  /** Lets the viewer hide its prev/next tap zones while we await the first tap. */
  onNeedsTapChange?: (needsTap: boolean) => void;
}

/**
 * Story video surface. Beta rule: NO autoplay on cellular — on a metered
 * connection we show the poster + a play badge and wait for a tap (saves the
 * user's data); on Wi-Fi we autoplay when the clip is active. Always MUTED
 * (the clip is uploaded audio-stripped, and we mute the player as defense).
 */
export function StoryVideoPlayer({
  uri,
  posterUri,
  isActive,
  paused,
  onComplete,
  onProgress,
  onNeedsTapChange,
}: Props) {
  const [needsTap, setNeedsTap] = useState(true);
  const [metered, setMetered] = useState(true);
  const onCompleteRef = useRef(onComplete);
  const onProgressRef = useRef(onProgress);
  onCompleteRef.current = onComplete;
  onProgressRef.current = onProgress;

  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
  });

  // Decide the autoplay policy once from the connection type. `cellular`,
  // `none` and `unknown` are treated as metered → require an explicit tap.
  useEffect(() => {
    let cancelled = false;
    void NetInfo.fetch().then((s) => {
      if (cancelled) return;
      const isMetered = s.type === 'cellular' || s.type === 'unknown' || s.type === 'none';
      setMetered(isMetered);
      setNeedsTap(isMetered);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onNeedsTapChange?.(needsTap);
  }, [needsTap, onNeedsTapChange]);

  // Play / pause according to active + paused + tap-gate.
  useEffect(() => {
    if (!isActive) {
      player.pause();
      player.currentTime = 0;
      return;
    }
    if (paused || needsTap) {
      player.pause();
      return;
    }
    player.play();
  }, [isActive, paused, needsTap, player]);

  useEffect(() => {
    const endSub = player.addListener('playToEnd', () => onCompleteRef.current());
    const timeSub = player.addListener('timeUpdate', (e) => {
      const d = player.duration || 0;
      if (d > 0) onProgressRef.current(Math.min(1, e.currentTime / d));
    });
    return () => {
      endSub.remove();
      timeSub.remove();
    };
  }, [player]);

  function handleTapToPlay() {
    setNeedsTap(false);
    player.play();
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      {needsTap ? (
        <Pressable style={styles.poster} onPress={handleTapToPlay} accessibilityLabel="Lire la vidéo">
          {posterUri ? (
            <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          ) : null}
          <View style={styles.playBadge}>
            <Feather name="play" size={30} color={Colors.white} />
          </View>
          {metered ? (
            <Text style={styles.hint}>Touche pour lire (données mobiles)</Text>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  poster: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  playBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
  },
  hint: {
    position: 'absolute',
    bottom: 90,
    color: 'rgba(255,255,255,0.85)',
    fontSize: Typography.sizes.sm,
    fontWeight: '600',
  },
});
