import { isInActiveWindow } from './animation-engagement.service';

/**
 * La fenêtre d'activité évite qu'un compte like à 4 h du matin — c'est le
 * genre de détail qui trahit plus sûrement qu'un texte maladroit.
 *
 * Le cas qui casse est la fenêtre à cheval sur minuit : écrite naïvement, elle
 * est vide, et le compte concerné ne fait plus jamais rien sans que rien ne
 * signale la panne.
 */
describe('isInActiveWindow', () => {
  describe('fenêtre normale 8 h → 22 h', () => {
    it.each([
      [8, true],
      [14, true],
      [21, true],
      [22, false], // borne haute exclue
      [7, false],
      [3, false],
    ])('%i h → %s', (hour, expected) => {
      expect(isInActiveWindow(8, 22, hour)).toBe(expected);
    });
  });

  describe('fenêtre à cheval sur minuit 22 h → 6 h', () => {
    it.each([
      [22, true],
      [23, true],
      [0, true],
      [5, true],
      [6, false],
      [12, false],
    ])('%i h → %s', (hour, expected) => {
      expect(isInActiveWindow(22, 6, hour)).toBe(expected);
    });
  });

  it('une fenêtre dégénérée (from === to) ne laisse rien passer', () => {
    for (let h = 0; h < 24; h += 1) expect(isInActiveWindow(9, 9, h)).toBe(false);
  });
});
