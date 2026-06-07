-- Add a 6-digit verification code (hashed) + attempt counter to email_tokens.
ALTER TABLE "email_tokens" ADD COLUMN "code_hash" VARCHAR(255);
ALTER TABLE "email_tokens" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
