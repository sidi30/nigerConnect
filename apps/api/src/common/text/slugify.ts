// Shared name -> slug normalization (A6 - anti-squat on associations).
//
// One function, used BOTH by the service (so the value the app sees at
// creation time matches what a validation error would reference) and by the
// migration backfill (mirrored in SQL - see prisma/migrations/*/migration.sql
// association_governance - because a hand-written PL/pgSQL DO block can't call
// into Node). Keep the two in lockstep if this ever changes.
//
// The pipeline is deliberately paranoid, because "two names that LOOK the same
// must produce the same slug" is the whole anti-squat guarantee. A squatter
// only needs one character that renders identically but normalizes differently
// to register "Association des Nigeriens de Paris" a second time:
//
//   1. drop invisible/bidi characters outright (a zero-width space mid-word
//      used to split it into two hyphenated halves; an RTL override used to
//      reorder the rendered name entirely);
//   2. expand the ligatures Unicode refuses to decompose (ss/ae/oe/...);
//   3. NFKD + strip combining marks - handles EVERY Latin diacritic and the
//      fullwidth forms generically, instead of a hand-maintained table (the
//      previous one had 'u' with an acute mapped to 't', an off-by-one that
//      made "Commúnauté" and "Communaute" two different associations);
//   4. fold the Cyrillic/Greek homoglyphs NFKD leaves alone, and ASCII case,
//      via one translate() table - so neither JS toLowerCase() nor Postgres
//      lower() (which is collation-dependent for non-ASCII) is load-bearing;
//   5. collapse whatever is left outside [a-z0-9] into single hyphens.

// U+00AD soft hyphen, the zero-width family, and the bidi controls. Removed,
// NOT turned into a separator: they render as nothing, so they must weigh
// nothing.
const INVISIBLE = /[\u00ad\u200b\u200c\u200d\u200e\u200f\u2060\ufeff\u202a-\u202e\u2066-\u2069]/g;

// 1 -> N expansions NFKD does not perform (they are not compatibility
// decompositions). Applied to both cases before normalization.
const LIGATURES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/g, 'ss'], // ß
  [/[æÆ]/g, 'ae'], // æ Æ
  [/[œŒ]/g, 'oe'], // œ Œ
  [/[øØ]/g, 'o'], // ø Ø
  [/[đĐ]/g, 'd'], // đ Đ
  [/[łŁ]/g, 'l'], // ł Ł
  [/[þÞ]/g, 'th'], // þ Þ
];

// Combining Diacritical Marks. Same range as the SQL mirror on purpose:
// anything outside it becomes a hyphen on BOTH sides rather than silently
// diverging.
const COMBINING = /[\u0300-\u036f]/g;

// Homoglyph + ASCII-case fold. Two strings of equal length, index-aligned,
// copied verbatim into the migration's translate() call.
const FOLD_FROM =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZаАвВсСе' +
  'ЕнНһҺіІӀӏјЈ' +
  'кКмМоОрРѕЅт' +
  'ТхХуУԁԀԛԚԝԜ' +
  'фФпПгГαΑβΒε' +
  'ΕζΖηΗιΙκΚμΜ' +
  'νΝοΟρΡτΤυΥχ' +
  'ΧγΓδΔσςφΦωΩ' +
  'ϲϹ';
const FOLD_TO =
  'abcdefghijklmnopqrstuvwxyzaabbcceehhhhiiiijjkkmmooppssttxxyyddqqwwff' +
  'nnggaabbeezzhhiikkmmnnooppttyyxxggddssffwwcc';

const FOLD = new Map<string, string>();
for (let i = 0; i < FOLD_FROM.length; i += 1) FOLD.set(FOLD_FROM[i]!, FOLD_TO[i]!);

// normalized_name is VARCHAR(200) and slug VARCHAR(220) (schema.prisma). The
// slug of a de-duplicated name is this value plus a "-N" suffix, so capping at
// the SMALLER of the two keeps both inserts legal. Mirrored by the left(...)
// in the association_governance migration.
const MAX_SLUG = 200;

/** Postgres `translate()`, character by character. */
function fold(input: string): string {
  let out = '';
  for (const ch of input) out += FOLD.get(ch) ?? ch;
  return out;
}

/**
 * Turns an association name into a URL-safe, comparable slug: "Café Niamey !"
 * -> "cafe-niamey". Both the immutable `slug` and the `normalizedName`
 * uniqueness key are this same value - see association.service.ts `create()`.
 */
export function slugify(name: string): string {
  let s = name.replace(INVISIBLE, '');
  for (const [re, to] of LIGATURES) s = s.replace(re, to);
  s = fold(s.normalize('NFKD').replace(COMBINING, ''));
  const base = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // Normalization can GROW the name, so a name that fits its own column does
  // not imply a slug that fits: NFKD expands U+2167 to 'VIII' and the ligature
  // pass turns one sharp s into two. 200 characters (the Zod max on `name`)
  // of U+2167 produce an 800-character slug, which used to blow up the INSERT
  // with a raw 22001 (and aborted the backfill migration mid-flight). Cut at
  // the tighter of the two columns, leaving `slug` 20 characters of headroom
  // for the "-2", "-3"... de-duplication suffix appended at creation time.
  const capped = base.slice(0, MAX_SLUG).replace(/-+$/g, '');
  return capped || 'association';
}
