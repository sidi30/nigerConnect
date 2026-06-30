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
