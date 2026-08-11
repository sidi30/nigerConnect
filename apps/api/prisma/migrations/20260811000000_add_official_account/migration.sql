-- Compte officiel NigerConnect : la voix de l'application.
--
-- Un compte porteur du drapeau `is_official` n'est pas un membre : il est retiré
-- des surfaces de découverte (recherche, suggestions, carte, proximité) et
-- personne ne peut lui ouvrir une conversation. En échange il s'adresse à tout
-- le monde : notification, message direct, story, publication publique.

ALTER TABLE "users"
    ADD COLUMN "is_official" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "official_since" TIMESTAMPTZ;

-- Un seul compte officiel en pratique : l'index le retrouve sans balayer la
-- table à chaque action de la console.
CREATE INDEX "users_is_official_idx" ON "users"("is_official");

-- Journal des diffusions : accusé de réception, compteurs et historique de ce
-- qui a déjà été dit à la communauté.
CREATE TYPE "OfficialBroadcastKind" AS ENUM ('notification', 'message');
CREATE TYPE "OfficialBroadcastStatus" AS ENUM ('sending', 'sent', 'failed');

CREATE TABLE "official_broadcasts" (
    "id" UUID NOT NULL,
    "kind" "OfficialBroadcastKind" NOT NULL,
    "status" "OfficialBroadcastStatus" NOT NULL DEFAULT 'sending',
    "title" VARCHAR(140) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    -- 'all' = tous les comptes actifs, 'user' = un destinataire unique.
    "audience" VARCHAR(20) NOT NULL DEFAULT 'all',
    "target_id" UUID,
    "link_path" VARCHAR(200),
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "official_broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "official_broadcasts_created_at_idx" ON "official_broadcasts"("created_at");

ALTER TABLE "official_broadcasts"
    ADD CONSTRAINT "official_broadcasts_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
