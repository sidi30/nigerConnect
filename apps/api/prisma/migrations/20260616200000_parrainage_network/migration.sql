-- Parrainage v2 — réseau : liens réutilisables, plus de quota/expiry, droit lien-masse.

-- Type d'invitation : single_use (email/code, 1 acceptation) vs reusable (lien de masse).
CREATE TYPE "InvitationKind" AS ENUM ('single_use', 'reusable');

ALTER TABLE "invitations" ADD COLUMN "kind" "InvitationKind" NOT NULL DEFAULT 'single_use';

-- Droit accordé par l'admin de créer des liens réutilisables.
ALTER TABLE "users" ADD COLUMN "can_bulk_invite" BOOLEAN NOT NULL DEFAULT false;

-- Par quelle invitation ce compte s'est inscrit (analytics réseau).
ALTER TABLE "users" ADD COLUMN "invited_via_id" UUID;

ALTER TABLE "users"
  ADD CONSTRAINT "users_invited_via_id_fkey"
  FOREIGN KEY ("invited_via_id") REFERENCES "invitations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_invited_via_id_idx" ON "users"("invited_via_id");

CREATE INDEX "invitations_inviter_id_kind_idx" ON "invitations"("inviter_id", "kind");
