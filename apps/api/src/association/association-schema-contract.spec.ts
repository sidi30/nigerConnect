import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssociationSchema, designateOfficerSchema } from './dto/association.dto';

const ROOT = join(__dirname, '..', '..');
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const GOVERNANCE_MIGRATION = readFileSync(
  join(ROOT, 'prisma', 'migrations', '20260820110000_association_governance', 'migration.sql'),
  'utf8',
);
const SLUGIFY_SRC = readFileSync(join(ROOT, 'src', 'common', 'text', 'slugify.ts'), 'utf8');

/**
 * Contracts that live in files Jest cannot exercise at runtime (Prisma schema,
 * migration SQL) but that a code change can silently break. Cheaper to assert
 * here than to discover on a production deploy.
 */
describe('association governance — schema/migration contracts', () => {
  // ── A2 — the audit trail must outlive the accounts it names ──────────────
  it('association_role_audits keeps its rows when a named user is deleted', () => {
    const start = SCHEMA.indexOf('model AssociationRoleAudit');
    const model = SCHEMA.slice(start, SCHEMA.indexOf('}', start));
    // Cascade here made the A2 reassignment audit SELF-erasing: the row is
    // written with actorId = the account being deleted, and the very next
    // statement of the same transaction (`user.delete`) took it straight back
    // out — the one role change nobody consciously decided was the one with
    // no trace at all.
    expect(model).toMatch(/AssociationRoleAuditActor"[^\n]*onDelete: SetNull/);
    expect(model).toMatch(/AssociationRoleAuditTarget"[^\n]*onDelete: SetNull/);
    expect(model).not.toMatch(/AssociationRoleAudit(Actor|Target)"[^\n]*onDelete: Cascade/);
  });

  it('the migration creates those FKs as ON DELETE SET NULL', () => {
    const table = GOVERNANCE_MIGRATION.slice(
      GOVERNANCE_MIGRATION.indexOf('CREATE TABLE "association_role_audits"'),
      GOVERNANCE_MIGRATION.indexOf('CREATE INDEX "association_role_audits'),
    );
    expect(table).toMatch(/"actor_id"\) REFERENCES "users"\("id"\) ON DELETE SET NULL/);
    expect(table).toMatch(/"target_user_id"\) REFERENCES "users"\("id"\) ON DELETE SET NULL/);
  });

  // ── the migration must stay additive: prod is live ───────────────────────
  it('is additive — no destructive statement against a populated table', () => {
    expect(GOVERNANCE_MIGRATION).not.toMatch(/\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
    expect(GOVERNANCE_MIGRATION).not.toMatch(/\bTRUNCATE\b/i);
    expect(GOVERNANCE_MIGRATION).not.toMatch(/\bDELETE\s+FROM\b/i);
    // Every column added to the already-populated `associations` table has to
    // arrive nullable; NOT NULL only once the backfill has run.
    const addBlock = GOVERNANCE_MIGRATION.slice(
      GOVERNANCE_MIGRATION.indexOf('ALTER TABLE "associations"'),
      GOVERNANCE_MIGRATION.indexOf('ADD CONSTRAINT "associations_verified_by_fkey"'),
    );
    expect(addBlock).not.toMatch(/ADD COLUMN[^,;]*NOT NULL/i);
    expect(GOVERNANCE_MIGRATION.indexOf('ALTER COLUMN "slug" SET NOT NULL')).toBeGreaterThan(
      GOVERNANCE_MIGRATION.indexOf('END $$;'),
    );
  });

  // ── A6 — the SQL backfill must mirror slugify() exactly ──────────────────
  it('the backfill fold table is character-for-character the one slugify() uses', () => {
    // Built from a char code so the escape itself cannot be mangled by an
    // editor round-trip: matches the six-character sequence backslash-u-XXXX.
    const BACKSLASH = String.fromCharCode(92);
    const U_ESCAPE = new RegExp(BACKSLASH + BACKSLASH + 'u([0-9a-f]{4})', 'g');
    const unesc = (raw: string) =>
      raw.replace(U_ESCAPE, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    const pick = (block: string, re: RegExp) =>
      Array.from(block.matchAll(re)).map((m) => m[1]!).join('');

    const tsBlock = SLUGIFY_SRC.slice(
      SLUGIFY_SRC.indexOf('const FOLD_FROM ='),
      SLUGIFY_SRC.indexOf('const FOLD ='),
    );
    const [tsFromRaw, tsToRaw] = tsBlock.split('const FOLD_TO =');
    const tsFrom = unesc(pick(tsFromRaw!, /'([^']*)'/g));
    const tsTo = unesc(pick(tsToRaw!, /'([^']*)'/g));

    // The two translate() arguments: each is a run of E'…' literals joined by
    // `||`, the two runs separated by a comma.
    const sqlBlock = GOVERNANCE_MIGRATION.slice(
      GOVERNANCE_MIGRATION.indexOf('txt := translate(txt,'),
      GOVERNANCE_MIGRATION.indexOf('-- (6) Collapse'),
    );
    const runs = Array.from(sqlBlock.matchAll(/(?:E'[^']*'(?:\s*\|\|\s*)?)+/g)).map((m) => m[0]);
    expect(runs).toHaveLength(2);
    const sqlFrom = unesc(pick(runs[0]!, /E'([^']*)'/g));
    const sqlTo = unesc(pick(runs[1]!, /E'([^']*)'/g));

    expect(tsFrom.length).toBeGreaterThan(100);
    expect(tsFrom.length).toBe(tsTo.length);
    // A divergence here is a silent squat hole: a legacy row's
    // normalized_name would differ from what the app computes for that very
    // name, so the unique index would never fire on it.
    expect(sqlFrom).toBe(tsFrom);
    expect(sqlTo).toBe(tsTo);
  });

  // ── A6 — the display name is the other half of anti-squat ────────────────
  describe('name validation', () => {
    const base = { category: 'religieux' as const, countryCode: 'FR', city: 'Paris' };

    it('refuses a right-to-left override (reverses what the reader sees)', () => {
      const name = '\u202eAmicale du Sahel';
      expect(createAssociationSchema.safeParse({ ...base, name }).success).toBe(false);
    });

    it('refuses control characters (they reach push titles and mail subjects)', () => {
      const name = 'Amicale\r\nBcc: victim@example.org';
      expect(createAssociationSchema.safeParse({ ...base, name }).success).toBe(false);
    });

    it('accepts a normal accented name and trims it', () => {
      const res = createAssociationSchema.safeParse({
        ...base,
        name: '  Amicale des Nigériens  ',
      });
      expect(res.success).toBe(true);
      expect(res.success && res.data.name).toBe('Amicale des Nigériens');
    });
  });

  // ── A6 — the board title is free text, and it is rendered publicly ──
  describe('customTitle validation', () => {
    // `title: 'other'` lets an officer name their own seat, and listOfficers
    // renders it verbatim on the one board surface readable WITHOUT being a
    // member. Same reasoning as `name`: a bidi override reverses what the
    // reader sees, and C0/C1 controls carry line breaks into places that
    // expect one line. Refused outright rather than silently stripped — the
    // admin designating the officer should see the error.
    const base = { userId: '11111111-1111-4111-8111-111111111111', title: 'other' as const };

    it('refuses a right-to-left override', () => {
      const customTitle = '\u202eTrésorier';
      expect(designateOfficerSchema.safeParse({ ...base, customTitle }).success).toBe(false);
    });

    it('refuses control characters', () => {
      const customTitle = 'Trésorier\r\nBcc: victim@example.org';
      expect(designateOfficerSchema.safeParse({ ...base, customTitle }).success).toBe(false);
    });

    it('accepts a normal accented title and trims it', () => {
      const res = designateOfficerSchema.safeParse({
        ...base,
        customTitle: '  Trésorier adjoint  ',
      });
      expect(res.success).toBe(true);
      expect(res.success && res.data.customTitle).toBe('Trésorier adjoint');
    });
  });
});
