-- Sprint 1 "Le socle association devient sûr et lisible" (A2, A3, A4, A5, A6).
-- Additive throughout: every new column on the populated `associations` table
-- is nullable (or gets a same-statement backfill) before any NOT NULL/UNIQUE
-- constraint is added. Requires 20260820100000_association_owner_role to have
-- run first (adds the 'owner' AssociationRole value this file backfills).

-- ── A6 — anti-squat: slug + normalized-name uniqueness ─────────────────────
-- AlterTable
ALTER TABLE "associations"
  ADD COLUMN "slug" VARCHAR(220),
  ADD COLUMN "normalized_name" VARCHAR(200),
  ADD COLUMN "verified_at" TIMESTAMPTZ,
  ADD COLUMN "verified_by" UUID,
  ADD COLUMN "verification_note" TEXT,
  ADD COLUMN "pending_owner_id" UUID,
  ADD COLUMN "pending_owner_invited_at" TIMESTAMPTZ,
  ADD COLUMN "deleted_at" TIMESTAMPTZ;

ALTER TABLE "associations"
  ADD CONSTRAINT "associations_verified_by_fkey"
    FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "associations_pending_owner_id_fkey"
    FOREIGN KEY ("pending_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: derive slug/normalized_name from the existing name for every
-- pre-existing row. MUST stay a character-for-character mirror of
-- src/common/text/slugify.ts (same 6 steps, same FOLD table, same combining
-- range): if a legacy row's normalized_name differs from what the app computes
-- for that same name, the name is squattable -- the unique index would never
-- fire on it. Needs Postgres 13+ for normalize() and a UTF8 database (both
-- true here: postgis/postgis:16-3.4). Walked oldest-first so the FIRST association to
-- ever hold a name keeps the bare slug; a later duplicate (dev-era test data,
-- "Association Niger" created twice, etc.) gets a numeric suffix instead of
-- failing the migration.
DO $$
DECLARE
  r RECORD;
  txt TEXT;
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR r IN SELECT id, name FROM "associations" ORDER BY created_at ASC, id ASC LOOP
    -- (1) Drop invisible / bidi characters outright: translate() with an EMPTY
    -- `to` deletes them. They render as nothing, so they must weigh nothing --
    -- a zero-width space mid-word otherwise split it into two hyphenated
    -- halves, and an RTL override reordered the rendered name entirely.
    txt := translate(r.name,
      E'\u00ad\u200b\u200c\u200d\u200e\u200f\u2060\ufeff\u202a' ||
      E'\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069', '');

    -- (2) The 1 -> N expansions NFKD does not perform (they are not
    -- compatibility decompositions): sharp s, ae/oe ligatures, stroked letters.
    txt := replace(txt, E'\u00df', 'ss');
    txt := replace(txt, E'\u00e6', 'ae');
    txt := replace(txt, E'\u00c6', 'ae');
    txt := replace(txt, E'\u0153', 'oe');
    txt := replace(txt, E'\u0152', 'oe');
    txt := replace(txt, E'\u00f8', 'o');
    txt := replace(txt, E'\u00d8', 'o');
    txt := replace(txt, E'\u0111', 'd');
    txt := replace(txt, E'\u0110', 'd');
    txt := replace(txt, E'\u0142', 'l');
    txt := replace(txt, E'\u0141', 'l');
    txt := replace(txt, E'\u00fe', 'th');
    txt := replace(txt, E'\u00de', 'th');

    -- (3)+(4) NFKD, then strip the Combining Diacritical Marks block. Same
    -- range as the JS mirror (U+0300..U+036F): anything outside it becomes a
    -- hyphen on BOTH sides rather than silently diverging. The E'' escapes are
    -- expanded by the lexer, so the regex engine only ever sees real
    -- characters -- this does not rely on regex-level unicode escapes.
    txt := regexp_replace(normalize(txt, NFKD), E'[\u0300-\u036f]', '', 'g');

    -- (5) Homoglyph + ASCII-case fold. FOLD_FROM / FOLD_TO copied verbatim
    -- from src/common/text/slugify.ts -- index-aligned, same length. Folding
    -- A-Z here is why lower() is gone: it is collation-dependent for non-ASCII.
    txt := translate(txt,
      E'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u0430\u0410\u0432\u0412\u0441' ||
      E'\u0421\u0435\u0415\u043d\u041d\u04bb\u04ba\u0456\u0406' ||
      E'\u04c0\u04cf\u0458\u0408\u043a\u041a\u043c\u041c\u043e' ||
      E'\u041e\u0440\u0420\u0455\u0405\u0442\u0422\u0445\u0425' ||
      E'\u0443\u0423\u0501\u0500\u051b\u051a\u051d\u051c\u0444' ||
      E'\u0424\u043f\u041f\u0433\u0413\u03b1\u0391\u03b2\u0392' ||
      E'\u03b5\u0395\u03b6\u0396\u03b7\u0397\u03b9\u0399\u03ba' ||
      E'\u039a\u03bc\u039c\u03bd\u039d\u03bf\u039f\u03c1\u03a1' ||
      E'\u03c4\u03a4\u03c5\u03a5\u03c7\u03a7\u03b3\u0393\u03b4' ||
      E'\u0394\u03c3\u03c2\u03c6\u03a6\u03c9\u03a9\u03f2\u03f9',
      E'abcdefghijklmnopqrstuvwxyzaabbcceehhhhiiiijjkkmmooppssttxx' ||
      E'yyddqqwwffnnggaabbeezzhhiikkmmnnooppttyyxxggddssffwwcc');

    -- (6) Collapse everything left outside [a-z0-9] into single hyphens, trim.
    base := regexp_replace(regexp_replace(txt, '[^a-z0-9]+', '-', 'g'),
                           '(^-+)|(-+$)', '', 'g');
    -- (7) Cap. Mirrors MAX_SLUG in slugify.ts. Normalization GROWS some names
    -- (NFKD expands U+2167 to 'VIII', the ligature pass doubles a sharp s), so
    -- a name that fits VARCHAR(200) can normalize to 800 characters and abort
    -- this whole migration with a 22001 on the UPDATE below. Cutting at 200 --
    -- the size of normalized_name, the tighter of the two columns -- leaves
    -- slug (220) room for the '-2', '-3'... suffix the loop may append.
    base := regexp_replace(left(base, 200), '-+$', '', 'g');
    IF base = '' OR base IS NULL THEN
      base := 'association';
    END IF;
    candidate := base;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM "associations" WHERE "slug" = candidate AND id <> r.id) LOOP
      suffix := suffix + 1;
      candidate := base || '-' || suffix;
    END LOOP;
    UPDATE "associations" SET "slug" = candidate, "normalized_name" = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "associations" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "associations" ALTER COLUMN "normalized_name" SET NOT NULL;
CREATE UNIQUE INDEX "associations_slug_key" ON "associations"("slug");
CREATE UNIQUE INDEX "associations_normalized_name_key" ON "associations"("normalized_name");

-- ── A3 — owner backfill ─────────────────────────────────────────────────────
-- Every association that has at least one approved admin gets exactly one
-- 'owner': the founder (created_by) if they're still an approved admin,
-- otherwise the longest-standing approved admin. Associations with no
-- approved admin at all (shouldn't exist given the pre-existing "last admin"
-- guard, but the migration must not assume it) are left with no owner —
-- application code tolerates an ownerless association (see
-- association.service.ts assertRole / leave / changeRole comments).
UPDATE "association_members" am
SET "role" = 'owner'
FROM (
  SELECT DISTINCT ON (association_id) association_id, user_id
  FROM "association_members"
  WHERE role = 'admin' AND status = 'approved'
  ORDER BY association_id,
           (user_id = (SELECT created_by FROM "associations" a WHERE a.id = association_id)) DESC,
           joined_at ASC
) picked
WHERE am.association_id = picked.association_id AND am.user_id = picked.user_id;

-- ── A3 — role-change audit trail ────────────────────────────────────────────
-- CreateTable
CREATE TABLE "association_role_audits" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "association_id"  UUID NOT NULL,
  -- Nullable + ON DELETE SET NULL below: the trail belongs to the association,
  -- not to the accounts involved. NOT NULL + CASCADE would make the A2
  -- reassignment audit self-erasing (the actor is the account being deleted).
  "actor_id"        UUID,
  "target_user_id"  UUID,
  "from_role"       "AssociationRole" NOT NULL,
  "to_role"         "AssociationRole" NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "association_role_audits_association_id_fkey"
    FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "association_role_audits_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "association_role_audits_target_user_id_fkey"
    FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "association_role_audits_association_id_created_at_idx"
  ON "association_role_audits"("association_id", "created_at");

-- ── A4 — executive board (separate axis from AssociationRole) ──────────────
-- CreateEnum
CREATE TYPE "AssociationOfficerTitle" AS ENUM (
  'president', 'vice_president', 'secretary', 'treasurer', 'spokesperson', 'other'
);

-- CreateTable
CREATE TABLE "association_officers" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "association_id"  UUID NOT NULL,
  "user_id"         UUID NOT NULL,
  "title"           "AssociationOfficerTitle" NOT NULL,
  "custom_title"    VARCHAR(100),
  "sort_order"      INTEGER NOT NULL DEFAULT 0,
  "accepted_at"     TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "association_officers_association_id_fkey"
    FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "association_officers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "association_officers_association_id_user_id_key"
  ON "association_officers"("association_id", "user_id");
CREATE INDEX "association_officers_association_id_sort_order_idx"
  ON "association_officers"("association_id", "sort_order");

-- ── Notification types used by the governance flows above ──────────────────
-- AlterEnum (not used by any statement in THIS migration — safe in the same
-- transaction; only re-using a value inside the migration that adds it is
-- forbidden, and nothing here does that).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'association_role_changed';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'association_ownership_transfer';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'association_officer_invite';
