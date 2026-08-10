import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { pickAndUploadImage, type UploadSource } from '@/services/uploadService';
import { describeStoryVideoError } from '@/services/storyVideoService';
import { useStoryVideoUpload } from '@/hooks/useStoryVideoUpload';
import { Colors, Gradients, Radii, Spacing, Typography } from '@/constants/theme';
import { useMediaOverlayLayout } from '@/hooks/useMediaOverlayLayout';

type Mode = 'none' | 'image' | 'video';

/** Sentinel so the create mutation can bail silently when the video upload
 *  already surfaced its own inline error (avoids a double alert). */
const SILENT = 'story-video-silent';

export default function NewStoryScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { topInset, bottomInset } = useMediaOverlayLayout();

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

  return (
    // Ecran en `fullScreenModal` : il couvre l'encoche, et l'inset haut y remonte
    // parfois a 0 sur iOS. On passe donc par le meme calcul que les autres
    // plein-ecrans media, qui retombe sur une valeur sure quand l'inset ment —
    // sinon l'entete se dessine sous la Dynamic Island et « Publier » comme
    // « Annuler » deviennent intouchables.
    <View style={[styles.container, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.cancelBtn}>
          <Feather name="chevron-left" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={styles.cancel}>Annuler</Text>
        </Pressable>
        <Text style={styles.title}>Nouvelle story</Text>
        {/* Contrepoids du bouton Annuler : garde le titre centre maintenant que
            « Publier » a quitte le bandeau pour rejoindre la legende. */}
        <View style={styles.headerSpacer} />
      </View>

      {/* « Publier » vit desormais a cote du champ de legende, donc juste
          au-dessus du clavier : sans ca, taper une legende masquerait l'action
          principale. */}
      <KeyboardAvoidingView
        style={styles.canvasWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.canvas}>
          {mode === 'image' && mediaUrl ? (
            <>
              <Image source={{ uri: mediaUrl }} style={styles.image} contentFit="cover" />
              <CaptionInput
                value={caption}
                onChangeText={setCaption}
                onPublish={() => mut.mutate()}
                canPublish={canPublish}
                busy={busy}
              />
              <Pressable onPress={resetMedia} hitSlop={10} style={styles.removeBtn}>
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
              onPublish={() => mut.mutate()}
              canPublish={canPublish}
              busy={busy}
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
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Légende + action de publication, sur une même ligne au bas du média.
 *
 * « Publier » était dans le bandeau du haut, où il se dessinait dans l'encoche
 * sur les iPhone récents — donc intouchable. Ici il est à portée de pouce et
 * hors de toute zone système, quoi que raconte l'inset de sécurité.
 */
function CaptionInput({
  value,
  onChangeText,
  onPublish,
  canPublish,
  busy,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onPublish: () => void;
  canPublish: boolean;
  busy: boolean;
}) {
  const disabled = !canPublish || busy;
  return (
    <View style={styles.captionWrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Écris une légende…"
        placeholderTextColor="rgba(255,255,255,0.7)"
        style={styles.caption}
        maxLength={500}
        multiline
      />
      <Pressable
        onPress={onPublish}
        disabled={disabled}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Publier la story"
        accessibilityState={{ disabled }}
        style={[styles.publish, disabled && { opacity: 0.4 }]}
      >
        <LinearGradient colors={Gradients.orange} style={StyleSheet.absoluteFill} />
        {busy ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={styles.publishLabel}>Publier</Text>
        )}
      </Pressable>
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
  onPublish,
  canPublish,
  busy,
}: {
  state: ReturnType<typeof useStoryVideoUpload>['state'];
  caption: string;
  onCaption: (v: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onPublish: () => void;
  canPublish: boolean;
  busy: boolean;
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
        <CaptionInput
          value={caption}
          onChangeText={onCaption}
          onPublish={onPublish}
          canPublish={canPublish}
          busy={busy}
        />
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
  headerSpacer: { width: 76 },
  canvasWrap: { flex: 1 },
  publish: {
    paddingHorizontal: Spacing.md + 2,
    // 44 px : la cible tactile minimale recommandee, hauteur alignee sur le
    // champ de legende a cote.
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radii.md,
    padding: Spacing.md,
  },
  caption: {
    flex: 1,
    color: Colors.white,
    fontSize: Typography.sizes.md,
    fontWeight: '600',
    // Une legende de plusieurs lignes ne doit pas repousser le bouton hors du
    // cadre : au-dela, le champ defile.
    maxHeight: 96,
  },
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
