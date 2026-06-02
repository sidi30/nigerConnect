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
  'NE:dosso': { lat: 13.049, lon: 3.1937 },
  'NE:diffa': { lat: 13.3154, lon: 12.6113 },
  'NE:tillabéri': { lat: 14.2119, lon: 1.4531 },
  'NE:tillaberi': { lat: 14.2119, lon: 1.4531 },
  'NE:arlit': { lat: 18.7369, lon: 7.3853 },

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
  'FR:rennes': { lat: 48.1173, lon: -1.6778 },
  'FR:reims': { lat: 49.2583, lon: 4.0317 },
  'FR:grenoble': { lat: 45.1885, lon: 5.7245 },
  'FR:dijon': { lat: 47.322, lon: 5.0415 },
  'FR:angers': { lat: 47.4784, lon: -0.5632 },
  'FR:tours': { lat: 47.3941, lon: 0.6848 },
  'FR:rouen': { lat: 49.4432, lon: 1.0993 },
  'FR:orléans': { lat: 47.9029, lon: 1.909 },
  'FR:orleans': { lat: 47.9029, lon: 1.909 },
  'FR:metz': { lat: 49.1193, lon: 6.1757 },
  'FR:nancy': { lat: 48.6921, lon: 6.1844 },
  'FR:le havre': { lat: 49.4944, lon: 0.1079 },

  // Belgique
  'BE:bruxelles': { lat: 50.8503, lon: 4.3517 },
  'BE:anvers': { lat: 51.2194, lon: 4.4025 },
  'BE:liège': { lat: 50.6326, lon: 5.5797 },
  'BE:gand': { lat: 51.0543, lon: 3.7174 },
  'BE:charleroi': { lat: 50.4108, lon: 4.4446 },
  'BE:namur': { lat: 50.4674, lon: 4.8718 },
  'BE:bruges': { lat: 51.2093, lon: 3.2247 },

  // Canada
  'CA:montréal': { lat: 45.5017, lon: -73.5673 },
  'CA:montreal': { lat: 45.5017, lon: -73.5673 },
  'CA:toronto': { lat: 43.6532, lon: -79.3832 },
  'CA:ottawa': { lat: 45.4215, lon: -75.6993 },
  'CA:québec': { lat: 46.8139, lon: -71.208 },
  'CA:quebec': { lat: 46.8139, lon: -71.208 },
  'CA:vancouver': { lat: 49.2827, lon: -123.1207 },
  'CA:calgary': { lat: 51.0447, lon: -114.0719 },
  'CA:edmonton': { lat: 53.5461, lon: -113.4938 },
  'CA:winnipeg': { lat: 49.8951, lon: -97.1384 },
  'CA:gatineau': { lat: 45.4765, lon: -75.7013 },
  'CA:laval': { lat: 45.6066, lon: -73.7124 },
  'CA:halifax': { lat: 44.6488, lon: -63.5752 },

  // USA
  'US:new york': { lat: 40.7128, lon: -74.006 },
  'US:washington': { lat: 38.9072, lon: -77.0369 },
  'US:boston': { lat: 42.3601, lon: -71.0589 },
  'US:atlanta': { lat: 33.749, lon: -84.388 },
  'US:houston': { lat: 29.7604, lon: -95.3698 },
  'US:chicago': { lat: 41.8781, lon: -87.6298 },
  'US:los angeles': { lat: 34.0522, lon: -118.2437 },
  'US:philadelphie': { lat: 39.9526, lon: -75.1652 },
  'US:dallas': { lat: 32.7767, lon: -96.797 },
  'US:austin': { lat: 30.2672, lon: -97.7431 },
  'US:san diego': { lat: 32.7157, lon: -117.1611 },
  'US:phoenix': { lat: 33.4484, lon: -112.074 },
  'US:miami': { lat: 25.7617, lon: -80.1918 },
  'US:seattle': { lat: 47.6062, lon: -122.3321 },
  'US:san francisco': { lat: 37.7749, lon: -122.4194 },
  'US:denver': { lat: 39.7392, lon: -104.9903 },
  'US:minneapolis': { lat: 44.9778, lon: -93.265 },
  'US:detroit': { lat: 42.3314, lon: -83.0458 },
  'US:newark': { lat: 40.7357, lon: -74.1724 },

  // UK
  'GB:londres': { lat: 51.5074, lon: -0.1278 },
  'GB:london': { lat: 51.5074, lon: -0.1278 },
  'GB:manchester': { lat: 53.4808, lon: -2.2426 },
  'GB:birmingham': { lat: 52.4862, lon: -1.8904 },
  'GB:glasgow': { lat: 55.8642, lon: -4.2518 },
  'GB:liverpool': { lat: 53.4084, lon: -2.9916 },
  'GB:leeds': { lat: 53.8008, lon: -1.5491 },
  'GB:édimbourg': { lat: 55.9533, lon: -3.1883 },
  'GB:edimbourg': { lat: 55.9533, lon: -3.1883 },
  'GB:bristol': { lat: 51.4545, lon: -2.5879 },

  // Allemagne
  'DE:berlin': { lat: 52.52, lon: 13.405 },
  'DE:hambourg': { lat: 53.5511, lon: 9.9937 },
  'DE:munich': { lat: 48.1351, lon: 11.582 },
  'DE:cologne': { lat: 50.9375, lon: 6.9603 },
  'DE:francfort': { lat: 50.1109, lon: 8.6821 },
  'DE:stuttgart': { lat: 48.7758, lon: 9.1829 },
  'DE:düsseldorf': { lat: 51.2277, lon: 6.7735 },
  'DE:dusseldorf': { lat: 51.2277, lon: 6.7735 },
  'DE:dortmund': { lat: 51.5136, lon: 7.4653 },
  'DE:leipzig': { lat: 51.3397, lon: 12.3731 },

  // Maroc
  'MA:casablanca': { lat: 33.5731, lon: -7.5898 },
  'MA:rabat': { lat: 34.0209, lon: -6.8416 },
  'MA:marrakech': { lat: 31.6295, lon: -7.9811 },
  'MA:fès': { lat: 34.0181, lon: -5.0078 },
  'MA:fes': { lat: 34.0181, lon: -5.0078 },
  'MA:tanger': { lat: 35.7595, lon: -5.834 },
  'MA:agadir': { lat: 30.4278, lon: -9.5981 },
  'MA:meknès': { lat: 33.8731, lon: -5.5407 },
  'MA:meknes': { lat: 33.8731, lon: -5.5407 },
  'MA:oujda': { lat: 34.6814, lon: -1.9086 },
  'MA:kénitra': { lat: 34.261, lon: -6.5802 },
  'MA:kenitra': { lat: 34.261, lon: -6.5802 },

  // Turquie
  'TR:istanbul': { lat: 41.0082, lon: 28.9784 },
  'TR:ankara': { lat: 39.9334, lon: 32.8597 },
  'TR:izmir': { lat: 38.4237, lon: 27.1428 },
  'TR:bursa': { lat: 40.1885, lon: 29.061 },
  'TR:antalya': { lat: 36.8969, lon: 30.7133 },
  'TR:adana': { lat: 37.0, lon: 35.3213 },
  'TR:gaziantep': { lat: 37.0662, lon: 37.3833 },

  // Afrique de l'Ouest
  'SN:dakar': { lat: 14.7167, lon: -17.4677 },
  'SN:thiès': { lat: 14.7886, lon: -16.9246 },
  'SN:thies': { lat: 14.7886, lon: -16.9246 },
  'SN:touba': { lat: 14.85, lon: -15.8833 },
  'SN:saint-louis': { lat: 16.0179, lon: -16.4896 },
  'SN:kaolack': { lat: 14.182, lon: -16.2533 },
  'SN:ziguinchor': { lat: 12.5681, lon: -16.2719 },
  'CI:abidjan': { lat: 5.3599, lon: -4.0083 },
  'CI:yamoussoukro': { lat: 6.8276, lon: -5.2893 },
  'CI:bouaké': { lat: 7.6906, lon: -5.0303 },
  'CI:bouake': { lat: 7.6906, lon: -5.0303 },
  'CI:daloa': { lat: 6.8775, lon: -6.4503 },
  'CI:san-pédro': { lat: 4.7485, lon: -6.6363 },
  'CI:san-pedro': { lat: 4.7485, lon: -6.6363 },
  'CI:korhogo': { lat: 9.4578, lon: -5.6294 },
  'BJ:cotonou': { lat: 6.3703, lon: 2.3912 },
  'BJ:porto-novo': { lat: 6.4969, lon: 2.6289 },
  'BJ:parakou': { lat: 9.337, lon: 2.6303 },
  'BJ:djougou': { lat: 9.708, lon: 1.666 },
  'BJ:bohicon': { lat: 7.1782, lon: 2.0667 },
  'BJ:abomey': { lat: 7.1826, lon: 1.9912 },
  'TG:lomé': { lat: 6.1319, lon: 1.2228 },
  'TG:lome': { lat: 6.1319, lon: 1.2228 },
  'TG:sokodé': { lat: 8.9833, lon: 1.1333 },
  'TG:sokode': { lat: 8.9833, lon: 1.1333 },
  'TG:kara': { lat: 9.5511, lon: 1.1861 },
  'TG:kpalimé': { lat: 6.9, lon: 0.6333 },
  'TG:kpalime': { lat: 6.9, lon: 0.6333 },
  'TG:atakpamé': { lat: 7.5333, lon: 1.1167 },
  'TG:atakpame': { lat: 7.5333, lon: 1.1167 },

  // Moyen-Orient
  'AE:dubaï': { lat: 25.2048, lon: 55.2708 },
  'AE:dubai': { lat: 25.2048, lon: 55.2708 },
  'AE:abou dabi': { lat: 24.4539, lon: 54.3773 },
  'AE:charjah': { lat: 25.3463, lon: 55.4209 },
  'AE:al ain': { lat: 24.1302, lon: 55.8023 },
  'AE:ajman': { lat: 25.4052, lon: 55.5136 },
  'SA:djeddah': { lat: 21.4858, lon: 39.1925 },
  'SA:riyad': { lat: 24.7136, lon: 46.6753 },
  'SA:la mecque': { lat: 21.3891, lon: 39.8579 },
  'SA:médine': { lat: 24.5247, lon: 39.5692 },
  'SA:medine': { lat: 24.5247, lon: 39.5692 },
  'SA:dammam': { lat: 26.4207, lon: 50.0888 },

  // Chine
  'CN:pékin': { lat: 39.9042, lon: 116.4074 },
  'CN:beijing': { lat: 39.9042, lon: 116.4074 },
  'CN:guangzhou': { lat: 23.1291, lon: 113.2644 },
  'CN:shanghai': { lat: 31.2304, lon: 121.4737 },
  'CN:shenzhen': { lat: 22.5431, lon: 114.0579 },
  'CN:chengdu': { lat: 30.5728, lon: 104.0668 },
  'CN:hangzhou': { lat: 30.2741, lon: 120.1551 },
  'CN:wuhan': { lat: 30.5928, lon: 114.3055 },
  'CN:yiwu': { lat: 29.3068, lon: 120.0759 },
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
