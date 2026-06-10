/**
 * Minimal geohash encoder (no dependency).
 *
 * A geohash maps a (lat, lon) point to a short base-32 string where each added
 * character refines the cell. We use it to label the *zone* of a proximity
 * encounter so the same two people are notified once per zone, and re-notified
 * only when they meet in a different zone.
 *
 * Cell size by precision (approx, latitude-dependent):
 *   6 → ~1.2 km × 0.6 km
 *   7 → ~153 m × 153 m   ← default: matches the 50–100 m proximity radius
 *   8 → ~38 m × 19 m
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const PROXIMITY_GEOHASH_PRECISION = 7;

export function geohashEncode(
  lat: number,
  lon: number,
  precision: number = PROXIMITY_GEOHASH_PRECISION,
): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let hash = '';
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  while (hash.length < precision) {
    if (evenBit) {
      // bisect longitude
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) {
        idx = idx * 2 + 1;
        lonMin = lonMid;
      } else {
        idx = idx * 2;
        lonMax = lonMid;
      }
    } else {
      // bisect latitude
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        idx = idx * 2 + 1;
        latMin = latMid;
      } else {
        idx = idx * 2;
        latMax = latMid;
      }
    }
    evenBit = !evenBit;

    if (++bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}
