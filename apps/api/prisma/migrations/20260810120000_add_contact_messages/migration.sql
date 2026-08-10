-- Messages de contact envoyés depuis l'app (partenariat, info, problème).
-- Ils alimentent la boîte de réception de la console admin.

CREATE TYPE "ContactTopic" AS ENUM ('partnership', 'info', 'problem', 'other');
CREATE TYPE "ContactStatus" AS ENUM ('new', 'read', 'handled');

CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    -- NULL = expéditeur sans compte (formulaire public web à venir), ou compte
    -- supprimé depuis : ON DELETE SET NULL préserve la demande de partenariat.
    "user_id" UUID,
    "topic" "ContactTopic" NOT NULL DEFAULT 'info',
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(32),
    "subject" VARCHAR(140) NOT NULL,
    "message" VARCHAR(4000) NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'new',
    "handled_by_id" UUID,
    "handled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- Liste admin : filtre par statut, tri antéchronologique.
CREATE INDEX "contact_messages_status_created_at_idx" ON "contact_messages"("status", "created_at");
CREATE INDEX "contact_messages_user_id_idx" ON "contact_messages"("user_id");

ALTER TABLE "contact_messages"
    ADD CONSTRAINT "contact_messages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
