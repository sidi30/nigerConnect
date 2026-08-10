import appJson from '../app.json';

/**
 * Garde-fou du blocage Google Play.
 *
 * Réclamer READ_MEDIA_IMAGES / READ_MEDIA_VIDEO, c'est demander l'accès à TOUTE
 * la photothèque du membre. Google exige alors la déclaration « Photo and video
 * permissions », et refuse le moindre envoi en revue tant qu'elle manque — c'est
 * ce qui a bloqué les soumissions Play du 03 et du 08/08.
 *
 * L'app n'en a pas besoin : elle ne lit jamais la pellicule elle-même, elle
 * délègue au sélecteur système (PickVisualMedia / PHPickerViewController) qui
 * ne rend que le fichier choisi. Ces tests échouent si quelqu'un les remet.
 */
const BROAD_MEDIA_PERMISSIONS = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_EXTERNAL_STORAGE',
];

describe('Permissions Android déclarées', () => {
  const android = appJson.expo.android;

  it.each(BROAD_MEDIA_PERMISSIONS)('ne réclame pas %s', (permission) => {
    expect(android.permissions).not.toContain(permission);
  });

  it.each(BROAD_MEDIA_PERMISSIONS)('bloque %s contre une fusion de manifeste', (permission) => {
    // Une dépendance peut déclarer la permission dans SON manifeste : sans
    // blocage explicite elle remonte dans l'APK par fusion, et le blocage Play
    // revient sans que personne n'ait touché à cette liste.
    expect(android.blockedPermissions).toContain(permission);
  });

  it('garde la caméra : elle, on en a réellement besoin', () => {
    // Prendre une photo/vidéo passe par launchCameraAsync, qui exige la
    // permission — contrairement au choix dans la galerie.
    expect(android.permissions).toContain('android.permission.CAMERA');
  });

  it('ne déclare aucune permission absente de la liste attendue', () => {
    // Empêche l'ajout silencieux d'une permission au fil des features.
    expect([...android.permissions].sort()).toEqual(
      [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.CAMERA',
        'android.permission.INTERNET',
        'android.permission.POST_NOTIFICATIONS',
      ].sort(),
    );
  });
});
