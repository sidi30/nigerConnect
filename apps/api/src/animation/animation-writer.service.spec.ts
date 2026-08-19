import {
  AnimationWriterService,
  isSimpleOpener,
  mentionsForeignCity,
} from './animation-writer.service';

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

/**
 * Le filet ne rédige que les prises de contact. Ce périmètre n'est pas une
 * précaution de principe : mis face à « tu as prévu de venir à Konya ? », le
 * modèle local répond « je suis à Konya mais je ne viendrai pas à Konya ».
 * Une salutation n'offre pas cette prise.
 */
describe('isSimpleOpener', () => {
  const membre = (content: string) => ({ content, sender: { isAnimated: false } });
  const compte = (content: string) => ({ content, sender: { isAnimated: true } });

  it.each(['Salut', 'Bonjour', 'Bonsoir', 'Coucou', 'Fofo', 'Sannu', 'Salut ça va ?', 'ça va ?'])(
    'reconnaît « %s » comme une ouverture',
    (texte) => {
      expect(isSimpleOpener([membre(texte)])).toBe(true);
    },
  );

  it('refuse une question de fond, même en premier message', () => {
    expect(isSimpleOpener([membre('As-tu prévu de venir à Konya ?')])).toBe(false);
    expect(isSimpleOpener([membre('Comment on renouvelle son ikamet ?')])).toBe(false);
  });

  it('refuse dès qu’une conversation est engagée', () => {
    // Il y a alors un contexte à tenir, et c'est là que le modèle dérape.
    expect(
      isSimpleOpener([membre('Salut'), compte('Salut ! Ça va ?'), membre('Je suis à Lyon')]),
    ).toBe(false);
  });

  it('refuse un message vide, un média seul ou un pavé', () => {
    expect(isSimpleOpener([membre('')])).toBe(false);
    expect(isSimpleOpener([{ content: null, sender: { isAnimated: false } }])).toBe(false);
    expect(isSimpleOpener([membre(`Bonjour ${'x'.repeat(100)}`)])).toBe(false);
  });
});

/**
 * Le contrôle qui manquait le 20/08/2026 : nc11, qui habite Konya, a envoyé
 * « en ce moment je suis en famille à Istanbul » à un membre réel. La consigne
 * donnait pourtant la bonne ville. On ne peut pas demander au modèle de tenir
 * un fait — seulement le vérifier après coup.
 */
describe('mentionsForeignCity', () => {
  it('laisse passer la ville du compte', () => {
    expect(mentionsForeignCity('Salut ! Je suis à Konya en ce moment.', 'Konya')).toBe(false);
    // Accents et casse ne doivent pas créer de faux négatif.
    expect(mentionsForeignCity('je vis a meknes', 'Meknès')).toBe(false);
  });

  it('attrape une autre ville', () => {
    expect(
      mentionsForeignCity('Salut ! En ce moment je suis en famille à Istanbul.', 'Konya'),
    ).toBe(true);
    expect(mentionsForeignCity('Je suis à Paris pour mes études.', 'Niamey')).toBe(true);
  });

  it('gère les villes en deux mots sans se déclencher sur un seul', () => {
    expect(mentionsForeignCity('Je suis à New York.', 'Konya')).toBe(true);
    // « York » seul n'est pas « New York » : pas de faux positif.
    expect(mentionsForeignCity('Le quartier de York est joli.', 'Konya')).toBe(false);
  });

  it('ne se déclenche pas sur un texte sans ville', () => {
    expect(mentionsForeignCity('Bonjour ! Ça va bien et toi ?', 'Konya')).toBe(false);
  });
});

describe('vet — faits invérifiables', () => {
  const writer = new AnimationWriterService({} as never, { get: () => undefined } as never);

  it('refuse un brouillon qui déplace le compte', () => {
    const v = writer.vet('Salut ! En ce moment je suis en famille à Istanbul.', 'Konya');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.why).toBe('le brouillon situe le compte dans une autre ville');
  });

  it('refuse une allusion à une actualité inventée', () => {
    const v = writer.vet('Salut ! Tu as entendu parler de ces derniers événements ?', 'Konya');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.why).toBe('référence à une actualité que le modèle ignore');
  });

  it('accepte la même phrase avec la bonne ville et sans actualité', () => {
    const v = writer.vet('Salut ! Je suis à Konya en ce moment. Et toi ?', 'Konya');
    expect(v.ok).toBe(true);
  });
});
