-- E-DIGEST — weekly regional retention digest (push + in-app). Additive & reversible.
-- 1) new NotificationType value 'weekly_digest' (aggregate-only push)
-- 2) two User columns: digestOptIn (opt-out, ON by default) + lastDigestSentAt
--    (at-most-once stamp for the idempotent cron)

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'weekly_digest';

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "digest_opt_in" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_digest_sent_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_digest_opt_in_last_digest_sent_at_idx"
  ON "users"("digest_opt_in", "last_digest_sent_at");
