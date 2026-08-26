-- Dérogation de majorité : un admin atteste qu'un profil qu'il connaît est
-- majeur, quand aucune date de naissance n'est disponible (document déjà purgé,
-- compte vérifié de longue date).
--
-- Traçable (qui, quand, pourquoi) et révocable. Elle ne comble qu'une ABSENCE de
-- date : dès qu'une date existe, c'est elle qui décide, mineur compris.

ALTER TABLE "users"
  ADD COLUMN "adult_override_at" TIMESTAMPTZ,
  ADD COLUMN "adult_override_by" UUID,
  ADD COLUMN "adult_override_reason" TEXT;
