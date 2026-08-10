// Noms de pays en français, sans dépendance : Intl.DisplayNames est natif au
// navigateur (et à Node, donc le rendu serveur des composants client passe).
//
// L'instance est construite UNE fois au chargement du module : la construction
// d'un Intl.DisplayNames est coûteuse, et la carte en appelle `of()` une fois
// par membre et par entrée de facette.

const REGION_NAMES: Intl.DisplayNames | null = (() => {
  try {
    // fallback 'code' : un code valide mais sans traduction ressort tel quel
    // plutôt que de lever.
    return new Intl.DisplayNames(["fr"], { type: "region", fallback: "code" });
  } catch {
    // Runtime sans données ICU : on affichera les codes bruts.
    return null;
  }
})();

/**
 * « NE » → « Niger ». Repli sur le code brut pour tout ce qui n'est pas un
 * code région exploitable (`of()` lève un RangeError sur une entrée mal formée,
 * et peut renvoyer undefined selon les moteurs).
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return "Pays inconnu";
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return cc;
  try {
    return REGION_NAMES?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/**
 * « NE » → 🇳🇪. Les drapeaux Unicode sont deux « indicateurs régionaux », soit
 * la lettre décalée de 'A' vers U+1F1E6 — aucune image ni dépendance à charger.
 * Renvoie une chaîne vide sur un code inexploitable, pour que l'appelant puisse
 * simplement ne rien afficher.
 */
export function countryFlag(code: string | null | undefined): string {
  if (!code) return "";
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)),
  );
}

/** « Niamey, NE » → « Niamey, Niger ». */
export function placeLabel(
  city: string | null,
  countryCode: string | null,
): string {
  const country = countryCode ? countryName(countryCode) : null;
  return [city, country].filter(Boolean).join(", ");
}

/** Tri alphabétique sur le nom TRADUIT, pas sur le code ISO. */
export function compareByCountryName(a: string, b: string): number {
  return countryName(a).localeCompare(countryName(b), "fr");
}
