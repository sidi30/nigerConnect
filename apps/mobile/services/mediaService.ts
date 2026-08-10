import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly code: 'permission_denied' | 'download_failed' | 'not_supported',
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

/** Derive a local cache filename from a remote URL (keeps the extension). */
function cacheTargetFor(url: string): string {
  const clean = url.split('?')[0] ?? url;
  const ext = /\.(jpg|jpeg|png|gif|webp|heic)$/i.exec(clean)?.[1] ?? 'jpg';
  return `${FileSystem.cacheDirectory}nc-download-${Date.now()}.${ext.toLowerCase()}`;
}

/**
 * Download a remote image to the device's photo gallery ("Pellicule" / camera
 * roll). Requires the media-library native module — only present from a real
 * EAS build (not an OTA update). Throws `DownloadError` on failure.
 */
export async function saveImageToGallery(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new DownloadError('Téléchargement non disponible sur le web.', 'not_supported');
  }

  if (!/^https:\/\//i.test(url)) throw new DownloadError('URL non sécurisée.', 'not_supported');

  // ÉCRITURE SEULE. On ajoute une image à la pellicule, on n'a jamais besoin de
  // la lire — et le mode complet réclame READ_MEDIA_IMAGES/VIDEO, c'est-à-dire
  // l'accès à toute la photothèque. Ces permissions ne sont plus déclarées
  // (déclaration Play « Photo and video permissions ») et les demander lèverait
  // une exception : `assertGranularPermissionIntegrity` refuse une permission
  // absente du manifeste. En écriture seule, expo-media-library ne demande rien
  // sur Android 13+, où l'ajout ne requiert plus aucune permission.
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    throw new DownloadError(
      "Autorise l'accès à tes photos pour enregistrer l'image.",
      'permission_denied',
    );
  }

  const target = cacheTargetFor(url);
  try {
    const { uri, status } = await FileSystem.downloadAsync(url, target);
    if (status < 200 || status >= 300) {
      throw new DownloadError(`Échec du téléchargement (${status}).`, 'download_failed');
    }
    await MediaLibrary.saveToLibraryAsync(uri);
  } catch (err) {
    if (err instanceof DownloadError) throw err;
    throw new DownloadError(
      (err as Error).message || "Impossible d'enregistrer l'image.",
      'download_failed',
    );
  } finally {
    // Best-effort cleanup of the temp file — ignore failures.
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
  }
}
