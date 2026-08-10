-- Instant de nomination du badge ambassadeur.
--
-- La console pouvait lister QUI est ambassadeur, jamais depuis quand. Posé par
-- l'admin en même temps que le badge, effacé quand on le retire.
--
-- Rétro-actif impossible : les badges déjà attribués n'ont laissé aucune trace
-- datée (setAmbassador n'était pas audité). Ils restent donc à NULL, et
-- l'interface affiche « date inconnue » plutôt qu'une date inventée.
ALTER TABLE "users" ADD COLUMN "ambassador_since" TIMESTAMPTZ;

-- La console liste les ambassadeurs du plus récemment nommé au plus ancien.
CREATE INDEX "users_ambassador_since_idx" ON "users" ("ambassador_since" DESC)
  WHERE "is_ambassador" = TRUE;
