# ADR — Marketplace « Entraide » (Sprint S4 / E-MARKET)

**Version:** 1.0
**Date:** 2026-07-02
**Statut:** Accepted
**Architecte:** gwani-architect
**Épic:** E-MARKET (« sexy mais SECONDAIRE », fondu sous « Entraide »)
**Portée:** ADR + contrat API uniquement. **Aucun code, aucune migration, aucune install dans ce sprint de conception.**

---

## Vue d'ensemble

On fait évoluer le module `marketplace` existant (`ServiceRequest`) en surface **« Entraide »** à intention double : **demandes d'aide GRATUITES en premier (landing)** et **annonces/services PAYANTS en section secondaire** (jamais le défaut). L'ajout technique se limite à : (1) un modèle **`ServiceMedia`** 1-N calqué sur `PostMedia` pour une galerie ordonnée, (2) un champ **`intent`** discriminant gratuit/payant, (3) le **flux d'upload S3 déjà éprouvé** (presign → upload client → `assertOwnedPublicImage`). Zéro paiement in-app, zéro dépendance payante, zéro nouveau module natif mobile.

Cadre non négociable (rappel `status.json` hardRules) : gratuit + OSS + auto-hébergeable, coût infra ~0, pas de scope creep, item fini à 100 % (Zod + AuthZ/IDOR + tests verts + revue) plutôt que beaucoup à 80 %.

---

## ADR-001 — Médias : modèle `ServiceMedia` 1-N (vs `String[]`)

**Contexte:**
`ServiceRequest` n'a **aucun** champ image aujourd'hui. Une annonce/service et même une demande d'aide gagnent une galerie (photo d'un logement, d'un objet, d'un local). Il faut un ordre stable, des vignettes et un blurhash pour un chargement fluide — exactement ce que `PostMedia` fournit déjà pour les posts.

**Décision:**
Créer un modèle **`ServiceMedia`** en relation 1-N vers `ServiceRequest`, **calqué sur `PostMedia`** (`mediaUrl`, `thumbnailUrl`, `blurhash`, `width`, `height`, `sortOrder`, `onDelete: Cascade`). `mediaType` reste dans le modèle pour l'homogénéité mais est **contraint à `image`** en V1 (pas de vidéo marketplace). C'est l'idiome existant du codebase (posts, stories) → cohérence, réutilisation du rendu galerie et du flux S3.

**Alternatives considérées:**
- **`String[]` (Postgres text array sur `ServiceRequest`)** — Simple, une seule table. / Pas de `sortOrder` explicite (ordre = index, fragile au reorder), pas de vignette/blurhash → chargement moins fluide, pas de métadonnées, incohérent avec `PostMedia`. → **Rejetée** : perte de la galerie ordonnée + thumbnails demandée, et divergence de pattern.
- **JSON column `media Json[]`** — Flexible sans table. / Non requêtable proprement, pas de contrainte, pas d'index, casse l'idiome relationnel Prisma du repo. → **Rejetée**.

**Conséquences:**
- ✅ Galerie ordonnée (`sortOrder`), vignettes + blurhash → même UX fluide que le feed.
- ✅ Réutilise `assertOwnedPublicImage` et le rendu média existant côté mobile.
- ✅ Migration **purement additive** (nouvelle table + FK), zéro breaking change sur l'existant.
- ⚠️ Une jointure de plus au `detail`/`list` (négligeable, indexée par `requestId` comme `post_media`).

### Schéma Prisma cible (nouveau modèle + relation)

```prisma
model ServiceMedia {
  id           String         @id @default(uuid()) @db.Uuid
  requestId    String         @map("request_id") @db.Uuid
  request      ServiceRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  mediaUrl     String         @map("media_url") @db.VarChar(500)
  thumbnailUrl String?        @map("thumbnail_url") @db.VarChar(500)
  mediaType    MediaType      @map("media_type")   // contraint `image` en V1 côté Zod
  width        Int?
  height       Int?
  blurhash     String?        @db.VarChar(100)
  sortOrder    Int            @default(0) @map("sort_order")

  @@index([requestId])
  @@map("service_media")
}
```

Ajout côté `ServiceRequest` (relation inverse + champ intention) :

```prisma
model ServiceRequest {
  // ...champs existants inchangés...
  intent  ServiceIntent @default(help_free)          // ADR-002
  media   ServiceMedia[]                             // ADR-001
  // index existants inchangés + un index pour la section gratuite/payante :
  // @@index([intent, status, createdAt(sort: Desc)])
}

enum ServiceIntent {
  help_free
  paid_service
}
```

**Migration** : additive uniquement — `CREATE TABLE service_media`, `ALTER TABLE service_requests ADD COLUMN intent ... DEFAULT 'help_free' NOT NULL`, `CREATE TYPE ServiceIntent`, nouvel index. Les lignes existantes deviennent `help_free` (elles n'ont pas de budget → cohérent). Déploiement via `prisma migrate deploy`, aucun backfill risqué, **réversible** (drop table + drop column).

---

## ADR-002 — Champ `intent` explicite (vs déduction depuis `budget`)

**Contexte:**
La décision produit impose un formulaire **intention-first** : « J'ai besoin d'aide » (gratuit, aucun tarif) **par défaut** vs « Je propose un service » (révèle tarif + champs pro). La liste doit afficher la **section gratuite en premier**, le payant en secondaire. Il faut un discriminant fiable, indexable, non ambigu.

**Décision:**
Ajouter un enum **`intent { help_free, paid_service }`**, `@default(help_free)`. `budget` reste **nullable** et n'a de sens que si `intent = paid_service` (validé côté Zod : interdit/ignoré si `help_free`). L'`intent` pilote l'arbre de champs du formulaire, le tri de la liste (gratuit d'abord) et un filtre dédié.

**Alternatives considérées:**
- **Déduire `paid` = `budget != null`** — Zéro champ ajouté. / Ambigu (un demandeur gratuit pourrait écrire un budget indicatif ; un pro peut proposer un service « sur devis » sans montant), non indexable proprement, couple l'UX à un champ optionnel. → **Rejetée** : le discriminant produit doit être explicite et stable.
- **Table/statut séparé** — Sur-ingénierie pour un booléen sémantique. → **Rejetée**.

**Conséquences:**
- ✅ Landing « aide gratuite » = `WHERE intent = help_free` trié récent/urgent ; section payante = `intent = paid_service`, jamais le défaut.
- ✅ Formulaire déterministe (un seul `intent` pilote les champs révélés).
- ✅ Index `(intent, status, createdAt desc)` → sections performantes.
- ⚠️ `budget` devient « payant uniquement » : règle métier à faire respecter côté Zod (refino selon `intent`).

---

## ADR-003 — Upload multi-images : réutiliser le flux S3 owner-bound

**Contexte:**
Le repo interdit de persister une URL client brute (CLAUDE.md). Le flux profil/posts existe déjà : `presignUpload(userId, contentType, kind)` → clé `users/{userId}/{kind}/...` → upload client direct → à la création, chaque URL passe par `S3Service.assertOwnedPublicImage(url, userId)` qui **rejette** toute clé n'appartenant pas à l'owner et renvoie l'URL CDN canonique (cf. `posts.service.ts` l.67-79, `association`, `chat`).

**Décision:**
`create`/`update` acceptent un tableau de médias (URLs presignées côté client), **max 6**, chaque `mediaUrl` **bindé via `assertOwnedPublicImage(url, authorId)`** exactement comme les posts ; on persiste l'URL canonique retournée. Réutiliser `presignUpload` avec `kind: 'photo'` (clé `users/{userId}/photo/...`, bucket public) — **aucun nouveau endpoint de presign**, l'existant `POST /profile/uploads/presign` suffit.

**Alternatives considérées:**
- **Accepter `string[]` d'URLs brutes** — Le plus simple côté client. / **Faille** : un attaquant binde l'URL d'un tiers → on garde le contrat objet + `assertOwnedPublicImage` obligatoire. `string[]` accepté comme forme minimale **seulement** si chaque entrée passe par le même guard ; on privilégie l'objet (blurhash/thumbnail) pour l'UX.
- **Nouveau kind S3 `service`** — Isolation logique. / Aucun bénéfice (même bucket public, même owner-prefix), coût nul de rester sur `photo`. → **Rejetée** (non nécessaire).

**Conséquences:**
- ✅ Zéro surface d'attaque nouvelle : même guard IDOR-média que posts/stories/chat.
- ✅ Zéro nouveau module natif : `expo-image-picker` est **déjà** utilisé (upload photos profil) → sélection multiple = option JS du picker, **OTA-safe**.
- ⚠️ `update` = **remplacement complet** de la galerie (delete + recreate des `ServiceMedia`) : simple, ordonné, pas de diff partiel (dette acceptée, suffisant pour éditer une annonce).

---

## Modèle de données (récap)

- `ServiceRequest` (existant, +2 ajouts) : `+ intent ServiceIntent @default(help_free)`, `+ media ServiceMedia[]`.
- `ServiceMedia` (nouveau, 1-N, cascade) : galerie ordonnée `sortOrder`, `thumbnailUrl`/`blurhash`.
- `budget` : nullable, sémantique « payant uniquement » (Zod le rejette si `help_free`).
- Inchangés : `ServiceResponse`, `ServiceRating`, enums `ServiceCategory/Urgency/Status`.

**Règles d'intégrité :**
- Suppression d'une `ServiceRequest` → cascade sur `ServiceMedia`, `ServiceResponse`, `ServiceRating` (déjà cascade).
- Une annonce appartient à 1 auteur ; médias liés à 1 `requestId`.
- `intent = help_free` ⇒ `budget = null` (contrainte applicative Zod, pas DB, pour rester additif et réversible).

---

## Contrat API (résumé — détail dans `memory/emarket-api-contracts.json`)

Base `/api`, préfixe module `/services`. Endpoints existants conservés ; **ajouts en gras**.

| Méthode | Route | Auth | Change | Description |
|---------|-------|------|--------|-------------|
| POST | /services | Oui | **+`intent`, +`media[]`** | Créer (aide gratuite OU service payant) |
| GET | /services | Oui | **+filtre `intent`, tri gratuit-d'abord** | Liste paginée (section gratuite landing) |
| GET | /services/:id | Oui | **+`media[]` ordonné** | Détail + galerie |
| **PATCH** | **/services/:id** | **Oui (owner)** | **NOUVEAU** | Éditer champs + remplacer galerie |
| **DELETE** | **/services/:id** | **Oui (owner)** | **NOUVEAU** | Supprimer sa demande/annonce |
| GET | /services/mine | Oui | inchangé | Mes demandes |
| POST | /services/:id/respond | Oui | inchangé | Répondre (≠ auteur) |
| GET | /services/:id/responses | Oui (owner) | inchangé | Voir les réponses |
| PATCH | /services/:id/resolve | Oui (owner) | inchangé | Clôturer |
| POST | /services/:id/rate | Oui (owner) | inchangé | Noter un répondant (module review existant) |

**Zod (bornes clés):** `media` = array d'objets `{ mediaUrl(url,max500), thumbnailUrl?, mediaType:'image', width?, height?, blurhash?(max100), sortOrder? }`, **`.max(6)`** ; `intent = enum(['help_free','paid_service']).default('help_free')` ; `budget` refusé si `help_free` (`superRefine`). Liste : `+ intent?` dans le filtre, `sort` par défaut expose le gratuit d'abord côté client (deux requêtes/segments) — le backend reste un simple filtre `intent`.

**AuthZ / anti-IDOR:** `PATCH`/`DELETE` vérifient `authorId === me.sub` → sinon **403** (idiome `resolve`/`rate` existant). Chaque `mediaUrl` passe `assertOwnedPublicImage(url, me.sub)` → **rejet** si clé non-owner. Aucune query privée non filtrée.

---

## Refonte navigation « Entraide »

**Tab-bar (`app/(tabs)/_layout.tsx`) :** renommer l'onglet `services` — `title: 'Services'` → **`'Entraide'`**, icône `briefcase` → **`heart`** (ou `life-buoy`, cohérent « entraide »). Aucun changement de route (`services.tsx` reste), pas de 7e onglet.

**Landing `services.tsx` (« Entraide ») :**
1. **Section 1 (défaut, en haut) — « Besoin d'aide »** : liste `intent = help_free`, triée récent/urgent. C'est le cœur, gratuit, mis en avant. CTA proéminent « J'ai besoin d'aide ».
2. **Section 2 (secondaire, scroll/onglet segmenté sous la première) — « Services (payant) »** : liste `intent = paid_service`, jamais le défaut, visuellement en retrait. CTA discret « Je propose un service ».
   Deux appels `list({ intent })` ou un segmented control ; ne jamais afficher le payant en premier.

**Formulaire intention-first (`services/new.tsx`) :** premier choix = **intent** (`help_free` sélectionné par défaut).
- `help_free` → champs : `title`, `description`, `category`, `urgency`, `city`, `countryCode`, `media[]`. **Pas de champ tarif.**
- `paid_service` → révèle en plus : **`budget`** (tarif) + éventuels champs pro (déjà couverts par `category`/`description`). `urgency` peut être masqué/facultatif.
  Un seul écran, arbre de champs piloté par `intent`.

**Page détail (`services/[id].tsx`) :** galerie responsive `media[]` (ordre `sortOrder`, blurhash au chargement, réutilise le composant média du feed), auteur **vérifié** (`identityStatus`/`isAmbassador` déjà dans `AUTHOR_SELECT`), badge tarif si `paid_service`, **« Contacter » en 1 tap → ouvre le chat existant** (`/chat/...` via création/ouverture de conversation), avis via le **module review existant** (`ServiceRating`, flux `resolve` → `rate`).

**`services/servicesApi.ts` :** `create`/`update` reçoivent `intent` + `media`, `list` accepte `intent`, `get` renvoie `media`. Ajouter `update(id, ...)` et `remove(id)`. **Aucun commerce dans Fil ni Carte** (inchangés).

**shared-types :** `+ intent`, `+ media: ServiceMedia[]` sur `ServiceRequest`, nouveau type `ServiceMedia` (calqué sur `PostMedia`). Rebuild `@nigerconnect/shared-types` avant de typer api/mobile.

---

## Découpage en incréments

**Backend (deploy API — dernier commit + `prisma migrate deploy`) :**
1. Migration additive : `ServiceMedia` + `intent` enum/colonne + index `(intent,status,createdAt)`. `prisma generate`.
2. shared-types : `ServiceMedia`, `intent`, `media[]` → build.
3. DTO Zod : `serviceMediaSchema` (mirror `postMediaSchema`, `image` only, `.max(6)`), `intent` + refino `budget`, `intent?` dans `listServicesSchema`, `updateServiceSchema`.
4. Service/Controller : `create` (bind média + intent), `list` (filtre `intent`), `getById` (`include: media` ordonné), **`update` (owner + remplace galerie)**, **`delete` (owner)**.
5. Tests jest : bind média owner (rejet URL tierce), AuthZ update/delete (403 non-owner), `budget` refusé si `help_free`, liste filtrée par `intent`. `tsc` vert.

**Frontend (JS-only, OTA-safe) :**
6. Tab-bar rename + icône.
7. `servicesApi` : `intent`/`media`/`update`/`remove`.
8. Landing 2 sections (gratuit d'abord), formulaire intention-first, page détail galerie + contacter→chat + avis.
9. `tsc` mobile vert.

**DoD :** Zod + AuthZ/IDOR + privacy + tests verts + revue `gwani-reviewer` + verdict `gwani-pentest` (focus : bind média, IDOR update/delete, pas de fuite d'un compte via une annonce).

---

## Verdict OTA-safe / bump version

- **Aucun nouveau module natif** : `expo-image-picker` est **déjà** embarqué (upload photos profil). La sélection multiple = option JS (`allowsMultipleSelection`) → **pas de rebuild EAS**. Rendu galerie = composants JS existants (feed).
- **Mobile = 100 % JS/assets → OTA-safe.** Livraison par `eas update --channel preview`, **`runtimeVersion 1.8.0 inchangée**. Un bump `app.json version` **orphelinerait l'OTA** (comme noté au sprint S3) → **ne PAS bumper pour livrer**.
- **API = migration + nouvelles routes → deploy obligatoire** (dernier commit, `prisma migrate deploy`, backup pré-deploy). **Ordre imposé : déployer l'API AVANT de pousser l'OTA** (le mobile appelle `intent`/`media`/`update`/`delete`).
- **Convention proprio « bump sur gros changement »** : entre en conflit avec l'OTA-safe. **Recommandation** : rester en `1.8.0` pour cette livraison OTA ; regrouper un éventuel bump avec le **prochain rebuild natif** (p.ex. ANIM-2 carte native). ⇒ *question ouverte proprio* ci-dessous.

---

## Confidentialité / sécurité

- **Service-requests publics par nature — CONFIRMÉ.** Une demande d'aide / annonce est destinée à être vue de tous les membres authentifiés (idiome actuel : `list`/`getById` ne filtrent pas par confidentialité). Pas de niveau `private` sur `ServiceRequest`. Conséquence à assumer produit : publier une annonce = s'exposer publiquement (auteur affiché). **Un compte `private` reste protégé sur Carte/feed/recherche/proximité** ; l'onglet Entraide est une surface d'exposition **volontaire** (l'utilisateur choisit de poster). Rien de nouveau ne fuite : `AUTHOR_SELECT` n'expose ni email ni position.
- **Médias jamais d'URL client brute** : `assertOwnedPublicImage(url, authorId)` sur chaque `mediaUrl` (rejet clé non-owner → pas de tracking-pixel/hotlink d'un tiers), URL CDN canonique persistée. Identique posts/stories/chat.
- **IDOR** : `update`/`delete` gardés par `authorId === me.sub` (403 sinon), pas de query privée non filtrée, `ParseUUIDPipe` sur `:id`.
- **DoS/abus** : `media.max(6)`, tailles bornées par `assertOwnedPublicImage` (caps image existants), rate-limit global inchangé.

---

## Hypothèses techniques

- `expo-image-picker` supporte `allowsMultipleSelection` sur les versions embarquées iOS/Android (V1.8.0) → à **confirmer** au build frontend (sinon : sélection séquentielle mono-image, toujours OTA-safe).
- Le composant galerie du feed est réutilisable tel quel pour le détail (sinon léger wrapper JS).
- La création/ouverture de conversation depuis « Contacter » réutilise l'API chat existante (pas de nouvelle route).

---

## Questions ouvertes (proprio)

1. **Bump version mobile ?** OTA-safe ⇒ techniquement pas de bump (le bump orphelinerait l'OTA). La convention « bump sur gros changement » est-elle levée ici, ou regroupe-t-on le bump avec le prochain rebuild natif ? *(reco : rester 1.8.0)*.
2. **Icône onglet** « Entraide » : `heart` vs `life-buoy` vs `users` ?
3. **Vidéo dans les annonces** : hors V1 (image only) — confirmer que c'est acceptable (`mediaType` prêt pour l'étendre plus tard sans migration).
4. **`update` = remplacement complet de la galerie** (pas de diff partiel) : acceptable en V1 ?
