import { type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

export const DISMISS_DISTANCE = 110; // px traînés avant de lâcher la photo
export const DISMISS_VELOCITY = 800; // un flick rapide ferme même sur un court trajet

/**
 * Ferme-t-on à la fin du geste ? Assez traîné OU assez rapide, dans les deux
 * sens. Extrait pour être testable sans monter d'animation — d'où le `worklet`,
 * sans lequel l'appel depuis `onEnd` (thread UI) planterait.
 */
export function shouldDismiss(translationY: number, velocityY: number): boolean {
  'worklet';
  return Math.abs(translationY) > DISMISS_DISTANCE || Math.abs(velocityY) > DISMISS_VELOCITY;
}

/** Sens de sortie : on continue le mouvement du doigt. */
export function dismissDirection(translationY: number, velocityY: number): 1 | -1 {
  'worklet';
  return (translationY || velocityY) < 0 ? -1 : 1;
}

type Props = {
  onClose: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Désactive le geste (ex. pendant qu'une confirmation est ouverte). */
  enabled?: boolean;
};

/**
 * Enveloppe une photo plein écran : balayer vers le haut ou vers le bas la
 * referme, comme sur Instagram/WhatsApp. Le geste n'accroche que sur du
 * vertical (`failOffsetX`) pour laisser un carrousel horizontal fonctionner.
 */
export function SwipeToClose({ onClose, children, style, enabled = true }: Props) {
  const { height } = useWindowDimensions();
  const dy = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetY([-14, 14])
    .failOffsetX([-18, 18])
    .onUpdate((e) => {
      dy.value = e.translationY;
    })
    .onEnd((e) => {
      if (shouldDismiss(e.translationY, e.velocityY)) {
        const dir = dismissDirection(e.translationY, e.velocityY);
        dy.value = withTiming(dir * height, { duration: 180 }, () => {
          runOnJS(onClose)();
        });
      } else {
        dy.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    });

  const animStyle = useAnimatedStyle(() => {
    const progress = Math.min(Math.abs(dy.value) / (height * 0.55), 1);
    return {
      transform: [{ translateY: dy.value }, { scale: 1 - progress * 0.12 }],
      opacity: 1 - progress * 0.6,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.fill, style, animStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
