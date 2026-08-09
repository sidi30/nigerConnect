import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  DISMISS_DISTANCE,
  DISMISS_VELOCITY,
  dismissDirection,
  shouldDismiss,
  SwipeToClose,
} from '@/components/ui/SwipeToClose';

describe('shouldDismiss', () => {
  it('ferme quand on traîne assez loin, vers le bas comme vers le haut', () => {
    expect(shouldDismiss(DISMISS_DISTANCE + 1, 0)).toBe(true);
    expect(shouldDismiss(-(DISMISS_DISTANCE + 1), 0)).toBe(true);
  });

  it('ferme sur un balayage rapide même court', () => {
    expect(shouldDismiss(20, DISMISS_VELOCITY + 1)).toBe(true);
    expect(shouldDismiss(-20, -(DISMISS_VELOCITY + 1))).toBe(true);
  });

  it('ne ferme pas sur un micro-mouvement (tap qui bouge un peu)', () => {
    expect(shouldDismiss(0, 0)).toBe(false);
    expect(shouldDismiss(8, 40)).toBe(false);
    expect(shouldDismiss(DISMISS_DISTANCE, DISMISS_VELOCITY)).toBe(false);
  });

  it('sort dans le sens du doigt', () => {
    expect(dismissDirection(200, 0)).toBe(1);
    expect(dismissDirection(-200, 0)).toBe(-1);
    // Trajet nul mais lancé vers le haut : on suit la vitesse.
    expect(dismissDirection(0, -900)).toBe(-1);
  });
});

describe('<SwipeToClose>', () => {
  it('rend son contenu et ne déclenche rien sans geste', () => {
    const onClose = jest.fn();
    render(
      <SwipeToClose onClose={onClose}>
        <Text>photo</Text>
      </SwipeToClose>,
    );
    expect(screen.getByText('photo')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
