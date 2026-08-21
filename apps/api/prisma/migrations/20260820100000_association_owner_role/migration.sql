-- A3 — governance. Add the 'owner' value to AssociationRole ahead of the
-- governance migration that follows. Split into its own migration on purpose:
-- Postgres refuses to use a brand-new enum value inside the SAME transaction
-- that added it ("unsafe use of new value of enum type"), and the next
-- migration needs to backfill role = 'owner' on existing rows. Each migration
-- file runs in its own transaction, so by the time the governance migration
-- starts, this value is already committed and safe to use.
ALTER TYPE "AssociationRole" ADD VALUE IF NOT EXISTS 'owner';
