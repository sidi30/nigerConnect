/**
 * Embedded city list for the registration / edit-profile autocomplete.
 *
 * `country` is the ISO-3166-1 alpha-2 code and must be one of the 16 diaspora
 * countries declared in `Flags` (constants/theme.ts). `name` is the display
 * spelling (correct case + accents) — the API stores it verbatim as a free
 * string, so the server geocoder (apps/api/src/common/geo/city-coords.ts)
 * lowercases + strips to match.
 *
 * Matching is accent- and case-insensitive (see `searchCities`), so users can
 * type "niamey", "Niamey" or "niàmey" and still find the entry.
 */

export interface City {
  name: string;
  country: string;
}

export const CITIES: City[] = [
  // ── Niger (NE) ───────────────────────────────────────────
  { name: 'Niamey', country: 'NE' },
  { name: 'Zinder', country: 'NE' },
  { name: 'Maradi', country: 'NE' },
  { name: 'Agadez', country: 'NE' },
  { name: 'Tahoua', country: 'NE' },
  { name: 'Dosso', country: 'NE' },
  { name: 'Diffa', country: 'NE' },
  { name: 'Tillabéri', country: 'NE' },
  { name: 'Arlit', country: 'NE' },
  { name: 'Birni-N’Konni', country: 'NE' },
  { name: 'Gaya', country: 'NE' },
  { name: 'Tessaoua', country: 'NE' },

  // ── France (FR) ──────────────────────────────────────────
  { name: 'Paris', country: 'FR' },
  { name: 'Marseille', country: 'FR' },
  { name: 'Lyon', country: 'FR' },
  { name: 'Toulouse', country: 'FR' },
  { name: 'Nice', country: 'FR' },
  { name: 'Nantes', country: 'FR' },
  { name: 'Montpellier', country: 'FR' },
  { name: 'Strasbourg', country: 'FR' },
  { name: 'Bordeaux', country: 'FR' },
  { name: 'Lille', country: 'FR' },
  { name: 'Rennes', country: 'FR' },
  { name: 'Reims', country: 'FR' },
  { name: 'Saint-Étienne', country: 'FR' },
  { name: 'Le Havre', country: 'FR' },
  { name: 'Toulon', country: 'FR' },
  { name: 'Grenoble', country: 'FR' },
  { name: 'Dijon', country: 'FR' },
  { name: 'Angers', country: 'FR' },
  { name: 'Nîmes', country: 'FR' },
  { name: 'Villeurbanne', country: 'FR' },
  { name: 'Clermont-Ferrand', country: 'FR' },
  { name: 'Le Mans', country: 'FR' },
  { name: 'Aix-en-Provence', country: 'FR' },
  { name: 'Brest', country: 'FR' },
  { name: 'Tours', country: 'FR' },
  { name: 'Amiens', country: 'FR' },
  { name: 'Limoges', country: 'FR' },
  { name: 'Annecy', country: 'FR' },
  { name: 'Metz', country: 'FR' },
  { name: 'Besançon', country: 'FR' },
  { name: 'Orléans', country: 'FR' },
  { name: 'Rouen', country: 'FR' },
  { name: 'Mulhouse', country: 'FR' },
  { name: 'Caen', country: 'FR' },
  { name: 'Nancy', country: 'FR' },
  { name: 'Argenteuil', country: 'FR' },
  { name: 'Montreuil', country: 'FR' },
  { name: 'Roubaix', country: 'FR' },
  { name: 'Tourcoing', country: 'FR' },
  { name: 'Nanterre', country: 'FR' },
  { name: 'Créteil', country: 'FR' },
  { name: 'Versailles', country: 'FR' },
  { name: 'Pau', country: 'FR' },
  { name: 'La Rochelle', country: 'FR' },
  { name: 'Perpignan', country: 'FR' },
  { name: 'Cergy', country: 'FR' },
  { name: 'Saint-Denis', country: 'FR' },

  // ── Belgique (BE) ────────────────────────────────────────
  { name: 'Bruxelles', country: 'BE' },
  { name: 'Anvers', country: 'BE' },
  { name: 'Gand', country: 'BE' },
  { name: 'Charleroi', country: 'BE' },
  { name: 'Liège', country: 'BE' },
  { name: 'Bruges', country: 'BE' },
  { name: 'Namur', country: 'BE' },
  { name: 'Louvain', country: 'BE' },
  { name: 'Mons', country: 'BE' },
  { name: 'Malines', country: 'BE' },
  { name: 'Tournai', country: 'BE' },
  { name: 'Ostende', country: 'BE' },

  // ── Canada (CA) ──────────────────────────────────────────
  { name: 'Montréal', country: 'CA' },
  { name: 'Toronto', country: 'CA' },
  { name: 'Ottawa', country: 'CA' },
  { name: 'Québec', country: 'CA' },
  { name: 'Vancouver', country: 'CA' },
  { name: 'Calgary', country: 'CA' },
  { name: 'Edmonton', country: 'CA' },
  { name: 'Winnipeg', country: 'CA' },
  { name: 'Hamilton', country: 'CA' },
  { name: 'Gatineau', country: 'CA' },
  { name: 'Laval', country: 'CA' },
  { name: 'Halifax', country: 'CA' },
  { name: 'Sherbrooke', country: 'CA' },
  { name: 'Trois-Rivières', country: 'CA' },

  // ── États-Unis (US) ──────────────────────────────────────
  { name: 'New York', country: 'US' },
  { name: 'Los Angeles', country: 'US' },
  { name: 'Chicago', country: 'US' },
  { name: 'Houston', country: 'US' },
  { name: 'Phoenix', country: 'US' },
  { name: 'Philadelphie', country: 'US' },
  { name: 'San Antonio', country: 'US' },
  { name: 'San Diego', country: 'US' },
  { name: 'Dallas', country: 'US' },
  { name: 'Austin', country: 'US' },
  { name: 'San Jose', country: 'US' },
  { name: 'Washington', country: 'US' },
  { name: 'Boston', country: 'US' },
  { name: 'Atlanta', country: 'US' },
  { name: 'Miami', country: 'US' },
  { name: 'Seattle', country: 'US' },
  { name: 'Denver', country: 'US' },
  { name: 'Minneapolis', country: 'US' },
  { name: 'Detroit', country: 'US' },
  { name: 'Columbus', country: 'US' },
  { name: 'San Francisco', country: 'US' },
  { name: 'Charlotte', country: 'US' },
  { name: 'Indianapolis', country: 'US' },
  { name: 'Newark', country: 'US' },
  { name: 'Memphis', country: 'US' },

  // ── Royaume-Uni (GB) ─────────────────────────────────────
  { name: 'Londres', country: 'GB' },
  { name: 'Birmingham', country: 'GB' },
  { name: 'Manchester', country: 'GB' },
  { name: 'Glasgow', country: 'GB' },
  { name: 'Liverpool', country: 'GB' },
  { name: 'Leeds', country: 'GB' },
  { name: 'Édimbourg', country: 'GB' },
  { name: 'Bristol', country: 'GB' },
  { name: 'Sheffield', country: 'GB' },
  { name: 'Cardiff', country: 'GB' },
  { name: 'Newcastle', country: 'GB' },
  { name: 'Nottingham', country: 'GB' },
  { name: 'Leicester', country: 'GB' },
  { name: 'Coventry', country: 'GB' },

  // ── Allemagne (DE) ───────────────────────────────────────
  { name: 'Berlin', country: 'DE' },
  { name: 'Hambourg', country: 'DE' },
  { name: 'Munich', country: 'DE' },
  { name: 'Cologne', country: 'DE' },
  { name: 'Francfort', country: 'DE' },
  { name: 'Stuttgart', country: 'DE' },
  { name: 'Düsseldorf', country: 'DE' },
  { name: 'Dortmund', country: 'DE' },
  { name: 'Essen', country: 'DE' },
  { name: 'Leipzig', country: 'DE' },
  { name: 'Brême', country: 'DE' },
  { name: 'Dresde', country: 'DE' },
  { name: 'Hanovre', country: 'DE' },
  { name: 'Nuremberg', country: 'DE' },

  // ── Maroc (MA) ───────────────────────────────────────────
  { name: 'Casablanca', country: 'MA' },
  { name: 'Rabat', country: 'MA' },
  { name: 'Fès', country: 'MA' },
  { name: 'Marrakech', country: 'MA' },
  { name: 'Tanger', country: 'MA' },
  { name: 'Agadir', country: 'MA' },
  { name: 'Meknès', country: 'MA' },
  { name: 'Oujda', country: 'MA' },
  { name: 'Kénitra', country: 'MA' },
  { name: 'Tétouan', country: 'MA' },
  { name: 'Salé', country: 'MA' },

  // ── Turquie (TR) ─────────────────────────────────────────
  { name: 'Istanbul', country: 'TR' },
  { name: 'Ankara', country: 'TR' },
  { name: 'Izmir', country: 'TR' },
  { name: 'Bursa', country: 'TR' },
  { name: 'Antalya', country: 'TR' },
  { name: 'Adana', country: 'TR' },
  { name: 'Konya', country: 'TR' },
  { name: 'Gaziantep', country: 'TR' },

  // ── Sénégal (SN) ─────────────────────────────────────────
  { name: 'Dakar', country: 'SN' },
  { name: 'Thiès', country: 'SN' },
  { name: 'Touba', country: 'SN' },
  { name: 'Saint-Louis', country: 'SN' },
  { name: 'Rufisque', country: 'SN' },
  { name: 'Kaolack', country: 'SN' },
  { name: 'Ziguinchor', country: 'SN' },
  { name: 'Mbour', country: 'SN' },

  // ── Côte d'Ivoire (CI) ───────────────────────────────────
  { name: 'Abidjan', country: 'CI' },
  { name: 'Yamoussoukro', country: 'CI' },
  { name: 'Bouaké', country: 'CI' },
  { name: 'Daloa', country: 'CI' },
  { name: 'San-Pédro', country: 'CI' },
  { name: 'Korhogo', country: 'CI' },
  { name: 'Man', country: 'CI' },

  // ── Bénin (BJ) ───────────────────────────────────────────
  { name: 'Cotonou', country: 'BJ' },
  { name: 'Porto-Novo', country: 'BJ' },
  { name: 'Parakou', country: 'BJ' },
  { name: 'Djougou', country: 'BJ' },
  { name: 'Bohicon', country: 'BJ' },
  { name: 'Abomey', country: 'BJ' },
  { name: 'Natitingou', country: 'BJ' },

  // ── Togo (TG) ────────────────────────────────────────────
  { name: 'Lomé', country: 'TG' },
  { name: 'Sokodé', country: 'TG' },
  { name: 'Kara', country: 'TG' },
  { name: 'Kpalimé', country: 'TG' },
  { name: 'Atakpamé', country: 'TG' },
  { name: 'Dapaong', country: 'TG' },

  // ── Émirats (AE) ─────────────────────────────────────────
  { name: 'Dubaï', country: 'AE' },
  { name: 'Abou Dabi', country: 'AE' },
  { name: 'Charjah', country: 'AE' },
  { name: 'Al Ain', country: 'AE' },
  { name: 'Ajman', country: 'AE' },
  { name: 'Ras el Khaïmah', country: 'AE' },

  // ── Arabie Saoudite (SA) ─────────────────────────────────
  { name: 'Riyad', country: 'SA' },
  { name: 'Djeddah', country: 'SA' },
  { name: 'La Mecque', country: 'SA' },
  { name: 'Médine', country: 'SA' },
  { name: 'Dammam', country: 'SA' },
  { name: 'Taïf', country: 'SA' },

  // ── Chine (CN) ───────────────────────────────────────────
  { name: 'Pékin', country: 'CN' },
  { name: 'Shanghai', country: 'CN' },
  { name: 'Guangzhou', country: 'CN' },
  { name: 'Shenzhen', country: 'CN' },
  { name: 'Chengdu', country: 'CN' },
  { name: 'Hangzhou', country: 'CN' },
  { name: 'Wuhan', country: 'CN' },
  { name: 'Yiwu', country: 'CN' },
];

/** Strip accents + lowercase so search ignores diacritics and case. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * French exonyms for major world cities — the worldwide autocomplete dataset
 * (`all-the-cities`) returns local/English spellings ("London", "Beijing"), but
 * the app is in French. We override ONLY well-known big cities whose French name
 * differs; every other city keeps its dataset spelling.
 *
 * Keyed by ISO-3166-1 alpha-2 country code → { normalizedEnglishName: French }.
 * Scoping by country avoids collisions (e.g. "Florence" the Italian city vs the
 * US one). Lookup keys are accent-stripped + lowercased (see `normalize`).
 */
const FRENCH_EXONYMS: Record<string, Record<string, string>> = {
  GB: { london: 'Londres', edinburgh: 'Édimbourg' },
  IE: { dublin: 'Dublin' },
  BE: { brussels: 'Bruxelles', antwerp: 'Anvers', ghent: 'Gand', bruges: 'Bruges' },
  NL: { 'the hague': 'La Haye' },
  DE: {
    munich: 'Munich',
    cologne: 'Cologne',
    'köln': 'Cologne',
    koln: 'Cologne',
    frankfurt: 'Francfort',
    hamburg: 'Hambourg',
    nuremberg: 'Nuremberg',
    'nürnberg': 'Nuremberg',
    nurnberg: 'Nuremberg',
    bremen: 'Brême',
    dresden: 'Dresde',
    hanover: 'Hanovre',
    hannover: 'Hanovre',
    aachen: 'Aix-la-Chapelle',
  },
  IT: {
    rome: 'Rome',
    milan: 'Milan',
    venice: 'Venise',
    florence: 'Florence',
    naples: 'Naples',
    turin: 'Turin',
    genoa: 'Gênes',
    padua: 'Padoue',
  },
  ES: { seville: 'Séville', cordoba: 'Cordoue', 'córdoba': 'Cordoue' },
  PT: { lisbon: 'Lisbonne' },
  CH: { geneva: 'Genève', zurich: 'Zurich', 'zürich': 'Zurich', basel: 'Bâle' },
  AT: { vienna: 'Vienne' },
  GR: { athens: 'Athènes', thessaloniki: 'Thessalonique' },
  PL: { warsaw: 'Varsovie', krakow: 'Cracovie', 'kraków': 'Cracovie' },
  CZ: { prague: 'Prague' },
  RO: { bucharest: 'Bucarest' },
  RU: { moscow: 'Moscou', 'saint petersburg': 'Saint-Pétersbourg' },
  UA: { kyiv: 'Kiev', kiev: 'Kiev' },
  DK: { copenhagen: 'Copenhague' },
  SE: { gothenburg: 'Göteborg' },
  EG: { cairo: 'Le Caire', alexandria: 'Alexandrie' },
  DZ: { algiers: 'Alger', oran: 'Oran' },
  TN: { tunis: 'Tunis' },
  SY: { damascus: 'Damas', aleppo: 'Alep' },
  IR: { tehran: 'Téhéran' },
  IQ: { baghdad: 'Bagdad' },
  SA: { riyadh: 'Riyad', jeddah: 'Djeddah', mecca: 'La Mecque', medina: 'Médine' },
  AE: { dubai: 'Dubaï', 'abu dhabi': 'Abou Dabi', sharjah: 'Charjah' },
  CN: { beijing: 'Pékin', nanjing: 'Nankin' },
  KR: { seoul: 'Séoul' },
  SG: { singapore: 'Singapour' },
  MX: { 'mexico city': 'Mexico' },
};

/**
 * Returns the French exonym for a major city when one is known, else the name
 * unchanged. Used to localize the worldwide autocomplete suggestions.
 */
export function frenchCityName(name: string, country: string | null | undefined): string {
  if (!country) return name;
  const table = FRENCH_EXONYMS[country.toUpperCase()];
  if (!table) return name;
  return table[normalize(name)] ?? name;
}

/**
 * Search the embedded city list, accent- and case-insensitively.
 * Prefix matches rank above substring matches; within each rank the original
 * list order (roughly by population) is preserved. Returns up to `limit` hits.
 */
export function searchCities(query: string, limit = 8): City[] {
  const q = normalize(query);
  if (!q) return [];
  const prefix: City[] = [];
  const contains: City[] = [];
  for (const city of CITIES) {
    const name = normalize(city.name);
    if (name.startsWith(q)) prefix.push(city);
    else if (name.includes(q)) contains.push(city);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}
