import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { pickAndUploadImage, type UploadSource } from '@/services/uploadService';
import { describeStoryVideoError } from '@/services/storyVideoService';
import { useStoryVideoUpload } from '@/hooks/useStoryVideoUpload';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';

type Mode = 'none' | 'image' | 'video';

/** Sentinel so the create mutation can bail silently when the video upload
 *  already surfaced its own inline error (avoids a double alert). */
const SILENT = 'story-video-silent';

export default function NewStoryScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const [caption, setCaption] = useState('');
  const [mode, setMode] = useState<Mode>('none');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null); // image path
  const [uploading, setUploading] = useState(false); // image pick+upload
  const video = useStoryVideoUpload();

  const mut = useMutation({
    mutationFn: async () => {
      let media:
        | { mediaUrl: string; mediaType: 'image' }
        | {
            mediaUrl: string;
            mediaType: 'video';
            thumbnailUrl?: string;
            width?: number;
            height?: number;
          };
      if (mode === 'video') {
        const uploaded = await video.upload();
        if (!uploaded) throw new Error(SILENT);
        media = {
          mediaUrl: uploaded.mediaUrl,
          mediaType: 'video',
          thumbnailUrl: uploaded.thumbnailUrl,
          width: uploaded.width,
          height: uploaded.height,
        };
      } else {
        if (!mediaUrl) throw new Error('Choisis une image');
        media = { mediaUrl, mediaType: 'image' };
      }
      const { data } = await api.post('/stories', {
        content: caption.trim() || undefined,
        media,
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    },
    onError: (e) => {
      if ((e as Error).message === SILENT) return; // inline video error already shown
      Alert.alert('Erreur', describeStoryVideoError(e));
    },
  });

  async function pickPhoto(source: UploadSource) {
    setMode('image');
    setUploading(true);
    try {
      const url = await pickAndUploadImage('photo', source);
      if (url) setMediaUrl(url);
      else if (!mediaUrl) setMode('none');
    } catch (error) {
      setMode('none');
      Alert.alert('Upload impossible', (error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function pickVideo(source: UploadSource) {
    setMode('video');
    void video.compress(source);
  }

  function resetMedia() {
    setMode('none');
    setMediaUrl(null);
    video.reset();
  }

  function openPicker() {
    Alert.alert('Ajouter à ta story', undefined, [
      { text: 'Prendre une photo', onPress: () => pickPhoto('camera') },
      { text: 'Photo depuis la galerie', onPress: () => pickPhoto('library') },
      { text: 'Enregistrer une vidéo', onPress: () => pickVideo('camera') },
      { text: 'Vidéo depuis la galerie', onPress: () => pickVideo('library') },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  const vState = video.state;
  const busy = mut.isPending || vState.phase === 'uploading';
  const canPublish =
    (mode === 'image' && !!mediaUrl) || (mode === 'video' && vState.phase === 'ready');
  const hasMedia = mode !== 'none';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.cancelBtn}>
          <Feather name="chevron-left" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={styles.cancel}>Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle story</Text>
        <Pressable
          onPress={() => mut.mutate()}
          disabled={!canPublish || busy}
          style={[styles.publish, (!canPublish || busy) && { opacity: 0.4 }]}
        >
          <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
          <Text style={styles.publishLabel}>{busy ? '…' : 'Publier'}</Text>
        </Pressable>
      </View>

      <View style={styles.canvas}>
        {mode === 'image' && mediaUrl ? (
          <>
            <Image source={{ uri: mediaUrl }} style={styles.image} contentFit="cover" />
            <CaptionInput value={caption} onChangeText={setCaption} />
            <Pressable onPress={resetMedia} style={styles.removeBtn}>
              <Feather name="x" size={18} color={Colors.white} />
            </Pressable>
          </>
        ) : mode === 'video' ? (
          <VideoStage
            state={vState}
            caption={caption}
            onCaption={setCaption}
            onCancel={video.cancel}
            onRetry={() => void video.retry('library')}
            onRemove={resetMedia}
          />
        ) : (
          <Pressable onPress={openPicker} disabled={uploading} style={styles.placeholder}>
            <Feather name="camera" size={48} color="rgba(255,255,255,0.9)" />
            <Text style={styles.placeholderText}>Touche pour choisir une photo ou une vidéo</Text>
            <Text style={styles.placeholderHint}>
              Ta story sera visible par tes amis pendant 24h. Les vidéos sont sans son (30s max).
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function CaptionInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.captionWrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Écris une légende…"
        placeholderTextColor="rgba(255,255,255,0.7)"
        style={styles.caption}
        maxLength={500}
      />
    </View>
  );
}

function VideoStage({
  state,
  caption,
  onCaption,
  onCancel,
  onRetry,
  onRemove,
}: {
  state: ReturnType<typeof useStoryVideoUpload>['state'];
  caption: string;
  onCaption: (v: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const { phase, progress, prepared, error } = state;
  const pct = Math.round(progress * 100);

  return (
    <>
      {prepared?.thumbnailUri ? (
        <Image source={{ uri: prepared.thumbnailUri }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, styles.videoBg]} />
      )}

      {phase === 'ready' || phase === 'uploading' ? (
        <View style={styles.videoBadge}>
          <Feather name="video" size={13} color={Colors.white} />
          <Text style={styles.videoBadgeText}>
            Vidéo · muet{prepared ? ` · ${Math.round(prepared.sizeBytes / 1024 / 1024)} Mo` : ''}
          </Text>
        </View>
      ) : null}

      {(phase === 'ready' || phase === 'uploading') && (
        <CaptionInput value={caption} onChangeText={onCaption} />
      )}

      {phase === 'compressing' || phase === 'uploading' ? (
        <View style={styles.statusOverlay}>
          <ActivityIndicator color={Colors.white} />
          <Text style={styles.statusText}>
            {phase === 'compressing' ? 'Compression…' : 'Envoi…'} {pct}%
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Pressable onPress={onCancel} style={styles.ghostBtn} hitSlop={8}>
            <Text style={styles.ghostBtnLabel}>Annuler</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={styles.statusOverlay}>
          <Feather name="alert-triangle" size={28} color={Colors.white} />
          <Text style={styles.statusText}>{error}</Text>
          <View style={styles.errorActions}>
            <Pressable onPress={onRemove} style={styles.ghostBtn} hitSlop={8}>
              <Text style={styles.ghostBtnLabel}>Annuler</Text>
            </Pressable>
            <Pressable onPress={onRetry} style={styles.retryBtn} hitSlop={8}>
              <Feather name="rotate-ccw" size={14} color={Colors.white} />
              <Text style={styles.retryBtnLabel}>Réessayer</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase === 'ready' ? (
        <Pressable onPress={onRemove} style={styles.removeBtn}>
          <Feather name="x" size={18} color={Colors.white} />
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.brown },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  cancelBtn: { flexDirection: 'row', alignItems: 'center' },
  cancel: { color: 'rgba(255,255,255,0.9)', fontSize: Typography.sizes.md, fontWeight: '600' },
  title: { fontSize: Typography.sizes.md, fontWeight: '700', color: Colors.white },
  publish: {
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: 8,
    borderRadius: Radii.md,
    overflow: 'hidden',
  },
  publishLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  canvas: {
    flex: 1,
    margin: Spacing.lg,
    borderRadius: Radii.xxl,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  videoBg: { backgroundColor: '#000' },
  videoBadge: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radii.md,
  },
  videoBadgeText: { color: Colors.white, fontSize: Typography.sizes.xs, fontWeight: '700' },
  captionWrap: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radii.md,
    padding: Spacing.md,
  },
  caption: { color: Colors.white, fontSize: Typography.sizes.md, fontWeight: '600' },
  removeBtn: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  statusText: {
    color: Colors.white,
    fontSize: Typography.sizes.md,
    fontWeight: '700',
    textAlign: 'center',
  },
  progressTrack: {
    width: '80%',
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.orange },
  ghostBtn: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 12,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  ghostBtnLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  errorActions: { flexDirection: 'row', gap: Spacing.md },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.orange,
    borderRadius: 12,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  retryBtnLabel: { color: Colors.white, fontSize: Typography.sizes.sm, fontWeight: '700' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: Spacing.xl,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: Typography.sizes.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  placeholderHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: Typography.sizes.sm,
    textAlign: 'center',
  },
});
