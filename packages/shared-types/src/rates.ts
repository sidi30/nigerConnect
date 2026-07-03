// ── E-TAUX : taux du jour + prix crowdsourcés ─────────────────────────────

// XOF↔EUR is a fixed regulatory peg (UEMOA), XOF↔USD/CAD are derived from the
// ECB daily snapshot. `usdXof`/`cadXof` are null until the first snapshot lands
// (or if the currency is missing from the feed). `asOf` is the real snapshot
// date so the UI can honestly display "rate as of DD/MM".
export interface RatesToday {
  eurXof: number; // constant 655.957
  usdXof: number | null;
  cadXof: number | null;
  asOf: string | null; // ISO date of the snapshot backing usd/cad, null if none
  // 'ecb' when derived from a real snapshot, 'unavailable' before the 1st fetch.
  source: 'ecb' | 'unavailable';
}

export type CommunityPriceType = 'billet_avion' | 'transfert_argent' | 'colis_kg';
export type CommunityPriceStatus = 'active' | 'removed';

/**
 * Minimal, PII-free contributor projection attached to a community price.
 *
 * Deliberately NOT `PublicUser`: a price report must never expose a
 * contributor's real name (`firstName`/`lastName`) or coarse location
 * (`city`/`countryCode`) — not even to authenticated members, and never to a
 * scraper. Only a display handle + avatar + the curated ambassador badge are
 * surfaced (privacy model: a `private` account must not be de-anonymised or
 * geolocated because it posted a price).
 */
export interface CommunityPriceSubmitter {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  isAmbassador: boolean;
}

export interface CommunityPrice {
  id: string;
  submitter: CommunityPriceSubmitter;
  type: CommunityPriceType;
  originCity: string | null;
  originCountry: string | null;
  destCity: string | null;
  destCountry: string | null;
  provider: string | null;
  amount: string; // Decimal serialised as string
  currency: string;
  note: string | null;
  trustScore: number;
  status: CommunityPriceStatus;
  // Present only when the caller is authenticated: their own vote on this row.
  myVote?: 1 | -1 | null;
  createdAt: string;
  updatedAt: string;
}

// Lightweight feed banner: FX + at most one representative price per type.
export interface RatesBanner {
  rates: RatesToday;
  prices: CommunityPrice[];
}

export interface CommunityPriceVoteResult {
  priceId: string;
  trustScore: number;
  myVote: 1 | -1 | null;
}
