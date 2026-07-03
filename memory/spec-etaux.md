# Spec Produit — E-TAUX (Taux du jour + prix crowdsourcés)

**Version:** 1.0
**Date:** 2026-07-03
**Statut:** DRAFT → READY_FOR_ARCH
**Sprint:** S-BETA (« La diaspora prend vie »), item `E-TAUX`, priorité 4.0, livraison OTA-safe sur mobile 1.10.0
**Sources consultées:** `memory/backlog.md` (section E-TAUX, contraintes S-BETA), `memory/market.md` (axe 4 — gaps diaspora), `memory/status.json`, code existant (`apps/api/src/marketplace/*`, `apps/api/src/moderation/moderation.service.ts`, `apps/api/src/feed/stories.cron.ts`, `apps/api/src/common/redis/redis.service.ts`, `apps/api/prisma/schema.prisma`).

---

## Vision

E-TAUX existe pour tout membre de la diaspora nigérienne afin qu'il ait, en un coup d'œil et sans quitter son feed, le taux XOF↔EUR/USD/CAD du jour et les prix réels que la communauté paie (billet Niamey↔diaspora, frais d'envoi d'argent, kilo de colis) — remplaçant les estimations approximatives échangées aujourd'hui sur des groupes WhatsApp dispersés, parce que c'est un geste d'ouverture d'app quotidien à très faible coût d'infra.

---

## Décision clé du cadrage — source du taux (répond à la question ouverte du backlog)

Le backlog demandait : *« Si aucune source gratuite fiable ⇒ propose la saisie communautaire modérée comme fallback »*. Il existe une source gratuite fiable et je la retiens comme source primaire :

- **XOF (franc CFA UEMOA, dont le Niger) est arrimé à EUR par un traité monétaire fixe et public depuis 1999 : 1 EUR = 655,957 XOF, garanti par le Trésor français (compte d'opérations).** Ce taux ne « flotte » jamais au jour le jour — ce n'est donc **pas une donnée à aller chercher**, mais une **constante réglementaire** à coder en dur (avec commentaire + source), sans dépendance externe ni risque de rupture d'API.
- Pour **USD** et **CAD**, qui flottent contre l'EUR, la **Banque Centrale Européenne (BCE)** publie un flux **XML statique, public, gratuit, sans clé API, sans quota** (« eurofxref-daily.xml »), mis à jour un jour ouvré TARGET sur deux vers 16h CET, avec ~30 devises dont USD et CAD. C'est exactement la source « BCE/open-data » mentionnée au backlog. Réutilisation libre sous réserve de citer la source (« Banque centrale européenne »).
- **XOF/USD** et **XOF/CAD** se calculent alors par composition : `XOF/USD = 655.957 / (EUR/USD de la BCE)`, `XOF/CAD = 655.957 / (EUR/CAD de la BCE)`. Aucun calcul complexe, aucune dépendance payante.

**Conséquence sur le périmètre** : la saisie communautaire modérée **n'est PAS nécessaire pour le taux de change lui-même** (source officielle fiable disponible) — je la réserve, comme demandé, aux **prix qui n'ont structurellement aucune source officielle gratuite** : billet d'avion, frais d'envoi d'argent, prix au kilo de colis. C'est un écart mineur et assumé par rapport à la formulation « OU » du backlog ; **question ouverte marquée ci-dessous pour confirmation proprio** (voir § Questions ouvertes, Q1), avec ma recommandation.

Filet de sécurité si le flux BCE devient indisponible durablement (jamais observé historiquement, mais à prévoir) : le dernier snapshot connu continue d'être servi (fail-open sur donnée déjà validée, jamais fail-closed sur une donnée financière affichée), avec un horodatage « à jour au JJ/MM » visible — pas de bascule automatique vers une saisie utilisateur non modérée pour un taux de change (trop sensible pour être crowdsourcé sans garde-fou lourd). Un override manuel via `AppSetting` reste possible pour l'admin en dernier recours opérationnel (pas une feature utilisateur).

---

## Utilisateurs cibles

### Persona principal : Membre diaspora actif
- **Rôle :** membre inscrit, vérifié ou non, envoie/reçoit de l'argent et des colis, voyage occasionnellement Niamey↔pays d'accueil.
- **Problème :** doit deviner le taux du jour et le prix « normal » d'un service (billet, transfert, colis) en interrogeant des groupes WhatsApp dispersés et non fiables.
- **Frustration actuelle :** informations contradictoires, pas d'historique, pas de traçabilité de qui a payé quoi/quand.
- **Succès pour lui :** ouvre l'app, voit en tête de feed le taux du jour et 1-3 prix récents crédibles (votés par la communauté), gagne du temps, revient chaque jour.

### Persona secondaire : Contributeur communautaire
- **Rôle :** membre qui vient de faire un transfert/voyage/envoi de colis et veut partager le prix réel payé pour aider les autres.
- **Problème :** pas d'endroit structuré pour publier ce prix autrement qu'un post noyé dans le feed.
- **Succès pour lui :** signale un prix en 30 secondes, voit son signalement validé par des votes de confiance de la communauté.

---

## Périmètre V1 (MVP)

### Inclus
- Bandeau léger en tête de feed : taux XOF↔EUR (constante) / XOF↔USD / XOF↔CAD (dérivés BCE), horodaté.
- Signalement de prix communautaire (`CommunityPrice`) pour 3 types : billet d'avion (route), frais d'envoi d'argent (corridor + prestataire optionnel), kilo de colis (route).
- Vote de confiance (fiable / pas fiable) sur un prix signalé, 1 vote par user par prix, anti-auto-vote.
- Liste complète des prix signalés (filtrable par type/pays), au-delà du bandeau.
- Modification/suppression de son propre signalement.
- Signalement d'abus sur un prix (réutilise `Report`/`ModerationService` existants) → takedown modérateur.
- Anti-spam : throttle des soumissions par utilisateur (Redis, même primitive que le reste du produit).
- Cron interne (même idiome que `StoriesCron`) : rafraîchit le snapshot BCE périodiquement, fail-open sur le dernier snapshot connu.

### Exclus (V2+)
- Saisie communautaire du taux de change lui-même (source officielle BCE suffisante en V1 — cf. décision ci-dessus).
- Historique/graphique d'évolution des taux ou des prix dans le temps (le modèle stocke un snapshot/jour, la restitution d'un graphique est un futur incrément, coût quasi nul si demandé plus tard).
- Alertes/notifications sur variation de taux (couvert potentiellement par E-DIGEST, pas ici).
- Taxonomie de prestataires structurée pour les transferts d'argent (Western Union/Wave/RIA…) — V1 = champ texte libre optionnel, pas un référentiel fermé.
- Conversion inline dans le chat/posts (« calculatrice » intégrée ailleurs dans l'app) — hors périmètre V1, uniquement le bandeau + écran dédié.
- Notation/réputation persistante du contributeur au-delà du vote par prix (pas de score global « contributeur de confiance » en V1).

---

## Modèle de données proposé

Nouveau module `apps/api/src/rates/` (miroir de `marketplace/` : `RatesModule`, `RatesController`, `RatesService`, `dto/rate.dto.ts`, `rates.cron.ts`), enregistré dans `app.module.ts`.

### `FxRateSnapshot` (nouveau, migration Prisma)
```prisma
model FxRateSnapshot {
  id        String   @id @default(uuid()) @db.Uuid
  asOf      DateTime @unique @db.Date      // jour ouvré TARGET publié par la BCE
  eurUsd    Decimal  @db.Decimal(10, 6)
  eurCad    Decimal  @db.Decimal(10, 6)
  source    String   @default("ecb") @db.VarChar(20)
  fetchedAt DateTime @default(now()) @map("fetched_at") @db.Timestamptz

  @@index([asOf(sort: Desc)])
  @@map("fx_rate_snapshots")
}
```
- `EUR/XOF = 655.957` reste une **constante applicative** (pas de colonne DB) — commentée dans le code avec référence au traité UEMOA/Trésor français.
- `XOF/USD` et `XOF/CAD` sont **calculés à la lecture** (pas stockés), à partir du dernier `FxRateSnapshot` + constante peg.
- Une ligne par jour ouvré publié = quelques dizaines d'octets/jour, aucun risque disque.

### `CommunityPrice` (nouveau, migration Prisma)
```prisma
enum CommunityPriceType {
  billet_avion
  transfert_argent
  colis_kg
}

enum CommunityPriceStatus {
  active
  removed   // takedown modération (Report → content_removed)
}

model CommunityPrice {
  id            String                @id @default(uuid()) @db.Uuid
  submitterId   String                @map("submitter_id") @db.Uuid
  submitter     User                  @relation(fields: [submitterId], references: [id], onDelete: Cascade)
  type          CommunityPriceType
  originCity    String?               @map("origin_city") @db.VarChar(100)
  originCountry String?               @map("origin_country") @db.Char(2)
  destCity      String?               @map("dest_city") @db.VarChar(100)
  destCountry   String?               @map("dest_country") @db.Char(2)
  provider      String?               @db.VarChar(100)   // ex. "Air France", "Wave", "Western Union" — texte libre
  amount        Decimal               @db.Decimal(12, 2)
  currency      String                @db.Char(3)         // ISO 4217
  note          String?               @db.VarChar(280)
  trustScore    Int                   @default(0) @map("trust_score") // dénormalisé, MAJ transactionnelle au vote
  status        CommunityPriceStatus  @default(active)
  createdAt     DateTime              @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime              @updatedAt @map("updated_at") @db.Timestamptz

  votes CommunityPriceVote[]

  @@index([type, status, createdAt(sort: Desc)])
  @@index([type, originCountry, destCountry, status])
  @@index([submitterId])
  @@map("community_prices")
}

model CommunityPriceVote {
  userId    String         @map("user_id") @db.Uuid
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  priceId   String         @map("price_id") @db.Uuid
  price     CommunityPrice @relation(fields: [priceId], references: [id], onDelete: Cascade)
  value     Int            // 1 = fiable, -1 = pas fiable
  createdAt DateTime       @default(now()) @map("created_at") @db.Timestamptz

  @@id([userId, priceId])
  @@index([priceId])
  @@map("community_price_votes")
}
```
- Pattern de vote identique à `CommentLike`/`MessageReaction` déjà en place (clé composite `(userId, priceId)`, toggle idempotent).
- Aucun champ média — pas de dépendance à `S3Service` pour ce module.

### Extension du modèle `Report` existant (migration additive, pas de nouveau module)
```prisma
enum ReportTargetType {
  user
  post
  message
  association
  comment
  community_price   // AJOUT
}
```
- `apps/api/src/moderation/moderation.service.ts` :
  - `removeContent()` : ajouter un `case 'community_price'` → `communityPrice.update({ data: { status: 'removed' } })`.
  - `getTarget()` : ajouter un `case 'community_price'` pour l'aperçu modération (submitter, type, route, montant, devise, provider, createdAt, status).
  - Aucun autre changement au module moderation — `create`/`list`/`resolve` sont déjà génériques par `targetType`.

---

## Endpoints proposés

Nouveau contrôleur `rates` (public en lecture, comme `services`) :

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/rates/today` | public | Snapshot FX du jour (EUR/XOF constant, USD/XOF, CAD/XOF dérivés, `asOf`, `source`) |
| GET | `/rates/banner` | public | Bandeau feed = FX + 1 prix représentatif par type (le plus récent, `status=active`, `trustScore >= 0`), **caché Redis ~5 min** |
| GET | `/community-prices` | public | Liste paginée (curseur), filtres `type`, `originCountry`, `destCountry`, `status` (défaut `active`) |
| GET | `/community-prices/mine` | auth | Mes signalements |
| GET | `/community-prices/:id` | public | Détail d'un signalement |
| POST | `/community-prices` | auth | Créer un signalement (throttle Redis) |
| PATCH | `/community-prices/:id` | auth, owner-only | Corriger mon signalement (montant/devise/note/provider) |
| DELETE | `/community-prices/:id` | auth, owner-only | Retirer mon signalement |
| POST | `/community-prices/:id/vote` | auth | Voter `{ value: 1 \| -1 }`, toggle idempotent, anti-auto-vote |

Le signalement d'abus réutilise **tel quel** `POST /reports` (`targetType: 'community_price'`) — aucun nouvel endpoint de modération.

---

## Features

### F1 — Bandeau taux du jour en tête de feed
**Priorité :** Must Have
**Persona concerné :** Membre diaspora actif
**Job-to-be-done :** Quand j'ouvre le feed, je veux voir le taux XOF↔EUR/USD/CAD du jour sans action, pour ancrer une habitude quotidienne.

#### Critères d'acceptation

**AC-F1-01 — Snapshot FX publié affiché**
- **Given** un `FxRateSnapshot` existe pour le dernier jour ouvré TARGET connu
- **When** `GET /rates/today` est appelé
- **Then** la réponse contient `eurXof: 655.957` (constante), `usdXof` et `cadXof` calculés depuis ce snapshot, `asOf` = la date du snapshot, `source: "ecb"`, code 200.

**AC-F1-02 — Fail-open si la BCE est injoignable**
- **Given** le cron de rafraîchissement échoue à joindre le flux BCE (timeout/5xx)
- **When** `GET /rates/today` est appelé
- **Then** le **dernier snapshot valide connu** est renvoyé (pas d'erreur 5xx côté client), `asOf` reflète la date réelle de ce dernier snapshot (pas la date du jour) afin que l'UI puisse afficher « taux du JJ/MM » de façon honnête.

**AC-F1-03 — Aucun snapshot disponible (premier déploiement, avant 1er cron)**
- **Given** la table `FxRateSnapshot` est vide
- **When** `GET /rates/today` est appelé
- **Then** 200 avec `eurXof: 655.957`, `usdXof: null`, `cadXof: null`, `asOf: null`, `source: "unavailable"` — jamais d'erreur bloquante, jamais de valeur inventée.

**AC-F1-04 — Bandeau agrégé cache-first**
- **Given** un appel `GET /rates/banner`
- **When** il est rejoué deux fois en moins de 5 minutes
- **Then** la seconde réponse provient du cache Redis (pas de nouvelle requête DB pour l'agrégat), garantissant un coût quasi nul en tête de feed à fort trafic.

**Règles métier :**
- `EUR/XOF` n'est **jamais** lu depuis une source externe — constante applicative documentée (traité UEMOA).
- `USD/XOF` et `CAD/XOF` sont **toujours dérivés**, jamais saisis manuellement par un utilisateur.
- Le cron (idiome `StoriesCron`, `setInterval` + `unref()`, no-op si `NODE_ENV=test`) tourne toutes les **6h** (la BCE ne publie qu'1x/jour ouvré — pas besoin de plus, coût réseau négligeable) et **upsert** sur `asOf` (idempotent, pas de doublon si rejoué le même jour).

**Cas d'erreur à gérer :**
- Flux BCE renvoie un XML malformé/inattendu → log + skip, ne jamais persister une valeur non parsée avec certitude (fail-open sur l'ancien snapshot, jamais une valeur par défaut inventée genre `1.0`).
- Devise absente du flux BCE un jour donné (rarissime) → ne pas upsert ce jour, garder le précédent.

---

### F2 — Signaler un prix communautaire
**Priorité :** Must Have
**Persona concerné :** Contributeur communautaire
**Job-to-be-done :** Quand je viens de payer un billet/transfert/colis, je veux signaler le prix réel payé, pour aider la communauté à s'y retrouver.

#### Critères d'acceptation

**AC-F2-01 — Création valide**
- **Given** un utilisateur authentifié, sous le seuil de throttle
- **When** il `POST /community-prices` avec `{ type: "transfert_argent", originCountry: "FR", destCountry: "NE", amount: 5, currency: "EUR", provider: "Wave", note: "frais sur 200€ envoyés" }`
- **Then** 201, le signalement est créé avec `status: "active"`, `trustScore: 0`, `submitterId` = l'utilisateur courant (jamais un `submitterId` fourni par le client).

**AC-F2-02 — Validation Zod stricte**
- **Given** un body avec `type` absent, ou `amount <= 0`, ou `currency` qui n'est pas un code ISO 4217 3 lettres, ou `note` > 280 caractères
- **When** `POST /community-prices` est appelé
- **Then** 400, aucune ligne créée.

**AC-F2-03 — Throttle anti-spam**
- **Given** un utilisateur qui a déjà soumis N signalements dans la fenêtre glissante du jour (seuil à définir avec l'architecte, ex. 5/jour, clé Redis `communityprice:submit:{userId}:{yyyymmdd}` via `RedisService.incrementCounter`, même primitive que le reste du produit)
- **When** il tente un N+1e signalement le même jour
- **Then** 429, aucune ligne créée, message explicite.

**AC-F2-04 — Correction par le propriétaire**
- **Given** un signalement créé par l'utilisateur A
- **When** A `PATCH /community-prices/:id` avec un nouveau `amount`
- **Then** 200, la mise à jour est appliquée ; **When** l'utilisateur B (≠ A) tente le même `PATCH`, **Then** 403 (AuthZ owner-only, même pattern que `services.service.ts update/remove`).

**AC-F2-05 — Suppression par le propriétaire**
- **Given** un signalement créé par A
- **When** A `DELETE /community-prices/:id`
- **Then** 204, le signalement (et ses votes, cascade) disparaît ; un tiers B qui tente la suppression reçoit 403.

**Règles métier :**
- `submitterId` toujours dérivé du JWT (`CurrentUser`), jamais du body (anti-IDOR, cohérent avec `services.service.ts create`).
- `currency` normalisée en majuscules à la validation Zod (`.length(3).toUpperCase()`).
- `countryCode` (`originCountry`/`destCountry`) : format ISO 3166-1 alpha-2, `.length(2).toUpperCase()`, même contrainte que `service.dto.ts`.
- Aucun champ média (V1 texte + montant uniquement) → pas de dépendance `S3Service`, pas de risque disque.

**Cas d'erreur à gérer :**
- Signalement d'un `id` inexistant en `PATCH`/`DELETE` → 404.
- Throttle dépassé → 429 avec message actionnable (« Vous avez atteint la limite de signalements aujourd'hui »).

---

### F3 — Voter la fiabilité d'un prix
**Priorité :** Must Have
**Persona concerné :** Membre diaspora actif
**Job-to-be-done :** Quand je vois un prix signalé, je veux dire s'il me semble fiable ou non, pour aider la communauté à distinguer le signal du bruit.

#### Critères d'acceptation

**AC-F3-01 — Premier vote**
- **Given** un utilisateur B qui n'a jamais voté sur le prix P (soumis par A)
- **When** B `POST /community-prices/P/vote` avec `{ value: 1 }`
- **Then** 200/201, `trustScore` de P incrémenté de 1 dans la même transaction que la création du vote (cohérent avec le pattern `toggleCommentLike`).

**AC-F3-02 — Toggle idempotent (revote identique = retrait)**
- **Given** B a déjà voté `{ value: 1 }` sur P
- **When** B revote `{ value: 1 }` sur P
- **Then** le vote est retiré (toggle), `trustScore` décrémenté de 1 — pas de doublon possible (contrainte `@@id([userId, priceId])`).

**AC-F3-03 — Changement de vote**
- **Given** B a voté `{ value: 1 }` sur P
- **When** B vote `{ value: -1 }` sur P
- **Then** le vote passe à -1, `trustScore` varie de -2 (retire le +1, applique le -1) en une transaction.

**AC-F3-04 — Anti-auto-vote**
- **Given** A est l'auteur du signalement P
- **When** A tente `POST /community-prices/P/vote`
- **Then** 403 — un auteur ne peut pas gonfler la confiance de son propre signalement.

**Règles métier :**
- `value` ∈ `{1, -1}` strictement (Zod `z.union([z.literal(1), z.literal(-1)])`).
- Le calcul de `trustScore` est **transactionnel** (upsert vote + update compteur dénormalisé dans la même `$transaction`, comme `services.service.ts respond`), jamais de dérive entre le compteur et la somme réelle des votes.

**Cas d'erreur à gérer :**
- Vote sur un prix `status: "removed"` (déjà retiré par modération) → 403/404 (pas de vote sur du contenu retiré).
- Vote sur un `id` inexistant → 404.

---

### F4 — Liste complète des prix signalés
**Priorité :** Should Have
**Persona concerné :** Membre diaspora actif
**Job-to-be-done :** Quand le bandeau ne suffit pas, je veux consulter tous les prix signalés pour un type/une route, pour comparer avant de choisir.

#### Critères d'acceptation

**AC-F4-01 — Liste filtrée et paginée**
- **Given** plusieurs `CommunityPrice` de type `colis_kg` avec différentes routes
- **When** `GET /community-prices?type=colis_kg&destCountry=NE&limit=20`
- **Then** 200, liste paginée par curseur (même contrat que `services.list` : `{ items, nextCursor }`), triée par `createdAt desc`, ne contenant que `status=active` par défaut.

**AC-F4-02 — Un signalement retiré par modération n'apparaît plus**
- **Given** un signalement P passé à `status: "removed"` via `Report → resolve(action: "content_removed")`
- **When** `GET /community-prices` est appelé (sans `status` explicite)
- **Then** P n'apparaît pas dans la liste par défaut.

**Règles métier :**
- Pagination curseur identique au pattern `services.service.ts list` (`take: limit+1`, `hasMore`).
- Recherche/tri avancé (par montant, par confiance) : hors AC minimal V1, `Could Have` si le temps le permet (voir Non-goals).

---

### F5 — Signaler un abus sur un prix (réutilise le module modération existant)
**Priorité :** Must Have
**Persona concerné :** Tous
**Job-to-be-done :** Quand un prix signalé est faux/frauduleux/abusif, je veux le signaler à la modération, pour que la communauté reste fiable.

#### Critères d'acceptation

**AC-F5-01 — Report créé sur un CommunityPrice**
- **Given** un `CommunityPrice` existant P
- **When** un utilisateur `POST /reports` avec `{ targetType: "community_price", targetId: P.id, reason: "scam" }`
- **Then** 201, le report est créé comme n'importe quel autre `targetType` (aucun changement requis à `ModerationService.create`).

**AC-F5-02 — Takedown modérateur**
- **Given** un report `pending` sur un `CommunityPrice`
- **When** un modérateur `POST /reports/:id/resolve` avec `{ action: "content_removed" }`
- **Then** `CommunityPrice.status` passe à `removed` (nouveau `case 'community_price'` dans `removeContent()`), le report passe à `resolved`.

**AC-F5-03 — Aperçu modération**
- **Given** un report `community_price`
- **When** un modérateur `GET /reports/:id/target` (endpoint `getTarget` existant)
- **Then** la réponse contient submitter, type, route, montant, devise, provider, `createdAt`, `status` — assez pour décider sans requête DB manuelle.

**Règles métier :**
- Aucune nouvelle route de modération — extension additive des `switch` existants sur `targetType`.

---

## Recommandations techniques issues de l'analyse marché

`memory/market.md` (axe 4 — gaps diaspora) identifie le besoin comme un point de douleur réel non couvert par les géants généralistes (transferts/taux/prix aujourd'hui négociés sur WhatsApp, référence explicite à Lemonade Finance comme preuve de la demande). Aucune stack technique n'est recommandée par le market-researcher pour ce point précis au-delà de « source gratuite » — la présente spec comble ce vide avec la décision BCE ci-dessus. Aucune dépendance payante introduite (conforme à la règle « ZÉRO solution payante » du `CLAUDE.md`/`status.json`) : flux BCE = fichier XML public statique sans clé, Redis/Prisma/Nest = infra déjà en place.

---

## Exigences non-fonctionnelles

| Catégorie | Exigence | Mesure |
|-----------|----------|--------|
| Performance | `GET /rates/banner` répond en < 200ms p95 (cache Redis chaud) | Test de charge léger / logs API |
| Disponibilité | Le bandeau ne renvoie jamais d'erreur bloquante même si la BCE est injoignable (fail-open) | Test AC-F1-02/03 |
| Sécurité | AuthZ owner-only sur update/delete de `CommunityPrice` ; anti-IDOR sur `submitterId` | Tests Playwright/Jest dédiés |
| Anti-spam | Throttle Redis sur la création de `CommunityPrice`, contrainte DB unique sur le vote | Tests Jest (429 au-delà du seuil, vote unique) |
| Disque | Aucun média, croissance DB négligeable (quelques Ko/jour pour `FxRateSnapshot`, quelques centaines d'octets/signalement) | Revue architecte |
| Mobile | Bandeau responsive, lisible sur 375px, ne bloque jamais le rendu du feed (chargement asynchrone, squelette/skeleton si `source: "unavailable"`) | Tests visuels |

---

## Métriques de succès

- Taux d'ouverture quotidien du feed corrélé à la présence du bandeau (mesure qualitative, pas de A/B test prévu en V1).
- Nombre de `CommunityPrice` actifs par type au bout de 4 semaines (objectif indicatif : ≥ 10 par type dans au moins 3 corridors).
- Ratio votes/signalements > 0 (preuve que la communauté modère elle-même, pas seulement la modération admin).
- 0 incident de fuite (aucun `submitterId` usurpé, aucun vote dupliqué constaté en prod).

---

## Hypothèses

- On assume que le flux BCE (`eurofxref-daily.xml`) reste accessible et gratuit sans authentification (c'est le cas depuis sa création, documenté publiquement) ; en cas d'indisponibilité prolongée, le fail-open + override `AppSetting` couvrent le risque opérationnel sans dégrader l'UX.
- On assume que la constante `EUR/XOF = 655.957` ne change pas en cours de vie du produit (peg en vigueur depuis 1999) ; si elle changeait un jour (événement géopolitique majeur), un déploiement de code (pas une donnée runtime) suffirait à la corriger.
- On assume qu'un signalement de prix, comme un post ou une demande de service existante, est traité comme un contenu public (submitter visible), indépendamment du `privacyLevel` du profil du contributeur — cohérent avec le traitement actuel des `ServiceRequest`/`Post` publics.
- On assume que 3 types de prix (billet avion, transfert d'argent, kilo de colis) couvrent le besoin V1 exprimé au backlog, sans extensibilité de type prévue dans ce sprint (un `enum` Prisma, migration nécessaire pour en ajouter — accepté).

---

## Risques identifiés

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Flux BCE change de format/URL sans préavis | Faible | Moyen | Parsing défensif (skip + log si XML inattendu), fail-open sur dernier snapshot valide, alerte log exploitable |
| Prix communautaires manipulés (auto-vote, faux prix coordonnés) | Moyen | Moyen | Anti-auto-vote (AC-F3-04), throttle de soumission (AC-F2-03), Report/takedown (F5), pas de score de réputation globale exploitable en V1 |
| Corridor peu peuplé au lancement → bandeau vide, mauvaise première impression | Moyen | Faible | `GET /rates/banner` gère explicitement le cas « aucun prix disponible » (pas d'erreur, juste absence), le taux FX seul reste toujours affiché |
| Confusion utilisateur entre taux officiel (fiable, BCE) et prix crowdsourcé (variable, non garanti) | Moyen | Faible | Distinction visuelle claire côté UI (hors périmètre spec technique, à porter à `gwani-frontend` : libellés explicites « Taux officiel » vs « Signalé par la communauté ») |

---

## Questions ouvertes

**Q1 (bloquante pour confirmation, non bloquante pour démarrer l'archi/dev)** — Le backlog formule la source du taux comme un OU (BCE ou saisie communautaire). Cette spec tranche : **BCE en source unique pour le taux de change**, saisie communautaire réservée aux **prix** (billet/transfert/colis) qui n'ont aucune source officielle. Confirmation proprio souhaitée avant implémentation ; recommandation forte de conserver ce découpage (un taux de change crowdsourcé sans garde-fou lourd est un risque de fiabilité/manipulation bien plus élevé qu'un prix de service).

**Q2** — Seuil exact de throttle sur la création de `CommunityPrice` (proposé : 5/jour/utilisateur) — à valider avec l'architecte selon la volumétrie attendue.

**Q3** — Faut-il plafonner le nombre de signalements actifs par (utilisateur × type × route) pour éviter qu'un seul contributeur « inonde » un corridor et fausse la représentativité du bandeau (qui prend le plus récent) ? Proposé pour V1 : non plafonné, mais le tri « plus récent + trustScore ≥ 0 » du bandeau limite déjà l'impact d'un spam isolé (un prix mal voté ne remonte pas).

**Q4** — `provider` (Western Union/Wave/RIA/Air France…) reste un texte libre en V1 (pas de taxonomie fermée) — accepté comme dette volontaire, à référentialiser en V2 si le volume le justifie.

**Q5** — Unité `colis_kg` : prix par kilo simple, ou faut-il des paliers (0-5kg / 5-20kg / 20kg+, tarification souvent dégressive en réalité) ? V1 proposé : montant/kg unique déclaré par le contributeur, `note` libre pour préciser un palier si besoin — à challenger si les premiers signalements réels montrent que c'est insuffisant.

---

## Checklist de validation (avant handoff)

- [x] Vision en 1 phrase claire et spécifique.
- [x] 2 personas définis avec job-to-be-done.
- [x] Chaque feature (F1-F5) a ≥ 2 AC Given/When/Then.
- [x] Tous les AC sont testables via l'API (Playwright/Jest) sans dépendance UI.
- [x] Non-goals explicitement listés.
- [x] Exigences non-fonctionnelles présentes (perf, dispo, sécurité, anti-spam, disque, mobile).
- [x] Hypothèses documentées.
- [x] Recommandations techniques du market-researcher intégrées (section dédiée).
- [x] Modèle de données + endpoints proposés pour cadrer l'architecte.
