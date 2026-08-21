import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Feather } from '@expo/vector-icons';
import Animated, { useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';

/**
 * NigerConnect badge system — ONE visual grammar for every "trust mark" in
 * the app, instead of a component per mark.
 *
 * WHY this file exists: badges were bolted on one at a time — VerifiedBadge,
 * then AmbassadorBadge, then OfficialBadge, then AssociationVerifiedBadge —
 * and the owner's complaint was literal: "quatre pastilles ajoutées au fil de
 * l'eau et plus personne ne sait ce qu'un badge veut dire". `docs/
 * REALISATIONS.md` adds two more (réalisation vérifiée par pièce d'identité,
 * réalisation « de confiance » après 10 avis), which would have meant a
 * FIFTH and SIXTH sibling component and N more call sites hand-updated. A
 * `kind` enum + one renderer means the seventh badge is one `BADGE_DEFS`
 * entry, not a new file.
 *
 * THE GRAMMAR — two independent axes. Colour alone is never the proof
 * (colour-blind safety; it's also *why* Facebook's single grey "org" badge
 * never read as meaningful while X's shape+colour double-coding did):
 *
 *   SHAPE = which ENTITY FAMILY the badge decorates. One shape per family,
 *   shared by every badge that can appear on that family:
 *     - disc   → a PERSON            (official, person_verified, ambassador)
 *     - shield → an ASSOCIATION      (association_verified)
 *     - tag    → a REALISATION       (realisation_id_verified, realisation_trusted)
 *   A badge for a brand-new entity family earns a brand-new shape. A badge
 *   added to an EXISTING family reuses that family's shape — that's what
 *   keeps "what kind of thing is this a mark on" readable at a glance.
 *
 *   COLOUR + ICON = which CLAIM is being made, reused across families
 *   wherever the same claim applies:
 *     - green + check       → identity verified by NigerConnect through
 *                              direct evidence (ID document, manual review)
 *     - gold  + star/thumb  → a distinction EARNED from other members
 *                              (usage, reputation) — never an identity claim
 *     - blue  + check(ring) → platform-issued, unforgeable, reserved to the
 *                              NigerConnect account itself
 *     - amber + check(ring) → NigerConnect vetted an ORGANISATION, not an
 *                              individual (association today; could extend
 *                              to other org-level entities later)
 *   The white ring is reserved for the two admin-issued, one-per-entity
 *   stamps (official, association_verified) as a deliberate weight signal —
 *   individual-level claims (person_verified, realisation_id_verified) and
 *   earned distinctions (ambassador, realisation_trusted) skip it.
 *
 *   The colour/shape pair is only a POINTER, never the proof: tapping a
 *   badge (where tap makes sense — see `tappableByDefault` below) always
 *   surfaces the plain-language label via `badgeLabel()`. That label is what
 *   actually carries the meaning.
 *
 * COEXISTENCE: two badges CAN sit on the same entity today (a person can be
 * both verified AND ambassador; a realisation can be both ID-verified AND
 * trusted). `<BadgeGroup>` renders whichever subset it's given in the fixed
 * order declared by `BADGE_ORDER` (identity-family claims before
 * earned-distinction claims) and caps the row at `max` — see the "+N"
 * overflow chip — rather than let it silently wrap or clip.
 *
 * EXCEPTION — `official`: platform status is deliberately exclusive. If an
 * account is official, that is the ONLY person badge shown — see
 * `selectPersonBadges` below. It would undercut the one badge nobody else
 * can obtain to show it next to badges thousands of members already carry.
 *
 * ERGONOMICS RULE — tap-to-reveal-label vs. list rows: a badge is only
 * rendered tappable (`interactive`) when it is NOT nested inside another
 * tappable row. Inside a list row that already navigates on tap (e.g. one
 * association per row in `settings/associations.tsx`), the badge is
 * decorative only (`interactive={false}`) — a ~28px dead zone in the middle
 * of the row that opens an alert instead of navigating is a worse
 * experience than one extra tap through the row to see the same label on
 * the detail header, where the badge is not competing with anything and
 * stays tappable. Callers pass `interactive` explicitly whenever they sit
 * inside another Pressable; the default below is only correct for
 * standalone placements (headers, sheets).
 *
 * TO ADD A SEVENTH BADGE: add a `BadgeKind`, one `BADGE_DEFS` entry (shape
 * from the entity family above, colour from the claim family above, icon,
 * tappability, label text), and its slot in `BADGE_ORDER` if it can coexist
 * with a sibling. Nothing else in this file changes.
 */

export type BadgeShape = 'disc' | 'shield' | 'tag';

export type BadgeKind =
  | 'official'
  | 'person_verified'
  | 'ambassador'
  | 'association_verified'
  | 'realisation_id_verified'
  | 'realisation_trusted';

type FeatherIconName = ComponentProps<typeof Feather>['name'];

interface BadgeDef {
  shape: BadgeShape;
  color: string;
  ring: boolean;
  icon: FeatherIconName;
  iconRatio: number;
  /** Default `interactive` value — see the ergonomics rule above. Callers may override. */
  tappableByDefault: boolean;
  title: string;
  a11yBase: string;
}

// Kept as named constants (not inline hexes) so every badge referencing the
// same claim — including non-component consumers like the map pin in
// MapCanvas.tsx, which can't render this component inside a native Marker —
// draws from one source of truth.
const OFFICIAL_BLUE = '#1D4ED8';
const AMBASSADOR_GOLD = '#E8A300';
export const ASSOCIATION_AMBER = '#B45309';

const BADGE_DEFS: Record<BadgeKind, BadgeDef> = {
  official: {
    shape: 'disc',
    color: OFFICIAL_BLUE,
    ring: true,
    icon: 'check',
    iconRatio: 0.66,
    tappableByDefault: false,
    title: 'Compte officiel',
    a11yBase: 'Compte officiel NigerConnect',
  },
  person_verified: {
    shape: 'disc',
    color: Colors.green,
    ring: false,
    icon: 'check',
    iconRatio: 0.7,
    tappableByDefault: false,
    title: 'Identité vérifiée',
    a11yBase: 'Identité vérifiée',
  },
  ambassador: {
    shape: 'disc',
    color: AMBASSADOR_GOLD,
    ring: false,
    icon: 'star',
    iconRatio: 0.66,
    tappableByDefault: false,
    title: 'Ambassadeur',
    a11yBase: 'Ambassadeur NigerConnect',
  },
  association_verified: {
    shape: 'shield',
    color: ASSOCIATION_AMBER,
    ring: true,
    icon: 'check',
    iconRatio: 0.55,
    tappableByDefault: true,
    title: 'Association vérifiée',
    a11yBase: 'Association vérifiée',
  },
  realisation_id_verified: {
    shape: 'tag',
    color: Colors.green,
    ring: false,
    icon: 'check',
    iconRatio: 0.58,
    tappableByDefault: true,
    title: 'Vérifiée par pièce d’identité',
    a11yBase: 'Réalisation vérifiée par pièce d’identité',
  },
  realisation_trusted: {
    shape: 'tag',
    color: AMBASSADOR_GOLD,
    ring: false,
    icon: 'thumbs-up',
    iconRatio: 0.58,
    tappableByDefault: true,
    title: 'De confiance',
    a11yBase: 'Réalisation de confiance',
  },
};

// Deterministic left-to-right order whenever several kinds coexist on one
// entity — identity-family claims (self- or admin-evidenced) before
// earned-distinction claims (conferred by other members' behaviour).
export const BADGE_ORDER: BadgeKind[] = [
  'official',
  'person_verified',
  'association_verified',
  'realisation_id_verified',
  'ambassador',
  'realisation_trusted',
];

function formatDateFr(iso?: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export interface BadgeLabelMeta {
  /** `association_verified` / `realisation_id_verified` — when the check happened. */
  verifiedAt?: string | null;
  /** `realisation_trusted` — how many qualifying reviews back the mark. */
  trustedCount?: number;
}

export interface BadgeLabel {
  title: string;
  body?: string;
  a11y: string;
}

/**
 * Pure label builder — the single mechanism every badge uses to turn its
 * `kind` + optional metadata into what a tap (or a screen reader) surfaces.
 * Kept standalone (no React) so it's directly unit-testable.
 */
export function badgeLabel(kind: BadgeKind, meta: BadgeLabelMeta = {}): BadgeLabel {
  const def = BADGE_DEFS[kind];
  let body: string | undefined;

  if (kind === 'association_verified' || kind === 'realisation_id_verified') {
    const date = formatDateFr(meta.verifiedAt);
    body = date ? `Vérifiée le ${date}.` : undefined;
  } else if (kind === 'realisation_trusted') {
    body =
      meta.trustedCount && meta.trustedCount > 0
        ? `${meta.trustedCount} avis vérifiés.`
        : 'Avis vérifiés de la communauté.';
  }

  const a11y = body ? `${def.a11yBase}, ${body}` : def.a11yBase;
  return { title: def.title, body, a11y };
}

export interface PersonBadgeInput {
  isOfficial?: boolean;
  identityStatus?: string | null;
  isAmbassador?: boolean;
}

/**
 * Pure selection of which person-family badges apply, in display order.
 * `official` is exclusive (see the grammar note above) — every other call
 * site used to hand-roll this exact ternary; this is the one place it lives
 * now.
 */
export function selectPersonBadges(u: PersonBadgeInput): BadgeKind[] {
  if (u.isOfficial) return ['official'];
  const kinds: BadgeKind[] = [];
  if (u.identityStatus === 'approved') kinds.push('person_verified');
  if (u.isAmbassador) kinds.push('ambassador');
  return kinds;
}

function shapeStyle(def: BadgeDef, size: number) {
  if (def.shape === 'shield') {
    return {
      width: size * 0.86,
      height: size,
      borderRadius: size * 0.2,
      borderTopLeftRadius: size * 0.32,
      borderTopRightRadius: size * 0.32,
      borderWidth: Math.max(1, size * 0.08),
    };
  }
  if (def.shape === 'tag') {
    return {
      width: size * 1.15,
      height: size * 0.82,
      borderRadius: size * 0.22,
    };
  }
  // disc
  return {
    width: size,
    height: size,
    borderRadius: size / 2,
    ...(def.ring ? { borderWidth: Math.max(1, size * 0.08) } : null),
  };
}

export interface BadgeProps {
  kind: BadgeKind;
  size?: number;
  /** Overrides `BADGE_DEFS[kind].tappableByDefault` — see the ergonomics rule above. */
  interactive?: boolean;
  verifiedAt?: string | null;
  trustedCount?: number;
}

export function Badge({ kind, size = 14, interactive, verifiedAt, trustedCount }: BadgeProps) {
  const def = BADGE_DEFS[kind];
  const reduce = useReducedMotion();
  const tappable = interactive ?? def.tappableByDefault;
  const label = badgeLabel(kind, { verifiedAt, trustedCount });

  const glyph = (
    <Animated.View
      entering={reduce ? undefined : ZoomIn.springify().damping(8).stiffness(180)}
      style={[
        styles.shape,
        def.ring ? { borderColor: Colors.white } : null,
        { backgroundColor: def.color },
        shapeStyle(def, size),
      ]}
      {...(tappable ? null : { accessibilityRole: 'image' as const, accessibilityLabel: label.a11y })}
    >
      <Feather name={def.icon} size={size * def.iconRatio} color={Colors.white} />
    </Animated.View>
  );

  if (!tappable) {
    return (
      <View style={styles.wrap} testID={`badge-${kind}`}>
        {glyph}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => Alert.alert(label.title, label.body)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label.a11y}
      style={styles.wrap}
      testID={`badge-${kind}`}
    >
      {glyph}
    </Pressable>
  );
}

export interface BadgeGroupProps {
  kinds: BadgeKind[];
  size?: number;
  /** How many badges render before folding the rest into a "+N" chip. */
  max?: number;
  interactive?: boolean;
  verifiedAt?: string | null;
  trustedCount?: number;
}

/**
 * Renders a `kinds` subset in the deterministic `BADGE_ORDER`, with an
 * explicit overflow behaviour (a neutral "+N" chip, never a silent wrap or
 * clip) once `max` is exceeded.
 */
export function BadgeGroup({ kinds, size = 14, max = 3, interactive, verifiedAt, trustedCount }: BadgeGroupProps) {
  if (kinds.length === 0) return null;
  const ordered = BADGE_ORDER.filter((k) => kinds.includes(k));
  const visible = ordered.slice(0, max);
  const overflow = ordered.slice(max);

  return (
    <View style={styles.row} testID="badge-group">
      {visible.map((kind) => (
        <Badge
          key={kind}
          kind={kind}
          size={size}
          interactive={interactive}
          verifiedAt={kind === 'association_verified' || kind === 'realisation_id_verified' ? verifiedAt : undefined}
          trustedCount={kind === 'realisation_trusted' ? trustedCount : undefined}
        />
      ))}
      {overflow.length > 0 ? <OverflowChip kinds={overflow} size={size} /> : null}
    </View>
  );
}

function OverflowChip({ kinds, size }: { kinds: BadgeKind[]; size: number }) {
  const titles = kinds.map((k) => badgeLabel(k).title).join(', ');
  return (
    <Pressable
      onPress={() => Alert.alert('Autres badges', titles)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${kinds.length} badges supplémentaires : ${titles}`}
      style={styles.wrap}
      testID="badge-overflow"
    >
      <View style={[styles.shape, styles.overflowShape, { width: size * 1.15, height: size * 0.82, borderRadius: size * 0.22 }]}>
        <Animated.Text style={[styles.overflowText, { fontSize: size * 0.6 }]}>+{kinds.length}</Animated.Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginLeft: 3 },
  row: { flexDirection: 'row', alignItems: 'center' },
  shape: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowShape: {
    backgroundColor: Colors.tan400,
  },
  overflowText: {
    color: Colors.white,
    fontWeight: '800',
  },
});
