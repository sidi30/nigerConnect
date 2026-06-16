-- Migration: parrainage_invitations
-- §2, §7.1, §10.1 — Système de parrainage NigerConnect

-- ── Enum: InvitationStatus ────────────────────────────────────────
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- ── Enum: NotificationType += invite_accepted ─────────────────────
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'invite_accepted';

-- ── User — parrainage fields ──────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN "invited_by_id"    UUID          REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "invite_quota"     INTEGER       NOT NULL DEFAULT 3,
  ADD COLUMN "invite_abuse_flags" INTEGER     NOT NULL DEFAULT 0;

CREATE INDEX "users_invited_by_id_idx" ON "users"("invited_by_id");

-- ── Table: invitations ────────────────────────────────────────────
CREATE TABLE "invitations" (
  "id"             UUID                NOT NULL DEFAULT gen_random_uuid(),
  "code"           VARCHAR(16)         NOT NULL,
  "inviter_id"     UUID                REFERENCES "users"("id") ON DELETE CASCADE,
  "status"         "InvitationStatus"  NOT NULL DEFAULT 'pending',
  "accepted_by_id" UUID                REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at"     TIMESTAMPTZ,
  "accepted_at"    TIMESTAMPTZ,
  "revoked_at"     TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitations_code_key"        ON "invitations"("code");
CREATE INDEX "invitations_inviter_id_status_idx"  ON "invitations"("inviter_id", "status");
CREATE INDEX "invitations_status_expires_at_idx"  ON "invitations"("status", "expires_at");

-- ── Table: app_settings ───────────────────────────────────────────
CREATE TABLE "app_settings" (
  "key"        VARCHAR(60)   NOT NULL,
  "value"      VARCHAR(100)  NOT NULL,
  "updated_by" UUID,
  "updated_at" TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- ── Seed: default app_settings (registration_mode='open') ─────────
-- DEPLOY-IN-OPEN safety: never locks anyone out on first deploy.
-- Flip to 'invite_only' from admin UI once root invitations are generated.
INSERT INTO "app_settings" ("key", "value", "updated_at")
VALUES
  ('registration_mode',   'open', NOW()),
  ('default_invite_quota', '3',   NOW()),
  ('invite_expiry_days',   '30',  NOW())
ON CONFLICT ("key") DO NOTHING;
