/**
 * Proximity "rencontre" — double-blind mutual encounters. The match payload is
 * deliberately ANONYMOUS: it carries only an opaque encounter handle and a
 * coarse distance bucket, never the other person's identity. The peer is
 * revealed only once a request is accepted.
 */

export type ProximityEncounterStatus =
  | 'active'
  | 'requested'
  | 'accepted'
  | 'declined'
  | 'expired';

/** Anonymous match surfaced to the pinger (and, via notification, to the peer). */
export interface ProximityMatch {
  encounterId: string;
  /** Coarse distance bucket in meters (50 | 100 | 500 | 1000) — never exact. */
  distance: number;
}

export interface ProximityPingResult {
  matches: ProximityMatch[];
}

/** The requester's profile, revealed only to the target of an incoming request. */
export interface ProximityRequester {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  identityStatus: string;
  isAmbassador: boolean;
}

/**
 * One row of GET /geo/proximity/encounters. Anonymous unless `requester` is set
 * (which happens ONLY for an incoming request the viewer hasn't answered yet).
 * `outgoing` = the viewer is the one who requested (peer still hidden).
 */
export interface ProximityEncounterSummary {
  encounterId: string;
  status: ProximityEncounterStatus;
  distance: number;
  createdAt: string;
  outgoing: boolean;
  requester?: ProximityRequester;
}

export interface ProximityActionResult {
  status: ProximityEncounterStatus;
}
