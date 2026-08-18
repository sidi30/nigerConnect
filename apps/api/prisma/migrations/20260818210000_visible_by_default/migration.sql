-- Un réseau où l'on ne voit personne ne sert à rien.
--
-- Constat du 18/08/2026 : 218 membres sur 245 avaient `show_on_map = false`,
-- non par choix mais parce que c'était le défaut. La carte affichait 27
-- personnes sur 245, et aucun réglage d'administration ne pouvait y remédier —
-- la visibilité communautaire lève les barrières de profil, jamais l'opt-in de
-- localisation. Même chose pour `privacy_level = friends`, jamais choisi.
--
-- On inverse les deux défauts. Les NOUVEAUX comptes sont visibles d'emblée.

ALTER TABLE "users" ALTER COLUMN "show_on_map" SET DEFAULT true;
ALTER TABLE "users" ALTER COLUMN "privacy_level" SET DEFAULT 'public';

-- Les comptes EXISTANTS restés sur `friends` n'ont jamais rien choisi : c'était
-- le défaut. On les passe en `public` — ce qui ne change d'ailleurs rien à ce
-- qu'ils voient aujourd'hui, puisque `global_full_visibility` est actif.
--
-- Les comptes en `private`, eux, ont fait une démarche explicite. On n'y touche
-- PAS : écraser un choix de confidentialité délibéré est la seule chose ici qui
-- trahirait réellement quelqu'un.
UPDATE "users" SET "privacy_level" = 'public' WHERE "privacy_level" = 'friends';

-- `show_on_map` des comptes existants : volontairement NON modifié ici. C'est de
-- la localisation, pas un profil, et 218 personnes ne l'ont jamais activée. La
-- bascule se fait depuis la console, en connaissance de cause.
