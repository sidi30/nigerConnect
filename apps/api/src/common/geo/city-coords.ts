// Coordonnées approximatives des principales villes de la diaspora nigérienne.
// En production, cette table est remplacée par un vrai service de geocoding
// (Nominatim / Mapbox / Google). Pour l'instant on fait un lookup direct — suffisant
// pour un enregistrement rapide sans appel externe au moment du /register.

interface CityCoord {
  lat: number;
  lon: number;
}

const CITY_COORDS: Record<string, CityCoord> = {
  // Niger
  'NE:niamey': { lat: 13.5116, lon: 2.1254 },
  'NE:zinder': { lat: 13.8053, lon: 8.9881 },
  'NE:maradi': { lat: 13.4939, lon: 7.1011 },
  'NE:tahoua': { lat: 14.889, lon: 5.268 },
  'NE:agadez': { lat: 16.974, lon: 7.989 },

  // France
  'FR:paris': { lat: 48.8566, lon: 2.3522 },
  'FR:lyon': { lat: 45.764, lon: 4.8357 },
  'FR:marseille': { lat: 43.2965, lon: 5.3698 },
  'FR:toulouse': { lat: 43.6045, lon: 1.4442 },
  'FR:bordeaux': { lat: 44.8378, lon: -0.5792 },
  'FR:lille': { lat: 50.6292, lon: 3.0573 },
  'FR:nice': { lat: 43.7102, lon: 7.262 },
  'FR:nantes': { lat: 47.2184, lon: -1.5536 },
  'FR:strasbourg': { lat: 48.5734, lon: 7.7521 },
  'FR:montpellier': { lat: 43.6108, lon: 3.8767 },

  // Belgique
  'BE:bruxelles': { lat: 50.8503, lon: 4.3517 },
  'BE:anvers': { lat: 51.2194, lon: 4.4025 },
  'BE:liège': { lat: 50.6326, lon: 5.5797 },

  // Canada
  'CA:montréal': { lat: 45.5017, lon: -73.5673 },
  'CA:montreal': { lat: 45.5017, lon: -73.5673 },
  'CA:toronto': { lat: 43.6532, lon: -79.3832 },
  'CA:ottawa': { lat: 45.4215, lon: -75.6993 },
  'CA:québec': { lat: 46.8139, lon: -71.208 },
  'CA:quebec': { lat: 46.8139, lon: -71.208 },

  // USA
  'US:new york': { lat: 40.7128, lon: -74.006 },
  'US:washington': { lat: 38.9072, lon: -77.0369 },
  'US:boston': { lat: 42.3601, lon: -71.0589 },
  'US:atlanta': { lat: 33.749, lon: -84.388 },
  'US:houston': { lat: 29.7604, lon: -95.3698 },
  'US:chicago': { lat: 41.8781, lon: -87.6298 },
  'US:los angeles': { lat: 34.0522, lon: -118.2437 },

  // UK
  'GB:londres': { lat: 51.5074, lon: -0.1278 },
  'GB:london': { lat: 51.5074, lon: -0.1278 },
  'GB:manchester': { lat: 53.4808, lon: -2.2426 },

  // Allemagne
  'DE:berlin': { lat: 52.52, lon: 13.405 },
  'DE:hambourg': { lat: 53.5511, lon: 9.9937 },
  'DE:munich': { lat: 48.1351, lon: 11.582 },

  // Maroc
  'MA:casablanca': { lat: 33.5731, lon: -7.5898 },
  'MA:rabat': { lat: 34.0209, lon: -6.8416 },
  'MA:marrakech': { lat: 31.6295, lon: -7.9811 },

  // Turquie
  'TR:istanbul': { lat: 41.0082, lon: 28.9784 },
  'TR:ankara': { lat: 39.9334, lon: 32.8597 },

  // Afrique de l'Ouest
  'SN:dakar': { lat: 14.7167, lon: -17.4677 },
  'CI:abidjan': { lat: 5.3599, lon: -4.0083 },
  'BJ:cotonou': { lat: 6.3703, lon: 2.3912 },
  'TG:lomé': { lat: 6.1319, lon: 1.2228 },
  'TG:lome': { lat: 6.1319, lon: 1.2228 },

  // Moyen-Orient
  'AE:dubaï': { lat: 25.2048, lon: 55.2708 },
  'AE:dubai': { lat: 25.2048, lon: 55.2708 },
  'SA:djeddah': { lat: 21.4858, lon: 39.1925 },
  'SA:riyad': { lat: 24.7136, lon: 46.6753 },

  // Chine
  'CN:pékin': { lat: 39.9042, lon: 116.4074 },
  'CN:beijing': { lat: 39.9042, lon: 116.4074 },
  'CN:guangzhou': { lat: 23.1291, lon: 113.2644 },
  'CN:shanghai': { lat: 31.2304, lon: 121.4737 },
};

// Fallback au centre géographique du pays si la ville n'est pas connue
const COUNTRY_CENTERS: Record<string, CityCoord> = {
  NE: { lat: 17.607789, lon: 8.081666 },
  FR: { lat: 46.603354, lon: 1.888334 },
  CA: { lat: 56.130366, lon: -106.346771 },
  US: { lat: 39.8283, lon: -98.5795 },
  GB: { lat: 55.3781, lon: -3.436 },
  DE: { lat: 51.1657, lon: 10.4515 },
  BE: { lat: 50.5039, lon: 4.4699 },
  MA: { lat: 31.7917, lon: -7.0926 },
  TR: { lat: 38.9637, lon: 35.2433 },
  SN: { lat: 14.4974, lon: -14.4524 },
  CI: { lat: 7.54, lon: -5.5471 },
  BJ: { lat: 9.3077, lon: 2.3158 },
  TG: { lat: 8.6195, lon: 0.8248 },
  AE: { lat: 23.4241, lon: 53.8478 },
  SA: { lat: 23.8859, lon: 45.0792 },
  CN: { lat: 35.8617, lon: 104.1954 },
};

export function geocode(
  city: string | null | undefined,
  countryCode: string | null | undefined,
): CityCoord | null {
  if (!countryCode) return null;
  const cc = countryCode.toUpperCase();
  if (city) {
    const key = `${cc}:${city.toLowerCase().trim()}`;
    const hit = CITY_COORDS[key];
    if (hit) {
      // Add tiny jitter so users in the same city don't stack on top of each other
      return {
        lat: hit.lat + (Math.random() - 0.5) * 0.04,
        lon: hit.lon + (Math.random() - 0.5) * 0.04,
      };
    }
  }
  const country = COUNTRY_CENTERS[cc];
  if (country) return { lat: country.lat + (Math.random() - 0.5) * 0.5, lon: country.lon + (Math.random() - 0.5) * 0.5 };
  return null;
}
