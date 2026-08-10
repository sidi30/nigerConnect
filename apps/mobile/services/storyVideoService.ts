import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Video as VideoCompressor } from 'react-native-compressor';
import { Platform } from 'react-native';
import { api } from './api';
import {
  UploadError,
  uploadLocalImage,
  type PresignedUpload,
  type UploadSource,
} from './uploadService';

/**
 * Story video pipeline (beta) — mirrors the ADR `docs/adr/ADR-video-stories.md`:
 * pick/capture → H.265 compress ≤720p ≤30s, audio STRIPPED (muet), size cap 25 Mo
 * → presigned PUT to `stories/{userId}/…` → create story. The server re-enforces
 * the 25 Mo cap + verified-only + kill-switch, so this client stays fail-soft.
 */

// Hard client cap — the server also enforces it (HEAD ContentLength) at binding.
export const STORY_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const STORY_VIDEO_MAX_DURATION_SEC = 30;
// 720p longest side + a conservative bitrate: 30 s @ ~3 Mbps ≈ 11 Mo, well under
// the 25 Mo ceiling even before HEVC gains. `stripAudio` drops the audio track
// entirely — the beta ships MUTE (ADR SD-2), so the mic permission stays blocked.
const TARGET_MAX_SIZE_PX = 720;
const TARGET_BITRATE = 3_000_000;

export type StoryVideoContentType = 'video/mp4' | 'video/quicktime';

/** A raw clip chosen from the library or camera — not yet compressed. */
export interface PickedStoryVideo {
  uri: string;
  durationMs: number;
  width: number | null;
  height: number | null;
}

/** A compressed, thumbnailed clip ready to preview locally and upload on confirm. */
export interface PreparedStoryVideo {
  /** Local file URI of the compressed (muted, 720p) clip — NOT yet uploaded. */
  uri: string;
  contentType: StoryVideoContentType;
  /** Local thumbnail image URI (empty string if generation failed — non-blocking). */
  thumbnailUri: string;
  width: number | null;
  height: number | null;
  durationMs: number;
  sizeBytes: number;
}

/** The public URLs returned once the clip + its poster are on the bucket. */
export interface UploadedStoryVideo {
  mediaUrl: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

/**
 * Pick a single clip from the library OR capture one. Camera capture is bounded
 * to 30 s by the OS (`videoMaxDuration`); library picks are bounded client-side
 * in `prepareStoryVideo`. Returns null if the user cancels.
 */
export async function pickStoryVideo(
  source: UploadSource = 'library',
): Promise<PickedStoryVideo | null> {
  // Comme pour les photos : seule la capture caméra exige une permission. Le
  // choix dans la galerie passe par le sélecteur système, qui ne rend que le
  // clip choisi (voir uploadService.pickImage).
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new UploadError(
        "Autorise l'accès à la caméra dans les réglages de ton appareil.",
        'permission_denied',
      );
    }
  }

  const launchFn =
    source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await launchFn({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    videoMaxDuration: STORY_VIDEO_MAX_DURATION_SEC,
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0]!;
  return {
    uri: asset.uri,
    durationMs: asset.duration ?? 0,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

/**
 * Compress on-device (H.265 where supported, 720p, audio stripped) and generate
 * a poster. Enforces the 30 s + 25 Mo caps locally so we never ship a payload the
 * server will reject. `onCancelId` yields a token to abort via `cancelPreparation`.
 */
export async function prepareStoryVideo(
  picked: PickedStoryVideo,
  opts: {
    onProgress?: (fraction: number) => void;
    onCancelId?: (cancellationId: string) => void;
  } = {},
): Promise<PreparedStoryVideo> {
  // Library picks aren't length-bounded by the OS — reject over-long clips early
  // (+1 s tolerance for rounding) so the user isn't waiting on a doomed compress.
  if (picked.durationMs && picked.durationMs > (STORY_VIDEO_MAX_DURATION_SEC + 1) * 1000) {
    throw new UploadError(
      `Ta vidéo dépasse ${STORY_VIDEO_MAX_DURATION_SEC}s. Raccourcis-la puis réessaie.`,
      'not_supported',
    );
  }

  let outUri: string;
  try {
    outUri = await VideoCompressor.compress(
      picked.uri,
      {
        compressionMethod: 'manual',
        maxSize: TARGET_MAX_SIZE_PX,
        bitrate: TARGET_BITRATE,
        stripAudio: true, // MUET (ADR SD-2) — audio track removed from the output.
        getCancellationId: opts.onCancelId,
      },
      (p) => opts.onProgress?.(p),
    );
  } catch (err) {
    throw new UploadError(
      (err as Error).message || 'Compression de la vidéo impossible.',
      'not_supported',
    );
  }

  const info = await FileSystem.getInfoAsync(outUri);
  const sizeBytes = info.exists ? info.size : 0;
  if (sizeBytes > STORY_VIDEO_MAX_BYTES) {
    throw new UploadError(
      `Vidéo trop lourde (${Math.round(sizeBytes / 1024 / 1024)} Mo). Limite ${Math.round(
        STORY_VIDEO_MAX_BYTES / 1024 / 1024,
      )} Mo.`,
      'not_supported',
    );
  }

  let thumbnailUri = '';
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(picked.uri, { time: 0, quality: 0.7 });
    thumbnailUri = thumb.uri;
  } catch {
    // Poster is a nice-to-have — the story still publishes without it.
  }

  const contentType: StoryVideoContentType = outUri.toLowerCase().endsWith('.mov')
    ? 'video/quicktime'
    : 'video/mp4';

  return {
    uri: outUri,
    contentType,
    thumbnailUri,
    width: picked.width,
    height: picked.height,
    durationMs: picked.durationMs,
    sizeBytes,
  };
}

/** Abort an in-flight compression started via `prepareStoryVideo`. */
export function cancelPreparation(cancellationId: string): void {
  VideoCompressor.cancelCompression(cancellationId);
}

/**
 * Upload a prepared clip: (1) push the poster through the OWNED image flow so it
 * lands under `users/{id}/` (never a raw client URL), then (2) presign + PUT the
 * clip to `stories/{userId}/…`. Returns the canonical public URLs for the story
 * create call. `onUploadTask` exposes a cancel handle for the (large) clip PUT.
 */
export async function uploadPreparedVideo(
  prepared: PreparedStoryVideo,
  opts: {
    onProgress?: (fraction: number) => void;
    onUploadTask?: (task: { cancel: () => void }) => void;
  } = {},
): Promise<UploadedStoryVideo> {
  // 1. Poster via the owned image presign (bounded, resized) — best-effort.
  let thumbnailUrl: string | undefined;
  if (prepared.thumbnailUri) {
    try {
      thumbnailUrl = await uploadLocalImage(
        { uri: prepared.thumbnailUri, contentType: 'image/jpeg' },
        'photo',
      );
    } catch {
      thumbnailUrl = undefined; // Don't fail the whole story over a missing poster.
    }
  }

  // 2. Presign the clip. Server gates (kill-switch / verified / quota) fire here.
  let presigned: PresignedUpload;
  try {
    const { data } = await api.post<PresignedUpload>('/stories/presign', {
      contentType: prepared.contentType,
    });
    presigned = data;
  } catch (err) {
    throw new UploadError(describeStoryVideoError(err), 'presign_failed');
  }

  // 3. Stream the clip straight to the bucket.
  await putVideoToS3({
    uploadUrl: presigned.uploadUrl,
    fileUri: prepared.uri,
    contentType: prepared.contentType,
    sseRequired: presigned.sseRequired === true,
    onProgress: opts.onProgress,
    onUploadTask: opts.onUploadTask,
  });

  return {
    mediaUrl: presigned.publicUrl,
    thumbnailUrl,
    width: prepared.width ?? undefined,
    height: prepared.height ?? undefined,
  };
}

async function putVideoToS3(args: {
  uploadUrl: string;
  fileUri: string;
  contentType: string;
  sseRequired: boolean;
  onProgress?: (fraction: number) => void;
  onUploadTask?: (task: { cancel: () => void }) => void;
}): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': args.contentType };
  if (args.sseRequired) headers['x-amz-server-side-encryption'] = 'AES256';

  if (Platform.OS === 'web') {
    args.onProgress?.(0);
    const blob = await fetch(args.fileUri).then((r) => r.blob());
    const put = await fetch(args.uploadUrl, { method: 'PUT', headers, body: blob });
    args.onProgress?.(1);
    if (!put.ok) {
      throw new UploadError(`Échec du transfert de la vidéo (${put.status}).`, 'upload_failed');
    }
    return;
  }

  const task = FileSystem.createUploadTask(
    args.uploadUrl,
    args.fileUri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
    },
    (p) => {
      if (p.totalBytesExpectedToSend > 0) {
        args.onProgress?.(Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend));
      }
    },
  );
  // Hand a cancel handle to the caller so a flaky 4G upload can be aborted.
  args.onUploadTask?.({
    cancel: () => {
      void task.cancelAsync();
    },
  });
  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new UploadError(
      `Échec du transfert de la vidéo (${result?.status ?? 0}).`,
      'upload_failed',
    );
  }
}

/**
 * Turn an axios/server error into a user-facing French message, mapping the
 * documented video error codes (kill-switch, verified-only, quotas) to clear
 * copy so the UI degrades cleanly when the server refuses the clip.
 */
export function describeStoryVideoError(err: unknown): string {
  const e = err as {
    response?: { data?: { code?: string; message?: string } };
    message?: string;
  };
  const code = e.response?.data?.code;
  const serverMessage = e.response?.data?.message;
  switch (code) {
    case 'VIDEO_DISABLED':
      return 'La vidéo est temporairement indisponible. Réessaie plus tard.';
    case 'IDENTITY_NOT_APPROVED':
      return 'Publier une vidéo est réservé aux comptes vérifiés.';
    case 'ACTIVE_VIDEO_QUOTA_EXCEEDED':
      return 'Tu as trop de vidéos actives. Attends qu’une story expire (24h) puis réessaie.';
    case 'BYTES_QUOTA_EXCEEDED':
    case 'UPLOAD_QUOTA_EXCEEDED':
      return 'Tu as atteint ta limite de vidéos pour aujourd’hui. Réessaie demain.';
    default:
      return serverMessage || e.message || 'Impossible de publier la vidéo.';
  }
}
