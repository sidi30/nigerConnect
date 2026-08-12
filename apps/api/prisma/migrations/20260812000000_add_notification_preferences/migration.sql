-- Préférences de notifications push, par catégorie.
-- Opt-OUT : tout le monde (comptes existants compris) démarre avec TOUT activé.
-- Additif + NOT NULL DEFAULT true → aucun backfill applicatif, aucune coupure.
ALTER TABLE "users"
  ADD COLUMN "notify_messages"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_social"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_reactions" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_groups"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_proximity" BOOLEAN NOT NULL DEFAULT true;
