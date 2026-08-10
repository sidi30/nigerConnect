/**
 * Pendant côté code du garde-fou app.json : ouvrir la galerie ne doit demander
 * AUCUNE permission. Le sélecteur système ne rend que le fichier choisi.
 *
 * Sans ce test, quelqu'un peut remettre « par prudence » un
 * requestMediaLibraryPermissionsAsync() : sur Android il redeviendrait inutile,
 * et sur iOS il ferait apparaître une demande d'accès à toute la photothèque
 * que l'app n'utilise pas.
 */
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos' },
}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@/services/api', () => ({ api: {} }));

import * as ImagePicker from 'expo-image-picker';
import { pickImage, pickImages } from '@/services/uploadService';

const requestLibrary = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const requestCamera = ImagePicker.requestCameraPermissionsAsync as jest.Mock;

describe('Choix d\'un média', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ouvre la galerie sans demander la moindre permission', async () => {
    await pickImage('photo', 'library');
    expect(requestLibrary).not.toHaveBeenCalled();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
  });

  it('ouvre la sélection multiple sans permission non plus', async () => {
    await pickImages('photo');
    expect(requestLibrary).not.toHaveBeenCalled();
  });

  it('demande en revanche la caméra avant de la lancer', async () => {
    // Elle, c'est une vraie permission : sans elle, launchCameraAsync échoue.
    await pickImage('photo', 'camera');
    expect(requestCamera).toHaveBeenCalled();
  });
});
