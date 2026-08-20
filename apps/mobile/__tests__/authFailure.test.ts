import { isNetworkFailure, isSessionRejected } from '../services/authFailure';

/**
 * La règle qui a coûté sa session à une utilisatrice sur Motorola : jusqu'au
 * 20/08/2026, TOUT échec effaçait les jetons. Un délai d'attente dépassé sur
 * réseau mobile la déconnectait, elle relançait, retombait sur l'écran de
 * connexion — « l'application se réinitialise ». Ces tests figent la seule
 * distinction qui compte : refus explicite du serveur, ou pas de réponse.
 *
 * Les erreurs sont fabriquées à la main plutôt qu'importées d'axios : charger
 * axios dans l'environnement de test d'Expo casse le lancement.
 */
const rejected = (status: number) => ({
  isAxiosError: true,
  message: 'rejeté',
  response: { status, data: {} },
});

/** Coupure, DNS, délai dépassé : axios remonte l'erreur SANS `response`. */
const noResponse = (code: string) => ({
  isAxiosError: true,
  code,
  message: 'pas de réponse',
  response: undefined,
});

describe('isSessionRejected', () => {
  it('reconnaît un refus du serveur', () => {
    expect(isSessionRejected(rejected(401))).toBe(true);
    expect(isSessionRejected(rejected(403))).toBe(true);
  });

  it.each([
    ['ECONNABORTED', 'délai dépassé'],
    ['ERR_NETWORK', 'coupure réseau'],
    ['ENOTFOUND', 'DNS injoignable'],
  ])('ne prend pas %s (%s) pour un refus', (code) => {
    expect(isSessionRejected(noResponse(code))).toBe(false);
  });

  it('ne prend pas une panne serveur pour un refus de session', () => {
    // 500/502/503 : le serveur va mal, la session n'y est pour rien. Effacer
    // ici déconnecterait tout le monde pendant un déploiement.
    expect(isSessionRejected(rejected(500))).toBe(false);
    expect(isSessionRejected(rejected(502))).toBe(false);
    expect(isSessionRejected(rejected(503))).toBe(false);
  });

  it('ne se laisse pas piéger par une réponse malformée', () => {
    expect(isSessionRejected({ isAxiosError: true, response: null })).toBe(false);
    expect(isSessionRejected({ isAxiosError: true, response: { status: '401' } })).toBe(false);
    expect(isSessionRejected(new Error('boom'))).toBe(false);
    expect(isSessionRejected(null)).toBe(false);
    expect(isSessionRejected(undefined)).toBe(false);
    expect(isSessionRejected('401')).toBe(false);
  });
});

describe('isNetworkFailure', () => {
  it('est vrai quand le serveur n’a pas répondu', () => {
    expect(isNetworkFailure(noResponse('ECONNABORTED'))).toBe(true);
  });

  it('est faux dès qu’une réponse existe', () => {
    expect(isNetworkFailure(rejected(401))).toBe(false);
    expect(isNetworkFailure(rejected(500))).toBe(false);
  });

  it("est faux pour ce qui n'est pas une erreur réseau du client HTTP", () => {
    expect(isNetworkFailure(new Error('boom'))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});
