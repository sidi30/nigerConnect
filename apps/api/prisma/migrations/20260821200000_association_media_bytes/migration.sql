-- B5 — compteur d'octets par association.
--
-- Additif et instantané sur une table peuplée : une colonne NOT NULL avec un
-- DEFAULT CONSTANT n'est pas recopiée ligne à ligne depuis Postgres 11 (la
-- valeur par défaut vit dans le catalogue). Aucune reprise de données n'est
-- possible de toute façon : jusqu'à aujourd'hui aucun média n'a jamais été
-- déposé sous `associations/{id}/`, ce préfixe naît avec l'ADR-002. Le
-- compteur démarre donc à 0 en disant la vérité.
ALTER TABLE "associations"
  ADD COLUMN "media_bytes" INTEGER NOT NULL DEFAULT 0;
