-- Un appareil n'appartient qu'à UN compte : unicité sur le token seul.
--
-- Avant : @@unique([userId, token]) laissait le même token attaché à plusieurs
-- comptes. Le fan-out lit par userId, donc un compte quitté continuait de faire
-- sonner le téléphone du compte suivant — avec l'aperçu du message privé.

-- 1. Déduplication : on garde la ligne la PLUS RÉCENTE pour chaque token
--    (= la dernière session à s'être connectée sur cet appareil). `id` départage
--    les créations à la même microseconde pour rendre le résultat déterministe.
DELETE FROM "push_tokens" a
USING "push_tokens" b
WHERE a."token" = b."token"
  AND (a."created_at" < b."created_at"
       OR (a."created_at" = b."created_at" AND a."id" < b."id"));

-- 2. Bascule de l'unicité.
DROP INDEX IF EXISTS "push_tokens_user_id_token_key";
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- 3. Le fan-out interroge toujours par destinataire — garder l'index sur userId,
--    que le couple fournissait jusqu'ici en préfixe.
CREATE INDEX IF NOT EXISTS "push_tokens_user_id_idx" ON "push_tokens"("user_id");
