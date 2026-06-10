/**
 * WorldCitiesService — in-memory search index over the `all-the-cities` dataset
 * (~135k cities, population ≥ 1000, worldwide).
 *
 * The package ships a compressed protobuf file that is decoded on first require.
 * We build two lookup structures once at module init so all subsequent searches
 * are purely in-memory with no I/O:
 *
 *   1. `_index` — Map<normalizedName, WorldCity[]> for exact-normalised prefix
 *      matching (fast O(k) walk over the key space).
 *   2. `_all`   — the raw sorted array for substring fallback.
 *
 * Normalisation strips diacritics and lowercases so "Niamey", "niamey" and
 * "niàmey" all map to the same key.
 *
 * We sort by population descending so the highest-population city wins for
 * ambiguous names (e.g. "Springfield" → the largest US Springfield first).
 */

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';

/**
 * Shape of a city object returned by `all-the-cities`.
 * The package has no TypeScript typings so we declare the interface here.
 */
interface RawCity {
  cityId: number;
  name: string;
  altName: string;
  country: string; // ISO-3166-1 alpha-2
  featureCode: string;
  adminCode: string;
  population: number;
  loc: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
}

export interface WorldCity {
  name: string;
  countryCode: string;
  lat: number;
  lng: number;
  population: number;
}

/**
 * Internal index entry — a WorldCity plus precomputed fields used by `search()`.
 * `_norm` is the normalised name computed ONCE at init so per-request searches
 * never re-normalise ~135k names. `_idx` is the stable position in `_all`, used
 * as a cheap dedup key (a Set<number>) instead of an O(n) `indexOf` per hit.
 */
interface IndexedCity extends WorldCity {
  _norm: string;
  _idx: number;
}

/** Max results returned by a single search call. Caller can ask for fewer. */
const HARD_LIMIT = 20;

/**
 * Minimum normalised query length. A 1-char query matches a huge slice of the
 * 135k dataset and forces a near-full scan on a @Public endpoint — cheap DoS.
 * Below this we return nothing so the autocomplete only fires on real prefixes.
 */
const MIN_QUERY_LENGTH = 2;

/** Project an internal index entry to the public {name,countryCode,lat,lng,population} shape. */
function toPublic(c: IndexedCity): WorldCity {
  return {
    name: c.name,
    countryCode: c.countryCode,
    lat: c.lat,
    lng: c.lng,
    population: c.population,
  };
}

/** Strip accents + lowercase — mirrors the mobile `normalize()` helper. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

@Injectable()
export class WorldCitiesService implements OnModuleInit {
  private readonly logger = new Logger(WorldCitiesService.name);

  /** All cities sorted by population desc — used for substring fallback. */
  private _all: IndexedCity[] = [];

  /**
   * Normalised-name → city list index. Each normalised name maps to every city
   * that has that exact normalised spelling (there can be many "Springfield"s).
   * We use this map's key iteration order to do prefix matching without a trie.
   */
  private _index = new Map<string, IndexedCity[]>();

  onModuleInit(): void {
    const start = Date.now();
    try {
      // `all-the-cities` is a CommonJS CJS module with no TypeScript typings.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const raw: RawCity[] = require('all-the-cities') as RawCity[];

      // Convert to our leaner shape and sort by population descending so the
      // most prominent city wins when multiple cities share a normalised name.
      // `_norm`/`_idx` are filled in below once the final order is known.
      this._all = raw
        .map((c) => ({
          name: c.name,
          countryCode: c.country,
          lat: c.loc.coordinates[1],
          lng: c.loc.coordinates[0],
          population: c.population,
          _norm: normalize(c.name),
          _idx: 0,
        }))
        .sort((a, b) => b.population - a.population);

      // Build the normalised-name index. We assign the stable `_idx` here (after
      // sorting) and index the primary normalised name.
      for (let i = 0; i < this._all.length; i++) {
        const city = this._all[i]!;
        city._idx = i;
        this.indexKey(city._norm, city);
      }

      // Also index the altName so the geocoder free-text fallback (findOne)
      // resolves alternate spellings (e.g. "Munich" → "München"). `raw` keeps
      // its original order, so we re-resolve each altName onto the now-sorted
      // entry via its primary-name bucket (matched on country + population, which
      // uniquely identifies the row in practice).
      for (const r of raw) {
        if (!r.altName) continue;
        const altKey = normalize(r.altName);
        if (!altKey) continue;
        const entry = this._index
          .get(normalize(r.name))
          ?.find((c) => c.countryCode === r.country && c.population === r.population);
        if (!entry || altKey === entry._norm) continue;
        this.indexKey(altKey, entry);
      }

      this.logger.log(
        `WorldCitiesService: indexed ${this._all.length} cities (${this._index.size} unique normalised names) in ${Date.now() - start} ms`,
      );
    } catch (err) {
      // Log and continue — geocoding falls back to the hardcoded map. The
      // search endpoint will return empty results rather than crashing the app.
      this.logger.error('Failed to load all-the-cities dataset', err);
    }
  }

  /** Push a city into the bucket for `key`, creating the bucket on first use. */
  private indexKey(key: string, city: IndexedCity): void {
    let bucket = this._index.get(key);
    if (!bucket) {
      bucket = [];
      this._index.set(key, bucket);
    }
    bucket.push(city);
  }

  /**
   * Search cities by prefix + substring, filtered by optional country code.
   * Returns up to `limit` results sorted by population descending.
   *
   * Matching strategy:
   *   1. Exact prefix on normalised name → highest priority
   *   2. Substring anywhere in normalised name → fallback
   *
   * Both tiers are already sorted by population because `_all` was sorted at
   * init time and the index preserves insertion order from `_all`.
   *
   * Hot-path notes: names are normalised ONCE at init (`_norm`), so the loops
   * below never re-normalise. Dedup uses each city's stable `_idx` in a Set
   * instead of an O(n) `indexOf`, keeping the whole call O(matches).
   */
  search(query: string, countryCode?: string, limit = HARD_LIMIT): WorldCity[] {
    const q = normalize(query);
    if (q.length < MIN_QUERY_LENGTH) return [];

    const clampedLimit = Math.min(limit, HARD_LIMIT);
    const cc = countryCode?.toUpperCase();
    const seen = new Set<number>(); // deduplicate by stable _idx

    // We collect IndexedCity hits, then project to the public WorldCity shape
    // at the end so the internal `_norm`/`_idx` fields never leak into the API
    // response (the endpoint contract is exactly {name,countryCode,lat,lng,population}).
    const hits: IndexedCity[] = [];

    // ── Pass 1: prefix matches via the index ────────────────────────────────
    // We iterate over all keys; a trie would be faster but adds complexity for
    // a one-shot 135k-entry dataset that is built once at startup.
    for (const [key, bucket] of this._index) {
      if (!key.startsWith(q)) continue;
      for (const city of bucket) {
        if (cc && city.countryCode !== cc) continue;
        if (seen.has(city._idx)) continue;
        seen.add(city._idx);
        hits.push(city);
        if (hits.length >= clampedLimit) return hits.map(toPublic);
      }
    }

    // ── Pass 2: substring matches from the population-sorted array ──────────
    for (const city of this._all) {
      if (hits.length >= clampedLimit) break;
      if (cc && city.countryCode !== cc) continue;
      // Skip prefix matches already added above
      if (city._norm.startsWith(q)) continue;
      if (!city._norm.includes(q)) continue;
      if (seen.has(city._idx)) continue;
      seen.add(city._idx);
      hits.push(city);
    }

    return hits.map(toPublic);
  }

  /**
   * Look up a single city by exact countryCode + name (accent/case-insensitive).
   * Used by the geocoder fallback in city-coords.ts.
   *
   * Returns the highest-population match when multiple cities share a name in
   * the same country (e.g. multiple "Springfield" entries in "US").
   */
  findOne(city: string, countryCode: string): WorldCity | null {
    const q = normalize(city);
    const cc = countryCode.toUpperCase();
    const bucket = this._index.get(q);
    if (!bucket) return null;
    // Bucket is ordered by population desc (preserved from _all sort).
    const match = bucket.find((c) => c.countryCode === cc);
    return match ? toPublic(match) : null;
  }
}
