-- Activity telemetry — `users.last_seen_at`, stamped at most hourly by
-- LastSeenInterceptor on authenticated traffic. Additive, nullable, reversible:
-- existing rows stay NULL until their owner's next request.
--
-- Rationale: nothing in the schema recorded that a member came back. Without
-- this column, active-member counts (DAU / WAU / MAU) and retention cannot be
-- computed at all. `last_login_at` is not a substitute — refresh tokens are
-- long-lived, so a daily user may log in once a month.

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMPTZ;

-- Supports the "active since X" range scans the admin dashboard runs.
CREATE INDEX IF NOT EXISTS "users_last_seen_at_idx" ON "users"("last_seen_at");
