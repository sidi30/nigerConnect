import { looksLikeSuspicion } from './animation-chat.service';

/**
 * La détection de doute n'existe que pour FAIRE TAIRE le compte et rendre la
 * main au propriétaire. Elle n'alimente aucune esquive : c'est un interrupteur,
 * pas un aiguillage. Ces tests protègent donc surtout contre le faux négatif —
 * une question ratée, c'est un membre à qui on continue de répondre alors qu'il
 * demandait justement à qui il parlait.
 */
describe('looksLikeSuspicion', () => {
  it.each([
    'tu es un bot ?',
    'C’est un robot qui écrit ça',
    "c'est de l'IA non ?",
    'intelligence artificielle ?',
    'tu es chatgpt',
    'ce compte est un faux profil',
    'tu es une vraie personne ?',
    'y a un vrai humain derrière ?',
    'tu es un programme',
    "c'est automatisé tout ça",
  ])('repère « %s »', (text) => {
    expect(looksLikeSuspicion(text)).toBe(true);
  });

  it.each([
    'salut ça va ?',
    'merci pour l’info sur l’ikamet',
    'tu connais un bon plan pour le loyer à Bursa ?',
    'je suis arrivé à Paris le mois dernier',
    // Piège : « robotique » parle d'études, pas du compte.
    'je fais des études de robotique',
  ])('laisse passer « %s »', (text) => {
    expect(looksLikeSuspicion(text)).toBe(false);
  });

  it('ne se déclenche pas sur un message vide', () => {
    expect(looksLikeSuspicion(null)).toBe(false);
    expect(looksLikeSuspicion('')).toBe(false);
  });
});
