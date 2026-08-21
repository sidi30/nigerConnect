# Backlog — Espace association

> Rédigé le 2026-08-20 par `gwani-orchestrator` (PO + SM).
> Sources : demande propriétaire du 2026-08-20, `memory/market.md` §2026-08-20,
> analyse de risques `gwani-challengeur`, lecture du code existant.
> Règle projet : **zéro solution payante** (`memory/zero-solution-payante.md`).

## Sprint Goal global

> Donner aux associations de la diaspora un espace qu'elles administrent elles-mêmes —
> visible, crédible et sûr — sans que NigerConnect touche jamais à l'argent
> ni ne transforme ses adhérents en annuaire aspirable.

**Cette demande est trop grosse pour un seul sprint.** Elle couvre 7 capacités dont
3 (back-office, carte, site public) sont chacune un sprint à elles seules. Le découpage
ci-dessous est ordonné pour que **chaque incrément soit utilisable seul**, même si les
suivants ne sont jamais faits.

---

## Décisions structurantes — TRANCHÉES le 2026-08-21

Le propriétaire a délégué l'arbitrage. Chaque réponse est motivée par une contrainte
déjà écrite du projet, pas par une préférence.

### Q1 — L'adhésion peut-elle être payante ? → **NON. Cotisation gratuite et déclarative.**

NigerConnect ne touche jamais à l'argent. Encaisser une cotisation, c'est un prestataire
de paiement (commission, KYC, obligations réglementaires sur des flux diaspora → Niger),
et cela contredit frontalement la règle *zéro solution payante*. Le bureau enregistre
lui-même qui est à jour de cotisation ; l'argent circule hors de la plateforme, comme
aujourd'hui. Conséquence assumée : le statut de cotisation est **déclaratif**, donc
falsifiable par le bureau — c'est acceptable, le bureau est déjà la source de vérité.

### Q2 — Comment se connecte-t-on au back-office ? → **Compte personnel + élévation de rôle.**

Jamais un compte « association » partagé. A3 vient d'installer un journal d'audit des
changements de rôle : un identifiant partagé le rend décoratif — on ne saurait plus QUI a
agi, et on ne pourrait pas révoquer une seule personne quand elle quitte le bureau.
Bénéfice second : aucun second système d'authentification à maintenir.

### Q3 — Comment vérifie-t-on une carte d'adhérent ? → **QR → page de vérification serveur.**

Token opaque ≥ 128 bits, révocable, rotation à la révocation. Une signature vérifiable
hors-ligne imposerait une gestion de clés (rotation, révocation, distribution) sans gain
réel : celui qui contrôle une carte a du réseau. PDF via `pdfkit`, **jamais**
puppeteer/chromium — l'API est plafonnée à 1 Go sur un VPS mutualisé.

### Q4 — Quel domaine pour le site public ? → **Sous-chemin `nigerconnect.app/asso/{slug}`.**

Un sous-domaine par association coûterait un certificat et une entrée DNS par association,
donc de l'exploitation manuelle et une surface de squat supplémentaire — pour un bénéfice
nul tant qu'aucune association ne réclame sa propre marque. Le sous-chemin est gratuit,
sert l'autorité du domaine principal, et l'anti-squat du `slug` (A6) le protège déjà.
`noindex` par défaut, comme prévu au Sprint 6.

### Q5 — Quel badge pour une association certifiée ? → **Écusson ambre, distinct de la vérification d'identité.**

Déjà livré au Sprint 1 : la FORME dit la famille d'entité, la COULEUR et l'icône disent la
revendication. Une association certifiée ne doit jamais emprunter le badge d'une personne
dont la pièce d'identité a été vérifiée — ce sont deux affirmations différentes.

### Q6 — Un adhérent doit-il avoir un compte NigerConnect ? → **NON, mais la fiche sans compte est bornée.**

C'est la décision qui commande le modèle de données des sprints 3 à 5.

Exiger un compte rendrait le module inutile pour les associations réelles : leurs adhérents
comptent des anciens, des gens restés au pays sans smartphone. Le bureau créerait alors de
faux comptes pour les représenter — pire résultat, données fausses ET comptes fantômes.

Mais une fiche d'adhérent est une donnée personnelle sur quelqu'un qui n'a rien accepté.
D'où les bornes, **non négociables** au Sprint 3 :

1. La fiche appartient à l'association, pas à NigerConnect : minimum vital (nom + un moyen
   de contact), rien d'autre.
2. Elle n'entre **jamais** dans le graphe social : ni carte, ni recherche, ni fil, ni
   proximité, ni suggestion d'amis. Elle n'existe que dans l'espace de son association.
3. Elle ne reçoit **aucune** notification. Un courriel n'est possible que par la liste de
   diffusion du Sprint 5, dont les prérequis (séparation des identités d'envoi) restent
   bloquants.
4. Elle ne peut pas être membre du bureau : un poste au bureau exige un compte, sinon le
   journal d'audit A3 pointe vers un fantôme.
5. Rattachement par invitation : la personne relie elle-même la fiche à son compte, et rien
   de social ne se produit avant ce geste.
6. Suppression à la demande de la personne, et l'association est responsable de traitement
   pour ces fiches — **à écrire dans les CGU avant la mise en service du Sprint 3**.

> Le Sprint 3 n'est plus bloqué.

---

## Sprint 1 — « Le socle association devient sûr et lisible » ✅ LIVRÉ

**Goal :** avant d'ouvrir un back-office aux associations, refermer les fuites que ce
back-office amplifierait, et poser la gouvernance (bureau exécutif, certification)
dont tous les sprints suivants dépendent.

Ce sprint est **utilisable seul** : les associations existantes gagnent un bureau
exécutif affiché et un badge de certification distinct, et trois fuites de production
sont refermées.

| # | Item | Valeur | Effort | Prio |
|---|------|--------|--------|------|
| A1 | Fermer l'annuaire des membres (fuite prod) | Critique | S | 1 |
| A2 | Plus d'association orpheline à la suppression de compte (fuite prod) | Critique | S | 2 |
| A3 | Gouvernance : `owner` non rétrogradable + journal d'audit | Élevée | M | 3 |
| A4 | Bureau exécutif (titres, photo, ordre d'affichage) | Élevée | M | 4 |
| A5 | Certification association : traçabilité + badge distinct | Élevée | M | 5 |
| A6 | `slug` unique + nom unique (anti-squat, prépare le site public) | Moyenne | S | 6 |

### A1 — Fermer l'annuaire des membres

> En tant qu'adhérent d'une association religieuse ou politique, je veux que mon
> appartenance ne soit pas consultable par n'importe quel inscrit, afin de ne pas
> exposer ma famille restée au pays.

**Constat vérifié dans le code (pas une hypothèse) :**
`apps/api/src/association/association.controller.ts:115` — `GET /associations/:id/members`
n'a ni `@CurrentUser` ni `assertRole`. `listMembers` (`association.service.ts:418`)
retourne `displayName, firstName, lastName, avatarUrl, city, countryCode` pour tous les
membres `approved`, **sans filtrer `privacyLevel`, ni `showOnMap`, ni les blocages, ni
`isAnimated`**. `JwtAuthGuard` étant global (`apps/api/src/auth/auth.module.ts:37`),
la route n'est pas anonyme — mais **tout compte authentifié** peut énumérer l'annuaire
nominatif de n'importe quelle association. La catégorie `religieux` existe déjà dans
`dto/association.dto.ts:11` → donnée sensible RGPD art. 9.

C'est le trou dans le dispositif de confidentialité que `geo.service.ts:403` respecte
pourtant partout ailleurs.

**Critères d'acceptation**
- Given un utilisateur non-membre, When il appelle `GET /associations/:id/members`, Then 403.
- Given un membre `approved`, When il liste, Then il ne voit **pas** les membres dont
  `privacyLevel = private`, ni les comptes `isAnimated`, ni ceux qu'il a bloqués / qui l'ont bloqué.
- Given un compte `private`, When il rejoint une association, Then il compte dans
  `memberCount` mais n'apparaît dans aucune liste.
- Le compteur reste public ; la liste ne l'est pas.

### A2 — Plus d'association orpheline

> En tant que propriétaire, je veux qu'aucune association ne se retrouve sans
> administrateur, afin qu'un fichier de données personnelles ait toujours un responsable.

**Constat vérifié :** `leave()` (`association.service.ts:379`) refuse la sortie du dernier
admin, mais `deleteAccount` (`apps/api/src/profile/profile.service.ts:873`) fait
`prisma.user.delete()` qui **cascade `association_members`** sans passer par ce garde-fou.
Le commentaire du code liste explicitement « association memberships » parmi les cascades.
Résultat : association vivante, adhérents, données personnelles — et zéro administrateur,
sans aucun endpoint pour en réattribuer un. `createdById` passe à NULL : plus personne
n'est identifiable comme responsable de traitement.

**Critères d'acceptation**
- Given le dernier admin d'une association, When il supprime son compte, Then le rôle est
  transféré au modérateur le plus ancien, sinon au membre `approved` le plus ancien, et le
  nouveau responsable est notifié (in-app + e-mail).
- Given aucun membre restant, When le dernier admin part, Then l'association est
  soft-delete (pas de suppression dure) et sort des listes publiques.
- Test de non-régression : le scénario exact ci-dessus, en Jest.

### A3 — Gouvernance : `owner` non rétrogradable + audit

> En tant que fondateur d'une association, je veux ne pas pouvoir être évincé par un
> administrateur que j'ai promu, afin que mon association ne me soit pas prise.

**Constat vérifié :** `changeRole` (`association.service.ts:398`) ne protège que le cas
« je me rétrograde moi-même en étant le dernier admin ». Rien n'empêche l'admin B, promu
la veille, de passer le fondateur en `member` et de garder l'association, son nom, son
badge et sa future liste de diffusion.

**Critères d'acceptation**
- Un admin ne peut pas modifier le rôle d'un autre admin (403), sauf le rôle `owner`.
- Le transfert de propriété exige l'**acceptation** du destinataire.
- Tout changement de rôle est journalisé (qui, quand, avant → après) et **notifié à la
  personne concernée**.

### A4 — Bureau exécutif

> En tant que membre, je veux voir nommément le président, le trésorier et le secrétaire
> avec leur photo, afin de savoir à qui j'ai affaire.

Distinct du rôle technique (`admin`/`moderator`/`member`) qui régit les droits : un
trésorier n'est pas forcément administrateur de la page. Deux axes séparés, ne pas les confondre.

**Critères d'acceptation**
- Un admin peut désigner des membres du bureau avec un titre
  (`president`, `vice_president`, `secretary`, `treasurer`, `spokesperson`, `other` + libellé libre)
  et un ordre d'affichage.
- Le bureau est visible par tous ceux qui voient l'association — **le titre est public,
  c'est la fonction de la feature**, mais l'inscription au bureau requiert le consentement
  explicite de la personne (elle accepte, elle peut se retirer).
- Un compte `private` peut siéger au bureau sans être exposé ailleurs.

### A5 — Certification association traçable + badge distinct

> En tant qu'utilisateur, je veux distinguer d'un coup d'œil une association vérifiée
> d'un compte personnel vérifié, afin de ne pas confondre une page officielle avec un particulier.

**Constat vérifié :** `Association.isVerified` existe en base (`schema.prisma:908`) mais
**aucun endpoint ne le pose ni ne le retire** — uniquement des lectures. Un badge qui dit
« la plateforme garantit » sans procédure d'octroi ni de retrait est un passif.

**Critères d'acceptation**
- `verifiedAt`, `verifiedBy`, `verificationNote` ajoutés ; endpoint admin d'octroi **et de retrait**.
- Badge distinct (voir Q5) sur mobile ET web, libellé au tap « Association vérifiée le … ».
- Zéro module natif ajouté → compatible OTA.

### A6 — `slug` unique + nom unique

**Constat vérifié :** aucun `@@unique` sur `Association.name` (`schema.prisma:897-921`),
aucun slug. Le premier arrivé prendra l'URL canonique du site public et le référencement
Google sur le nom de la vraie association. `identityStatus === 'approved'` prouve que la
personne est bien elle-même, **pas qu'elle a mandat pour représenter l'association**.

---

## Sprint 2 — « L'association publie depuis un ordinateur »

Back-office web (`apps/web`, host dédié comme `tenant.*`), authentification par compte
personnel de dirigeant. Publications (images ET vidéos), annonces/événements, gestion des
membres. **Prérequis : Sprint 1** (sans A3, un back-office donne les clés à n'importe quel admin).

- B1 — Auth back-office : session web sur compte NigerConnect, sélection de l'association, `assertRole`.
- B2 — Décision d'architecture **médias portés par une association** : la convention
  `users/{userId}/…` de `S3Service.assertOwnedPublicImage` ne suffit plus. À trancher en ADR
  (préfixe `associations/{id}/…` + assertion basée sur le rôle), **pas à contourner**.
- B3 — CRUD publications avec médias, réutilisant le pipeline vidéo existant.
- B4 — Gestion des membres et des demandes d'adhésion depuis le web.
- B5 — **Quota disque par association** + alerte volume AVANT d'ouvrir la vidéo.

> ⚠️ La vidéo repose sur le kill-switch `video_enabled`, **actuellement OFF**
> (`memory/status.json` : S-BETA DEPLOYED_DARK). Les publications vidéo d'association
> seront donc inertes tant que le propriétaire n'active pas le flag.

## Sprint 3 — « Les adhérents »

**Bloqué par Q6.** Notion d'adhésion distincte du membre-suiveur, statut de cotisation
déclaratif, journal append-only des changements de statut, annuaire opt-in exportable CSV
par le bureau.

## Sprint 4 — « La carte d'adhérent »

PDF via `pdfkit` (**jamais puppeteer/chromium** : l'API est plafonnée à 1 Go sur un VPS
mutualisé), QR → page de vérification serveur, token opaque ≥ 128 bits, rotation du token
à la révocation, génération à la volée sans stockage en bucket public.

## Sprint 5 — « La liste de diffusion »

**Prérequis bloquant, non négociable :** séparer les identités d'envoi bulk et
transactionnelle. Aujourd'hui `MailerService` a un seul `from`, une seule clé DKIM, un seul
relais IONOS pour les resets de mot de passe **et** les campagnes. Et
`MailerService.send()` (`apps/api/src/common/mail/mailer.service.ts:147`) **avale
l'exception et se contente de logger** : tout comptage d'échec en amont est décoratif.
La première association qui envoie à 800 adresses collectées sur papier peut dégrader la
réputation du domaine — et faire tomber les codes de vérification d'inscription **en
silence**, au moment précis du décollage (79 inscriptions les 09-10/08/2026).

## Sprint 6 — « Le site public »

`nigerconnect.app/asso/{slug}`, **`noindex` par défaut**, opt-in nominatif et révocable
pour chaque membre du bureau, seuls les contenus explicitement marqués « publiable »,
exclusion stricte des comptes `isAnimated`, purge du cache CDN intégrée au retrait de contenu.
