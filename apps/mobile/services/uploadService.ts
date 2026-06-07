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
 * Resize + recompress the picked image so the network payload is bounded.
 * Returns a new file URI on disk (the original is left untouched).
 */
async function resizeForUpload(
  asset: ImagePicker.ImagePickerAsset,
  kind: UploadKind,
): Promise<{ uri: string; contentType: string }> {
  const maxDim = MAX_DIMENSION_BY_KIND[kind];
  const quality = QUALITY_BY_KIND[kind];

  // Skip the round-trip for tiny pictures — saves a few hundred ms on avatars
  // already pre-cropped via `allowsEditing`.
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const needsResize = Math.max(w, h) > maxDim;

  if (!needsResize) {
    const ct = asset.mimeType ?? (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return { uri: asset.uri, contentType: ct };
  }

  const ratio = maxDim / Math.max(w, h);
  const targetWidth = Math.round(w * ratio);
  const targetHeight = Math.round(h * ratio);

  const result = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: targetWidth, height: targetHeight } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
  );

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
  const permissionFn =
    source === 'camera'
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
  const perm = await permissionFn();
  if (!perm.granted) {
    throw new UploadError(
      source === 'camera'
        ? "Autorise l'accès à la caméra dans les réglages de ton appareil."
        : "Autorise l'accès à tes photos dans les réglages de ton appareil.",
      'permission_denied',
    );
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
    throw new UploadError(
      (err as Error).message || 'Impossible de préparer l’envoi.',
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
