/**
 * Universal country lookup — turns any ISO-3166-1 alpha-2 code into a display
 * name + flag emoji, for ALL 246 countries (not just the 16 diaspora ones).
 *
 * Why this exists: the city autocomplete (GET /geo/cities) returns worldwide
 * cities tagged with any country code, but the app previously only knew 16
 * countries (`Flags` / `CountryNames` in theme.ts). A city in, say, Japan then
 * rendered as "📍 …— JP" instead of "🇯🇵 …— Japan", and the free-text country
 * picker only offered those 16 flags — so a user living outside the diaspora
 * shortlist could not set their real country.
 *
 * Source of truth: constants/countries.json (id + alpha-2 `sortname` + English
 * `name`). The 16 curated French names/flags in theme.ts still take priority so
 * the diaspora countries keep their localized spelling ("Allemagne", not
 * "Germany").
 */

import countriesData from './countries.json';
import { COUNTRY_NAMES_FR } from './country-names-fr';
import { CountryNames as FrenchNames, Flags as FrenchFlags } from './theme';

interface RawCountry {
  id: number;
  sortname: string; // ISO-3166-1 alpha-2
  name: string; // English name (UPPER CASE in the dataset, e.g. "JAPAN")
  phoneCode: number;
}

export interface Country {
  /** ISO-3166-1 alpha-2, upper-case. */
  code: string;
  /** Display name (French for the curated 16, else title-cased English). */
  name: string;
  /** Flag emoji. */
  flag: string;
}

/** Title-case the dataset's UPPER-CASE names ("UNITED STATES" → "United States"). */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s('-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Build a flag emoji from a 2-letter code using Unicode regional indicators.
 * Works for every valid alpha-2 code without a hand-maintained table.
 * (iOS renders these as flags; Android may show the letter pair — same
 * behaviour as the pre-existing `Flags` map, so visually consistent.)
 */
function flagFromCode(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '📍';
  const A = 0x1f1e6; // regional indicator 'A'
  const up = code.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

/** Strip accents + lowercase so search ignores diacritics and case. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Index every country once at module load. Curated French names/flags win over
// the dataset so the diaspora shortlist keeps its localized spelling.
const BY_CODE = new Map<string, Country>();
for (const raw of (countriesData as { countries: RawCountry[] }).countries) {
  const code = raw.sortname?.toUpperCase();
  if (!code || code.length !== 2) continue;
  BY_CODE.set(code, {
    code,
    // Name priority: curated short French (theme.ts, the 16 diaspora countries)
    // → full French map (Intl-generated) → title-cased English dataset fallback.
    name: FrenchNames[code] ?? COUNTRY_NAMES_FR[code] ?? titleCase(raw.name),
    flag: FrenchFlags[code] ?? flagFromCode(code),
  });
}

/** Display name for a country code, falling back to the raw code if unknown. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  return BY_CODE.get(code.toUpperCase())?.name ?? code;
}

/** Flag emoji for a country code, falling back to 📍 if unknown. */
export function countryFlag(code: string | null | undefined): string {
  if (!code) return '📍';
  const up = code.toUpperCase();
  return BY_CODE.get(up)?.flag ?? flagFromCode(up);
}

/** All countries, sorted alphabetically by display name (diaspora 16 first). */
export const ALL_COUNTRIES: Country[] = (() => {
  const priority = Object.keys(FrenchFlags);
  const prioritySet = new Set(priority);
  const rest = Array.from(BY_CODE.values())
    .filter((c) => !prioritySet.has(c.code))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const top = priority
    .map((code) => BY_CODE.get(code))
    .filter((c): c is Country => !!c);
  return [...top, ...rest];
})();

/**
 * Search countries by name (accent/case-insensitive). Prefix matches rank above
 * substring matches; the diaspora shortlist keeps its leading position within
 * each rank. Returns up to `limit` hits.
 */
export function searchCountries(query: string, limit = 30): Country[] {
  const q = normalize(query);
  if (!q) return ALL_COUNTRIES.slice(0, limit);
  const prefix: Country[] = [];
  const contains: Country[] = [];
  for (const country of ALL_COUNTRIES) {
    const name = normalize(country.name);
    if (name.startsWith(q)) prefix.push(country);
    else if (name.includes(q) || normalize(country.code) === q) contains.push(country);
  }
  return [...prefix, ...contains].slice(0, limit);
}
