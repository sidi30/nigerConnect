-- Archivage intermédiaire (RGPD) des pièces d'identité.
--
-- La pièce quitte la base active au bout de 30 jours mais n'est plus détruite :
-- elle est scellée chiffrée dans un coffre object-lock. Ces deux tables portent
-- uniquement les métadonnées non identifiantes + le journal d'ouverture.
--
-- `identity_archives.user_id` est volontairement SANS clé étrangère vers users :
-- l'archive doit survivre à la suppression du compte (le cascade la viderait).

CREATE TABLE "identity_archives" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "document_type" VARCHAR(30) NOT NULL,
    "vault_key" VARCHAR(500) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_at" TIMESTAMPTZ NOT NULL,
    "retain_until" TIMESTAMPTZ NOT NULL,
    "account_deleted_at" TIMESTAMPTZ,
    "purged_at" TIMESTAMPTZ,

    CONSTRAINT "identity_archives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "identity_archives_vault_key_key" ON "identity_archives"("vault_key");
CREATE INDEX "identity_archives_user_id_idx" ON "identity_archives"("user_id");
CREATE INDEX "identity_archives_purge_at_idx" ON "identity_archives"("purge_at");

CREATE TABLE "identity_archive_accesses" (
    "id" UUID NOT NULL,
    "archive_id" UUID NOT NULL,
    "operator" VARCHAR(255) NOT NULL,
    "reason" TEXT NOT NULL,
    "accessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_archive_accesses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "identity_archive_accesses_archive_id_idx" ON "identity_archive_accesses"("archive_id");

ALTER TABLE "identity_archive_accesses"
    ADD CONSTRAINT "identity_archive_accesses_archive_id_fkey"
    FOREIGN KEY ("archive_id") REFERENCES "identity_archives"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
