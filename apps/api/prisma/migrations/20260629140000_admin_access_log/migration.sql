-- Audit trail for the "admin full visibility" support override.
CREATE TABLE "admin_access_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "target_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_access_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_access_logs_action_created_at_idx" ON "admin_access_logs"("action", "created_at");
