import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api } from './api';

export type UploadKind = 'avatar' | 'cover' | 'photo' | 'identity';
export type UploadSource = 'library' | 'camera';

export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
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

function contentTypeFromAsset(asset: ImagePicker.ImagePickerAsset): string {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const raw = asset.mimeType ?? (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
  return allowed.includes(raw) ? raw : 'image/jpeg';
}

function pickerOptionsFor(kind: UploadKind): ImagePicker.ImagePickerOptions {
  const isAvatar = kind === 'avatar';
  const isCover = kind === 'cover';
  return {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: isAvatar || isCover,
    aspect: isAvatar ? [1, 1] : isCover ? [16, 9] : undefined,
    quality: 0.85,
  };
}

/**
 * Pick an image from the library OR camera, request a presigned S3 upload URL,
 * PUT the blob, return the public URL. Throws `UploadError` on failure so callers
 * can render a feedback banner instead of relying on `Alert.alert` (invisible on web).
 *
 * Web caveat: camera requires a secure origin (http://localhost is OK) and the
 * browser's getUserMedia permission prompt.
 */
export async function pickAndUploadImage(
  kind: UploadKind,
  source: UploadSource = 'library',
): Promise<string | null> {
  if (source === 'camera' && Platform.OS === 'web') {
    // expo-image-picker's camera mode is unreliable on the web — fall back to the
    // library picker with a file input, which most browsers allow via <input capture>.
    return pickAndUploadImage(kind, 'library');
  }

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
  const contentType = contentTypeFromAsset(asset);

  let presigned: PresignedUpload;
  try {
    const { data } = await api.post<PresignedUpload>('/profile/me/photos/presign', {
      contentType,
      kind,
    });
    presigned = data;
  } catch (err) {
    throw new UploadError(
      (err as Error).message || 'Impossible de préparer l’envoi.',
      'presign_failed',
    );
  }

  try {
    const blob = await fetch(asset.uri).then((r) => r.blob());
    const put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        // Backend bakes SSE into the signature via signableHeaders — must echo it
        // back exactly or S3 rejects with SignatureDoesNotMatch.
        'x-amz-server-side-encryption': 'AES256',
      },
      body: blob,
    });
    if (!put.ok) {
      const body = await put.text().catch(() => '');
      throw new UploadError(
        `Upload failed: ${put.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        'upload_failed',
      );
    }
    return presigned.publicUrl;
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(
      (err as Error).message || 'Échec du transfert vers le serveur.',
      'upload_failed',
    );
  }
}
