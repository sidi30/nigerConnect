-- Les rencontres de proximite passent en opt-OUT.
--
-- En opt-in, 3 comptes sur 305 avaient active le drapeau : aucune paire
-- eligible n'a jamais existe, et la fonctionnalite n'a pas notifie une seule
-- fois en deux mois. Une fonctionnalite de croisement a besoin de deux
-- personnes au meme endroit ; a 1 % d'adoption, la probabilite est nulle.
--
-- Ce drapeau seul n'expose rien : aucune position n'est lue tant que la
-- personne n'a pas accorde la localisation au niveau du systeme ET ouvert
-- l'app a l'ecran, la notification emise est anonyme, et voir qui est en face
-- exige une identite verifiee (cf. assertCanReveal dans geo.service.ts).
ALTER TABLE "users" ALTER COLUMN "proximity_alerts" SET DEFAULT true;

-- Bascule des comptes existants qui n'ont jamais touche au reglage. On ne
-- reveille que les comptes actifs : inutile de reactiver un compte suspendu ou
-- supprime.
UPDATE "users" SET "proximity_alerts" = true
 WHERE "proximity_alerts" = false
   AND "status" = 'active';
