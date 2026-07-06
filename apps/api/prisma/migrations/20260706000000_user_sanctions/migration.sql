-- Sanctions: motive + optional expiry stored alongside a user's status.
-- Both nullable & default NULL so every existing account is unaffected.
ALTER TABLE "users" ADD COLUMN "status_reason" VARCHAR(500);
ALTER TABLE "users" ADD COLUMN "status_expires_at" TIMESTAMPTZ;

-- Audit trail for sensitive admin user-management actions (status/sanction,
-- force-logout, MFA reset). actor_id / target_user_id are bare uuids (no FK) so
-- the log survives either account's deletion.
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "target_user_id" UUID,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_target_user_id_created_at_idx" ON "admin_audit_logs"("target_user_id", "created_at");
