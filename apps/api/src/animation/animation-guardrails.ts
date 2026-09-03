/**
 * Garde-fous d'écriture communs aux comptes d'animation.
 *
 * Ce qui est ici s'applique QUEL QUE SOIT le rédacteur : l'atelier sur le poste
 * du propriétaire, le filet local, ou une correction faite à la main depuis la
 * console. Une consigne écrite dans `scripts/animation-atelier.md` ne vaut que
 * tant que l'atelier la lit ; ce fichier, lui, tient même quand personne ne
 * relit rien.
 */

/**
 * Salutations bannies.
 *
 * « Fofo » (zarma) et « Sannu » (haoussa) ouvraient une publication sur deux :
 * répétées à cette fréquence sur vingt-cinq comptes, elles ne signent plus une
 * origine, elles signent un gabarit — exactement le genre de régularité qui a
 * déjà fait repérer l'animation par un membre. Le texte reste nigérien par ce
 * qu'il raconte, pas par un mot d'ouverture recopié.
 */
const BANNED_GREETING = /\b(?:fofo|sannu)\b/i;

/** La même, en tête de texte, avec sa ponctuation et ses compléments usuels. */
const LEADING_BANNED_GREETING =
  /^[\s"'«»]*(?:fofo|sannu)(?:\s+(?:da\s+\p{L}+|tout\s+le\s+monde|à\s+tous))?\s*[,.!?;:…—–-]*\s*/iu;

/** Le texte contient-il une salutation bannie, où que ce soit ? */
export function containsBannedGreeting(text: string): boolean {
  return BANNED_GREETING.test(text);
}

/**
 * Retire la salutation bannie quand elle n'est qu'une entrée en matière.
 *
 * Refuser tout le message serait plus simple, mais c'est le membre qui paierait :
 * une réponse écartée le laisse sans réponse. Or « Fofo. La rentrée arrive… »
 * reste parfaitement lisible sans son premier mot. On ne coupe donc que
 * l'ouverture, et on remet la majuscule que la coupe emporte.
 *
 * Le mot ailleurs dans la phrase n'est PAS traité ici : ce n'est plus une
 * formule de politesse, c'est du contenu, et l'appelant décide quoi en faire.
 */
export function stripLeadingBannedGreeting(text: string): string {
  const stripped = text.replace(LEADING_BANNED_GREETING, '');
  if (stripped === text) return text;
  const trimmed = stripped.trimStart();
  if (trimmed.length === 0) return trimmed;
  return trimmed[0]!.toUpperCase() + trimmed.slice(1);
}

/**
 * Nettoie ce qui peut l'être, et dit si ce qui reste est publiable.
 *
 * `ok: false` signifie que la salutation était enchâssée dans la phrase : la
 * retirer réécrirait le propos, ce que ce fichier ne fait pas.
 */
export function vetGreetings(text: string): { ok: true; text: string } | { ok: false; why: string } {
  const cleaned = stripLeadingBannedGreeting(text);
  if (containsBannedGreeting(cleaned)) {
    return { ok: false, why: 'salutation bannie (fofo / sannu) au milieu du texte' };
  }
  return { ok: true, text: cleaned };
}

/**
 * Les comptes d'animation publient-ils des images ?
 *
 * Éteint par défaut, sur demande du propriétaire : une illustration générée se
 * reconnaît, et vingt-cinq comptes qui illustrent tous leurs messages se
 * reconnaissent encore mieux. La variable d'environnement rallume le chemin
 * complet (génération + attache) sans redéploiement de code.
 */
export function illustrationsEnabled(): boolean {
  return process.env.ANIMATION_ILLUSTRATIONS === '1';
}
