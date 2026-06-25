-- Migration: invitation_target_email
-- Adds targeted-email support to the invitations system.
-- Data-minimization: target_email is nullable and purged the moment the
-- invitation leaves 'pending' (accept, revoke, expiry).

-- ── Add target_email column to invitations ────────────────────────
ALTER TABLE "invitations"
  ADD COLUMN "target_email" VARCHAR(254);

-- ── Index for email-match lookup during registration ──────────────
-- Supports: WHERE status = 'pending' AND target_email = $email
CREATE INDEX "invitations_status_target_email_idx"
  ON "invitations"("status", "target_email");
