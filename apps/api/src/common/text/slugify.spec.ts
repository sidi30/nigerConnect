import { slugify } from './slugify';

/**
 * A6 — anti-squat. Every case here is a name a squatter can register that
 * RENDERS as an existing association's name. If any of them stops colliding,
 * the unique index on `normalized_name` never fires and the name is takeable.
 */
describe('slugify — look-alike names must collide (A6)', () => {
  const REF = 'Association des Nigeriens de Paris';

  it('normalizes the ordinary case', () => {
    expect(slugify('Café Niamey !')).toBe('cafe-niamey');
    expect(slugify('   Amicale   du   Sahel  ')).toBe('amicale-du-sahel');
    expect(slugify('!!!')).toBe('association');
  });

  it.each([
    // Latin diacritics — the old hand-written table mapped "u acute" to "t"
    // (an index off-by-one), so "Commúnauté" and "Communaute" were two
    // different associations.
    ['Commúnauté Nigérienne', 'Communaute Nigerienne'],
    ['Àssociation Ìslam Nîamey', 'Association Islam Niamey'],
    // Turkish dotted capital I: toLowerCase() emits i + a combining dot, which
    // used to survive as a separator ("i-slam").
    ['İslam de Niamey', 'Islam de Niamey'],
    // Ligatures Unicode does not decompose.
    ['Cœur du Sahel', 'Coeur du Sahel'],
    ['Straße Niamey', 'Strasse Niamey'],
    // Fullwidth forms.
    ['ＡＭＩＣＡＬＥ Niamey', 'Amicale Niamey'],
  ])('folds %s onto %s', (squat, real) => {
    expect(slugify(squat)).toBe(slugify(real));
  });

  it('folds Cyrillic homoglyphs (U+0410 A, U+0435 e, U+043E o, U+0440 p, U+0441 c)', () => {
    const squat = 'Аssоsiаtion des Nigeriens de Рaris'
      .replace('si', 'ci');
    expect(slugify(squat)).toBe(slugify(REF));
  });

  it('folds Greek homoglyphs (U+0391 A, U+03BF o, U+03C1 p)', () => {
    const squat = 'Αssοciation des Nigeriens de Ρaris';
    expect(slugify(squat)).toBe(slugify(REF));
  });

  it('drops zero-width characters instead of turning them into separators', () => {
    // A zero-width space mid-word used to split it: "ass-ociation-…".
    expect(slugify('Ass​ociation des Nigeriens de Paris')).toBe(slugify(REF));
    expect(slugify('Amicale­du⁠Sahel')).toBe('amicaledusahel');
  });

  it('drops bidi overrides, which reorder what the reader actually sees', () => {
    expect(slugify('‮Amicale du Sahel')).toBe('amicale-du-sahel');
  });

  it('is idempotent — a slug fed back in is unchanged', () => {
    const once = slugify('Commúnauté Nigérienne');
    expect(slugify(once)).toBe(once);
  });
});

/**
 * The slug is written to bounded columns (slug VARCHAR(220), normalized_name
 * VARCHAR(200)) and normalization can make a name LONGER than it was, so
 * "the name passed Zod's max(200)" does not imply "the slug fits". Before the
 * cap, a 200-character name of U+2167 produced an 800-character slug: the
 * INSERT failed with a raw 22001 (500 instead of a 400), and the A6 backfill
 * migration aborted mid-flight on the very same UPDATE.
 */
describe('slugify - the slug always fits its column', () => {
  const MAX = 200;

  it('caps a name whose NFKD decomposition explodes (U+2167 -> VIII)', () => {
    const slug = slugify('Ⅷ'.repeat(MAX));
    expect(slug.length).toBe(MAX);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('caps a name whose ligature expansion doubles it (sharp s -> ss)', () => {
    expect(slugify('ß'.repeat(150)).length).toBe(MAX);
  });

  it('never leaves a trailing hyphen when the cut lands on a separator', () => {
    // 199 a's, then a space: the cut falls exactly on the hyphen it produced.
    const slug = slugify('a'.repeat(MAX - 1) + ' b');
    expect(slug).toBe('a'.repeat(MAX - 1));
    expect(slug.endsWith('-')).toBe(false);
  });

  it('leaves a name that already fits untouched', () => {
    expect(slugify('Association des Nigeriens de Paris')).toBe(
      'association-des-nigeriens-de-paris',
    );
  });
});
