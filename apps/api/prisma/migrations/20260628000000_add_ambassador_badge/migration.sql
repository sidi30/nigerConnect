-- Ambassador badge: admin-managed distinction shown alongside identity verification.
-- Defaults FALSE so every existing account stays a regular member until promoted.
ALTER TABLE "users" ADD COLUMN "is_ambassador" BOOLEAN NOT NULL DEFAULT false;
