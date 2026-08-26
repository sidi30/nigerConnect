-- La date de naissance servant au contrôle 18+ de la proximité vivait
-- uniquement sur identity_documents. Ce document est détruit (ou désormais
-- archivé) 30 jours après examen : la preuve de majorité disparaissait avec lui
-- et le membre perdait la proximité, alors que son badge vérifié restait.
--
-- On la porte sur le compte, où elle survit au cycle de vie du document.

ALTER TABLE "users" ADD COLUMN "date_of_birth" DATE;

-- Reprise de l'existant : la dernière date connue sur un document validé.
UPDATE "users" u
SET "date_of_birth" = d."date_of_birth"
FROM (
  SELECT DISTINCT ON (user_id) user_id, date_of_birth
  FROM "identity_documents"
  WHERE status = 'approved' AND date_of_birth IS NOT NULL
  ORDER BY user_id, reviewed_at DESC NULLS LAST
) d
WHERE u.id = d.user_id AND u."date_of_birth" IS NULL;

-- Les comptes dont le document a déjà été purgé ne sont pas récupérables ici :
-- leur date est perdue. Ils apparaissent dans l'écran admin « majorité
-- manquante » et doivent être ressaisis ou revérifiés.
