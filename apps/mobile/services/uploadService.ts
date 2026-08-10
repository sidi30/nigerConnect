import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { api } from './api';

export type UploadKind = 'avatar' | 'cover' | 'photo' | 'identity';
export type UploadSource = 'library' | 'camera';

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
  /**
   * When true the API requires the client to send `x-amz-server-side-encryption: AES256`
   * (only on AWS S3). On MinIO this is false — sending the header would 501.
   */
  sseRequired?: boolean;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'permission_denied'
      | 'cancelled'
      | 'not_supported'
      | 'presign_failed'
      | 'upload_failed',
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Maximum width/height (px) we ship to the server. Beyond ~2048 there's no
 * visual benefit on phones — and an iPhone 15 Pro burst photo is 4032×3024
 * (~5–8 MB). Resizing to 2048 + JPEG quality 0.8 cuts the payload to
 * 300–800 kB, which is the difference between "instant" and "30 s upload"
 * on a flaky 4G.
 */
const MAX_DIMENSION_BY_KIND: Record<UploadKind, number> = {
  avatar: 1024,
  cover: 1920,
  photo: 2048,
  // Identity docs need to stay legible — keep more pixels and accept a bigger
  // file, but still cap so a 12 MP scan isn't shipped raw.
  identity: 2400,
};

const QUALITY_BY_KIND: Record<UploadKind, number> = {
  avatar: 0.85,
  cover: 0.8,
  photo: 0.8,
  identity: 0.9,
};

export interface UploadOptions {
  /** 0–1 progress. Fired multiple times while the file streams to the bucket. */
  onProgress?: (fraction: number) => void;
}

function pickerOptionsFor(kind: UploadKind): ImagePicker.ImagePickerOptions {
  const isAvatar = kind === 'avatar';
  const isCover = kind === 'cover';
  return {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: isAvatar || isCover,
    aspect: isAvatar ? [1, 1] : isCover ? [16, 9] : undefined,
    // expo-image-picker quality is the JPEG quality of its OWN re-encode (when
    // editing) — not a guarantee on the source file size. We resize again
    // post-pick with `expo-image-manipulator` for predictable output.
    quality: 1,
    exif: false,
  };
}

/**
 * Content types the API's presign endpoint accepts — and, just as importantly,
 * the only ones a browser can render (a moderator reviews identity documents
 * from the web console). The iOS picker hands back the ORIGINAL container, so
 * `mimeType` is routinely `image/heic` (iPhone default), and Android reports
 * `image/heif` on phones in storage-saver mode; the picker also passes through
 * gif/bmp/tiff/avif untouched. Any of those forwarded as-is is rejected by the
 * presign schema — a raw 400 the user sees as "Request failed with status
 * code 400". We re-encode them to JPEG instead.
 */
const WEB_SAFE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Resize + recompress the picked image so the network payload is bounded, and
 * normalise exotic containers (HEIC/HEIF/…) to JPEG.
 * Returns a new file URI on disk (the original is left untouched).
 */
async function resizeForUpload(
  asset: ImagePicker.ImagePickerAsset,
  kind: UploadKind,
): Promise<{ uri: string; contentType: string }> {
  const maxDim = MAX_DIMENSION_BY_KIND[kind];
  const quality = QUALITY_BY_KIND[kind];

  const sourceType = asset.mimeType ?? (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
  // Unknown dimensions (iCloud asset not downloaded, limited-library access)
  // must NOT be read as "small enough" — that path used to skip the manipulator
  // entirely and ship the original container as-is.
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const knownSize = w > 0 && h > 0;
  const needsResize = !knownSize || Math.max(w, h) > maxDim;
  const needsTranscode = !WEB_SAFE_CONTENT_TYPES.has(sourceType);

  // Skip the round-trip for tiny pictures already in a web-safe container —
  // saves a few hundred ms on avatars already pre-cropped via `allowsEditing`.
  if (!needsResize && !needsTranscode) {
    return { uri: asset.uri, contentType: sourceType };
  }

  // Only scale when we know the source dimensions AND it is over the cap;
  // otherwise the manipulator runs purely to transcode the container.
  const actions: ImageManipulator.Action[] = [];
  if (knownSize && Math.max(w, h) > maxDim) {
    const ratio = maxDim / Math.max(w, h);
    actions.push({
      resize: { width: Math.round(w * ratio), height: Math.round(h * ratio) },
    });
  }

  const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return { uri: result.uri, contentType: 'image/jpeg' };
}

async function putToS3(args: {
  uploadUrl: string;
  fileUri: string;
  contentType: string;
  sseRequired: boolean;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': args.contentType };
  if (args.sseRequired) {
    // Backend baked SSE into the signature — must echo it back exactly.
    headers['x-amz-server-side-encryption'] = 'AES256';
  }

  if (Platform.OS === 'web') {
    // Web: stream a Blob via fetch. No native progress, fall back to 0/1.
    args.onProgress?.(0);
    const blob = await fetch(args.fileUri).then((r) => r.blob());
    const put = await fetch(args.uploadUrl, { method: 'PUT', headers, body: blob });
    args.onProgress?.(1);
    if (!put.ok) {
      const body = await put.text().catch(() => '');
      throw new UploadError(
        `Upload failed: ${put.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        'upload_failed',
      );
    }
    return;
  }

  // Native: stream the file straight from disk. expo-file-system computes the
  // Content-Length itself and fires progress callbacks chunk by chunk.
  const task = FileSystem.createUploadTask(
    args.uploadUrl,
    args.fileUri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
    },
    args.onProgress
      ? (p) => {
          if (p.totalBytesExpectedToSend > 0) {
            args.onProgress!(
              Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend),
            );
          }
        }
      : undefined,
  );
  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    const status = result?.status ?? 0;
    const body = result?.body ?? '';
    throw new UploadError(
      `Upload failed: ${status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      'upload_failed',
    );
  }
}

/** A resized-on-device image ready to preview locally and upload on confirm. */
export interface PickedImage {
  /** Local file URI of the resized/compressed image (NOT yet uploaded). */
  uri: string;
  contentType: string;
}

/**
 * Pick + resize an image WITHOUT uploading it. Lets the caller show a
 * confirmation/caption screen first (chat) and only upload on "send".
 * Returns null if the user cancels the picker.
 */
export async function pickImage(
  kind: UploadKind,
  source: UploadSource = 'library',
): Promise<PickedImage | null> {
  // Seule la caméra exige une permission. Ouvrir la galerie n'en demande
  // AUCUNE : expo-image-picker délègue au sélecteur système (PickVisualMedia
  // sur Android, PHPickerViewController sur iOS), qui affiche les photos et ne
  // rend que celle choisie — l'app ne voit jamais le reste. Demander l'accès à
  // toute la photothèque ne servait donc à rien, et c'est ce qui déclenchait la
  // déclaration Play « Photo and video permissions ».
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
  const result = await launchFn(pickerOptionsFor(kind));
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0]!;
  // Resize/compress on-device — turns 5–15 MB shots into 300–800 kB.
  return resizeForUpload(asset, kind);
}

/**
 * Pick SEVERAL images at once from the library (no upload yet), resized
 * on-device. Uses `allowsMultipleSelection` — on OS/picker versions that don't
 * support it the picker simply returns a single asset, so the caller
 * transparently degrades to a mono selection (still fully OTA-safe). Camera
 * capture stays single-shot (`pickImage`), which is the native behaviour.
 * Returns [] if the user cancels.
 */
export async function pickImages(
  kind: UploadKind,
  max = 6,
): Promise<PickedImage[]> {
  // Pas de demande de permission : le sélecteur système suffit (voir pickImage).
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    selectionLimit: max,
    quality: 1,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) return [];

  const assets = result.assets.slice(0, max);
  // Resize/compress each shot on-device before it ever hits the network.
  return Promise.all(assets.map((asset) => resizeForUpload(asset, kind)));
}

/**
 * Upload a previously-picked local image to S3 and return its public URL.
 * Throws `UploadError` on failure so callers can render a feedback banner.
 */
export async function uploadLocalImage(
  picked: PickedImage,
  kind: UploadKind,
  options?: UploadOptions,
): Promise<string> {
  // 1. Ask the API for a presigned PUT URL with the right content-type.
  let presigned: PresignedUpload;
  try {
    const { data } = await api.post<PresignedUpload>('/profile/me/photos/presign', {
      contentType: picked.contentType,
      kind,
    });
    presigned = data;
  } catch (err) {
    // Prefer the API's own message: axios' default ("Request failed with
    // status code 400") tells the member nothing about what to fix.
    const apiMsg = (err as { response?: { data?: { message?: string | string[] } } }).response?.data
      ?.message;
    throw new UploadError(
      (Array.isArray(apiMsg) ? apiMsg.join(' · ') : apiMsg) ||
        'Impossible de préparer l’envoi.',
      'presign_failed',
    );
  }

  // 2. Stream the resized file to the bucket. SSE header echoed only when
  //    the backend says so (false on MinIO, true on real AWS S3).
  try {
    await putToS3({
      uploadUrl: presigned.uploadUrl,
      fileUri: picked.uri,
      contentType: picked.contentType,
      sseRequired: presigned.sseRequired === true,
      onProgress: options?.onProgress,
    });
    return presigned.publicUrl;
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(
      (err as Error).message || 'Échec du transfert vers le serveur.',
      'upload_failed',
    );
  }
}

/**
 * Pick an image from the library OR camera, request a presigned S3 upload URL,
 * resize+compress it, PUT the blob, return the public URL. Throws `UploadError`
 * on failure so callers can render a feedback banner.
 */
export async function pickAndUploadImage(
  kind: UploadKind,
  source: UploadSource = 'library',
  options?: UploadOptions,
): Promise<string | null> {
  if (source === 'camera' && Platform.OS === 'web') {
    return pickAndUploadImage(kind, 'library', options);
  }
  const picked = await pickImage(kind, source);
  if (!picked) return null;
  return uploadLocalImage(picked, kind, options);
}
