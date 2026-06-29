-- App-user announcements: per-user newsletter preference (opt-out, default ON)
-- + one-click email-unsubscribe token, campaign audience/critical, and the
-- 'announcement' notification type.

ALTER TABLE "users" ADD COLUMN "newsletter_opt_in" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "newsletter_token" VARCHAR(64);
CREATE UNIQUE INDEX "users_newsletter_token_key" ON "users"("newsletter_token");

ALTER TABLE "newsletter_campaigns" ADD COLUMN "audience" VARCHAR(20) NOT NULL DEFAULT 'subscribers';
ALTER TABLE "newsletter_campaigns" ADD COLUMN "critical" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'announcement';
