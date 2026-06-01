-- Collapse any pre-existing duplicate OAuth identities, keeping the earliest
-- account per (oauth_provider, oauth_provider_id) so the new unique index can
-- be applied safely. Only rows that are actually OAuth-linked are considered;
-- password-only users have both columns NULL and are never matched here.
DELETE FROM "users" a
USING "users" b
WHERE a."oauth_provider" IS NOT NULL
  AND a."oauth_provider_id" IS NOT NULL
  AND a."oauth_provider" = b."oauth_provider"
  AND a."oauth_provider_id" = b."oauth_provider_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");

-- Replace the plain lookup index with a UNIQUE one. The unique index also
-- serves lookups by (provider, providerId), so no separate index is needed.
-- Postgres treats NULLs as distinct, so password-only users (both columns NULL)
-- can coexist without violating uniqueness.
DROP INDEX IF EXISTS "users_oauth_provider_oauth_provider_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "users_oauth_provider_oauth_provider_id_key" ON "users"("oauth_provider", "oauth_provider_id");
