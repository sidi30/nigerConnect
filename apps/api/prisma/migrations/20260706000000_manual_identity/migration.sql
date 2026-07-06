-- Manual identity verification (admin, no uploaded document).
-- Lets an admin approve/revoke a user's identity without a submitted piece:
--  * file_url becomes nullable — a manual approval has no file to point at.
--  * document_type already accepts free VARCHAR values → 'manual' needs no change.
--  * reason: free-text justification recorded by the admin at manual approve/revoke,
--    kept separate from rejection_reason (the user-facing rejection motive) for audit.
ALTER TABLE "identity_documents" ALTER COLUMN "file_url" DROP NOT NULL;
ALTER TABLE "identity_documents" ADD COLUMN "reason" TEXT;
