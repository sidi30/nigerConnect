-- A1 course-correction: the nominative roster (GET /associations/:id/members)
-- is no longer gated behind "you must already be an approved member" — it's
-- readable by any authenticated NigerConnect user by default, because you
-- join an association to meet compatriots and need to see who's there BEFORE
-- joining. `members_visibility` is the per-association opt-out an admin/owner
-- can flip back to the old (members-only) behaviour, e.g. for a `religieux`
-- or political association where naming members can expose family still
-- in-country.
--
-- Additive + safe on a populated table: a NOT NULL column with a constant
-- DEFAULT does not rewrite existing rows on Postgres 11+ (the default is
-- stored in the catalog, not backfilled row-by-row), so this is a single
-- fast statement — no separate nullable-then-backfill-then-NOT-NULL dance
-- like the anti-squat migration above needed for a computed value.

-- CreateEnum
CREATE TYPE "AssociationMembersVisibility" AS ENUM ('public', 'members_only');

-- AlterTable
ALTER TABLE "associations"
  ADD COLUMN "members_visibility" "AssociationMembersVisibility" NOT NULL DEFAULT 'public';
