-- Newsletter targeting + rich content. Additive & reversible.
-- 1) segment JSONB  — filters for the 'segment' audience (registered accounts)
-- 2) include_emails / exclude_emails TEXT[] — individual add/remove lists,
--    applied on top of the resolved audience (deduped by email at send time)
-- 3) attachments JSONB — [{ url, filename, contentType }] delivered as email
--    attachments (uploaded to our own bucket via POST /admin/newsletter/upload)
-- The 'audience' column already exists (VARCHAR(20)) and now also accepts
-- 'segment' and 'custom' — no schema change needed for that.

ALTER TABLE "newsletter_campaigns"
  ADD COLUMN IF NOT EXISTS "segment" JSONB,
  ADD COLUMN IF NOT EXISTS "include_emails" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "exclude_emails" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "attachments" JSONB;
