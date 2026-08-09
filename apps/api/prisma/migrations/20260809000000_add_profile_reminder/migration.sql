-- P-REMINDER — one-shot "complète ton profil" email nudge. Additive & reversible.
-- Single User column: profile_reminder_sent_at (at-most-once stamp for the
-- idempotent cron, mirrors last_digest_sent_at). No index: the candidate set
-- (verified accounts without a country_code) is tiny and the hourly scan is
-- bounded by the cron's batch size.

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "profile_reminder_sent_at" TIMESTAMPTZ;
