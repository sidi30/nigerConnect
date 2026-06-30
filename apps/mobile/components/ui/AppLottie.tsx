/**
 * AppLottie — thin wrapper around lottie-react-native for premium vector
 * animations (success ticks, celebratory likes, illustrated empty-states).
 *
 * Infrastructure only: drop a LottieFiles .json into apps/mobile/assets/lottie/
 * and pass it as `source`. Respects the OS "Reduce Motion" setting (renders a
 * static last frame instead of looping). No animation assets are bundled yet —
 * the design team picks them (ANIM-9).
 *
 * Usage:
 *   import success from '@/assets/lottie/success.json';
 *   <AppLottie source={success} autoPlay loop={false} style={{ width: 160, height: 160 }} />
 */
import LottieView, { type LottieViewProps } from 'lottie-react-native';
import { useReducedMotion } from 'react-native-reanimated';

type Props = LottieViewProps;

export function AppLottie({ autoPlay = true, loop = true, ...rest }: Props) {
  const reduce = useReducedMotion();
  return (
    <LottieView
      autoPlay={reduce ? false : autoPlay}
      loop={reduce ? false : loop}
      // When motion is reduced, freeze on the final frame so the UI still reads.
      progress={reduce ? 1 : undefined}
      {...rest}
    />
  );
}
