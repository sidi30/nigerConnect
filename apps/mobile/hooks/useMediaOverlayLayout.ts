import { Platform, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Hauteur de la barre d'actions posée au-dessus d'un média (✕, compteur…). */
export const OVERLAY_BAR_H = 56;
/** Marge basse minimale, même sur un téléphone sans barre de navigation. */
export const MIN_BOTTOM_GUTTER = 16;
/**
 * Replis quand l'inset haut vaut 0 alors qu'il ne devrait pas.
 *
 * Ça arrive : les écrans en `presentation: 'fullScreenModal'` couvrent
 * l'encoche, et react-native-safe-area-context y renvoie parfois 0 sur iOS.
 * Résultat, l'entête se dessine SOUS la Dynamic Island et ses boutons
 * deviennent intouchables — on ne peut littéralement plus publier ni fermer.
 *
 * 59 px couvre la Dynamic Island des iPhone récents ; sur Android on connaît la
 * hauteur réelle de la barre de statut, sinon 24 dp (valeur historique).
 * Ce repli ne s'applique QUE si l'inset est nul : un inset correct est respecté
 * au pixel près, y compris les 20 px d'un iPhone sans encoche.
 */
export const IOS_NOTCH_FALLBACK = 59;
export const ANDROID_STATUS_FALLBACK = 24;
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
  /** 'ios' | 'android' — choisit le repli quand l'inset haut est nul. */
  platform?: string;
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
  platform,
}: Input): MediaOverlayLayout {
  // Un inset connu fait toujours foi. Le repli ne sert qu'au cas dégradé où il
  // vaut 0 : sans lui l'entête passe sous l'encoche et devient intouchable.
  const fallbackTop =
    platform === 'ios'
      ? IOS_NOTCH_FALLBACK
      : Math.max(statusBarH ?? 0, ANDROID_STATUS_FALLBACK);
  const topInset = Math.max(insetTop, statusBarH ?? 0) || fallbackTop;
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
    platform: Platform.OS,
  });
  return { ...layout, screenW: width };
}
