import { AnimationWriterService } from './animation-writer.service';

/**
 * `vet()` est la dernière barrière avant qu'un texte écrit par un modèle ne
 * parte à un membre réel. C'est donc la partie qu'on teste : le reste du
 * service ne fait que lire et écrire des lignes en base.
 */
describe('AnimationWriterService.vet', () => {
  const writer = new AnimationWriterService(
    {} as never,
    { get: () => undefined } as never,
  );

  const accepted = (raw: string): string => {
    const v = writer.vet(raw);
    if (!v.ok) throw new Error(`refusé à tort : ${v.why}`);
    return v.text;
  };
  const why = (raw: string): string => {
    const v = writer.vet(raw);
    if (v.ok) throw new Error(`accepté à tort : ${v.text}`);
    return v.why;
  };

  it('accepte une réponse courte et ordinaire', () => {
    expect(accepted('Salut ! Ça va bien hamdoulilah, et toi ?')).toBe(
      'Salut ! Ça va bien hamdoulilah, et toi ?',
    );
  });

  it('retire les guillemets et le préfixe que le modèle ajoute parfois', () => {
    expect(accepted('"Bonjour, tu es de quelle ville ?"')).toBe('Bonjour, tu es de quelle ville ?');
    expect(accepted('TOI : Bonjour !')).toBe('Bonjour !');
    expect(accepted('Réponse: Bonjour !')).toBe('Bonjour !');
  });

  it('refuse le vide et le trop long', () => {
    expect(why('')).toBe('réponse vide');
    expect(why('  " "  ')).toBe('réponse vide');
    expect(why('a'.repeat(321))).toBe('réponse trop longue');
  });

  it('refuse un pavé en plusieurs paragraphes', () => {
    expect(why('Bonjour.\n\nEt sinon, comment vas-tu ?')).toBe('plusieurs paragraphes');
  });

  it('refuse le modèle qui récite ses consignes', () => {
    expect(why("En tant qu'assistant, je peux t'aider.")).toBe('le modèle récite ses consignes');
    expect(why('Je suis un modèle de langage.')).toBe('le modèle récite ses consignes');
  });

  it('refuse un brouillon qui parle lui-même de bots ou d’IA', () => {
    // Relancerait exactement le soupçon qu'on escalade ailleurs.
    expect(why("Non non, je ne suis pas un bot !")).toBe('le brouillon parle de bots ou d’IA');
  });

  describe('promesses qu’un compte d’animation ne peut pas tenir', () => {
    it.each([
      ['Appelle-moi au 06 12 34 56 78 !', 'numéro de téléphone'],
      ['Écris-moi sur hadiza.seyni@gmail.com', 'adresse e-mail'],
      ['Ajoute-moi sur WhatsApp, on discutera mieux', 'renvoi vers une autre messagerie'],
      ['Avec plaisir, on se voit samedi alors ?', 'rendez-vous physique'],
      ['On peut prendre rendez-vous si tu veux', 'rendez-vous physique'],
      ['Je t’aime aussi, tu es adorable', 'registre amoureux'],
      ['Envoie-moi de l’argent pour le billet', 'sollicitation argent'],
      ['Je suis une intelligence artificielle', 'auto-désignation'],
    ])('refuse « %s »', (raw, expected) => {
      expect(why(raw)).toBe(expected);
    });

    it('laisse passer un refus poli de ces mêmes sujets', () => {
      // Le filtre doit bloquer la PROMESSE, pas le refus de la promesse : sinon
      // le compte ne peut plus décliner, et toute avance finit escaladée.
      expect(accepted('Désolée, je préfère qu’on en reste aux échanges ici.')).toBeTruthy();
      expect(accepted('Je ne donne pas mes coordonnées, mais on peut discuter ici.')).toBeTruthy();
    });
  });

  it('reste éteint tant que ANIMATION_LLM_URL est absent', async () => {
    expect(writer.enabled).toBe(false);
    // Éteint, il ne touche à rien : c'est ce qui garde le comportement d'avant
    // en développement et dans les tests.
    await expect(writer.fillDrafts()).resolves.toBe(0);
  });
});
