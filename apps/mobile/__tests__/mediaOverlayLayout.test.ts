import {
  computeMediaOverlayLayout,
  IOS_NOTCH_FALLBACK,
  MIN_CONTENT_H,
  OVERLAY_BAR_H,
} from '@/hooks/useMediaOverlayLayout';

/**
 * Parc de téléphones réels : c'est la variété des insets qui cassait l'affichage
 * (un iPhone à encoche pousse l'entête ~2,5× plus bas qu'un vieil Android).
 */
const DEVICES = [
  { name: 'iPhone SE (sans encoche)', screenH: 667, insetTop: 20, insetBottom: 0 },
  { name: 'iPhone 15 Pro', screenH: 852, insetTop: 59, insetBottom: 34 },
  { name: 'Pixel 8 (edge-to-edge)', screenH: 892, insetTop: 48, insetBottom: 24 },
  { name: 'Android ancien', screenH: 640, insetTop: 24, insetBottom: 0 },
  // Cas piège : Android renvoie parfois 0 dans un <Modal> — sans plancher, la ✕
  // se retrouvait sous la barre de statut.
  { name: 'Android inset perdu dans un Modal', screenH: 800, insetTop: 0, insetBottom: 0, statusBarH: 24 },
  { name: 'Android inset perdu, sans StatusBar', screenH: 800, insetTop: 0, insetBottom: 0 },
];

describe('computeMediaOverlayLayout', () => {
  it.each(DEVICES)('$name : le média tient sous l\'entête', (device) => {
    const { topInset, bottomInset, headerH, contentH } = computeMediaOverlayLayout(device);

    // L'entête ne mord jamais sur la zone du média…
    expect(headerH).toBe(topInset + OVERLAY_BAR_H);
    // …et le média + entête + marge basse tiennent dans l'écran.
    expect(headerH + contentH + bottomInset).toBeLessThanOrEqual(device.screenH);
    // Le bouton ✕ reste sous l'encoche / la barre de statut.
    expect(topInset).toBeGreaterThanOrEqual(device.insetTop);
    // Jamais nul : un inset a 0 fait passer l'entete sous l'encoche.
    expect(topInset).toBeGreaterThan(0);
    expect(contentH).toBeGreaterThanOrEqual(MIN_CONTENT_H);
  });

  it("retombe sous l'encoche quand iOS ne donne aucun inset", () => {
    // Cas vecu : un ecran en `fullScreenModal` couvre l'encoche et l'inset haut
    // remonte a 0 sur iOS. Sans repli, l'entete se dessinait SOUS la Dynamic
    // Island — « Publier » et « Annuler » devenaient intouchables.
    const { topInset } = computeMediaOverlayLayout({
      screenH: 852,
      insetTop: 0,
      insetBottom: 0,
      platform: 'ios',
    });
    expect(topInset).toBe(IOS_NOTCH_FALLBACK);
  });

  it('respecte un inset iOS reel au pixel pres, sans gonfler un ecran sans encoche', () => {
    // L'iPhone SE annonce 20 : le repli ne doit PAS s'appliquer.
    const { topInset } = computeMediaOverlayLayout({
      screenH: 667,
      insetTop: 20,
      insetBottom: 0,
      platform: 'ios',
    });
    expect(topInset).toBe(20);
  });

  it('respecte la hauteur réelle de la status bar quand l\'inset Android tombe à 0', () => {
    const { topInset } = computeMediaOverlayLayout({
      screenH: 800,
      insetTop: 0,
      insetBottom: 0,
      statusBarH: 42,
    });
    expect(topInset).toBe(42);
  });

  it('garde une marge basse même sans barre de navigation', () => {
    const { bottomInset } = computeMediaOverlayLayout({
      screenH: 800,
      insetTop: 24,
      insetBottom: 0,
    });
    expect(bottomInset).toBeGreaterThanOrEqual(16);
  });

  it('ne réduit pas le média sous le seuil lisible sur un très petit écran', () => {
    const { contentH } = computeMediaOverlayLayout({
      screenH: 200,
      insetTop: 59,
      insetBottom: 34,
    });
    expect(contentH).toBe(MIN_CONTENT_H);
  });

  it('suit la rotation : un écran plus court donne un média plus court', () => {
    const portrait = computeMediaOverlayLayout({ screenH: 852, insetTop: 59, insetBottom: 34 });
    const paysage = computeMediaOverlayLayout({ screenH: 393, insetTop: 0, insetBottom: 21 });
    expect(paysage.contentH).toBeLessThan(portrait.contentH);
  });
});
