import { Platform, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Hauteur de la barre d'actions posée au-dessus d'un média (✕, compteur…). */
export const OVERLAY_BAR_H = 56;
/** Marge basse minimale, même sur un téléphone sans barre de navigation. */
export const MIN_BOTTOM_GUTTER = 16;
/** Marge haute minimale : Android peut renvoyer un inset à 0 en edge-to-edge. */
export const MIN_TOP_GUTTER = 8;
/** En dessous, la photo n'est plus regardable — on préfère déborder. */
export const MIN_CONTENT_H = 160;

export type MediaOverlayLayout = {
  /** Marge haute sûre (encoche / barre de statut). */
  topInset: number;
  /** Marge basse sûre (barre de navigation / home indicator). */
  bottomInset: number;
  /** Hauteur totale de l'entête : aucun média ne doit passer dessous. */
  headerH: number;
  /** Hauteur restante pour le média, sur n'importe quel téléphone. */
  contentH: number;
};

type Input = {
  screenH: number;
  insetTop: number;
  insetBottom: number;
  /** `StatusBar.currentHeight` sur Android, 0/undefined ailleurs. */
  statusBarH?: number | null;
  barH?: number;
};

/**
 * Partie pure du calcul (testable sans rendu). Garantit deux choses sur tous
 * les téléphones : l'entête reste cliquable au-dessus de l'encoche, et le média
 * tient dans la place qui reste au lieu de passer sous les boutons.
 */
export function computeMediaOverlayLayout({
  screenH,
  insetTop,
  insetBottom,
  statusBarH,
  barH = OVERLAY_BAR_H,
}: Input): MediaOverlayLayout {
  const topInset = Math.max(insetTop, statusBarH ?? 0, MIN_TOP_GUTTER);
  const bottomInset = Math.max(insetBottom, MIN_BOTTOM_GUTTER);
  const headerH = topInset + barH;
  const contentH = Math.max(MIN_CONTENT_H, screenH - headerH - bottomInset);
  return { topInset, bottomInset, headerH, contentH };
}

/** Version branchée sur l'écran courant (rotation / multi-fenêtre compris). */
export function useMediaOverlayLayout(barH?: number): MediaOverlayLayout & { screenW: number } {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = computeMediaOverlayLayout({
    screenH: height,
    insetTop: insets.top,
    insetBottom: insets.bottom,
    statusBarH: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    barH,
  });
  return { ...layout, screenW: width };
}
