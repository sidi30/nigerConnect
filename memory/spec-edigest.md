# Spec Produit — E-DIGEST (Digest hebdomadaire push)

**Version:** 1.0
**Date:** 2026-07-03
**Statut:** DRAFT → READY_FOR_ARCH
**Sprint parent:** S-BETA « La diaspora prend vie » (item `E-DIGEST`, backlog `memory/backlog.md`)

---

## Vision

Ce produit existe pour **les membres inactifs de la diaspora nigérienne** afin de **leur donner une raison hebdomadaire concrète de rouvrir l'app** (« cette semaine dans ta région : N événements, N annonces entraide, N nouveaux membres ») **parce que** l'engagement post-inscription chute vite sur les réseaux communautaires de niche et qu'un rappel personnalisé, gratuit et respectueux de la vie privée est le levier de rétention le moins cher du backlog (1 cron + Expo Push déjà en place, zéro service payant).

---

## Utilisateurs cibles

### Persona principal : Le membre dormant
- **Rôle :** utilisateur inscrit, identité éventuellement vérifiée ou non, qui n'a plus ouvert l'app depuis plusieurs jours.
- **Problème :** il a rejoint NigerConnect (souvent via parrainage) mais n'a pas encore pris l'habitude de revenir — la valeur de la plateforme (entraide, événements, communauté locale) ne lui est pas rappelée activement.
- **Frustration actuelle :** il retourne par défaut sur des groupes WhatsApp diaspora pour les mêmes informations (entraide, événements communautaires) faute d'être relancé ailleurs.
- **Succès pour lui :** il reçoit une notification courte, concrète et localisée à sa région, tape dessus, redécouvre une annonce entraide ou un événement pertinent, et reprend une activité régulière dans l'app.

### Persona secondaire : Le membre actif (hors cible V1)
- **Rôle :** utilisateur qui ouvre l'app plusieurs fois par semaine.
- **Besoin vis-à-vis de cette feature :** ne PAS être spammé par un digest inutile (il voit déjà les nouveautés en temps réel dans le fil/carte). Doit pouvoir désactiver le digest en un geste s'il le reçoit malgré tout par erreur.

---

## Périmètre V1 (MVP)

### Inclus
- Cron horaire, batché et borné, qui identifie les membres **inactifs** et **opt-in**, calcule 3 agrégats **anonymisés par nature** (jamais un nom/profil individuel) sur leur région, et envoie **au plus 1 push par utilisateur par fenêtre glissante de 7 jours**.
- 3 agrégats : (1) événements associatifs à venir dans la région (7 prochains jours), (2) nouvelles annonces entraide dans la région (7 derniers jours), (3) nouveaux membres **publics** dans la région (7 derniers jours).
- Notification in-app + push (réutilise `NotificationService.create` → historique 24h + push Expo existant), avec deep-link vers un écran pertinent de l'app.
- Toggle opt-out dans `Réglages > Confidentialité` (mobile), ON par défaut, effectif immédiatement.
- Idempotence stricte du cron (jamais de doublon en cas de relance/redémarrage).
- Kill-switch admin `digest_enabled` (AppSetting, fail-closed) pour couper le flux sans redeploy.

### Exclus (V2+)
- Personnalisation de l'heure d'envoi par fuseau horaire local du membre (V1 = cron horaire best-effort, pas de créneau garanti) — nécessiterait un scheduler plus riche, hors du principe « 1 cron simple » imposé.
- Vrais événements géolocalisés « près de moi » (coordonnées GPS) — V1 utilise `AssociationEvent` (scope pays/ville de l'association) en attendant `E-DIASPORA` (sprint S6, événements géolocalisés sur la carte Leaflet). Voir Hypothèses/Questions ouvertes.
- Digest par email (V1 = push + in-app uniquement, comme les autres `NotificationType`).
- Contenu du digest configurable par l'utilisateur (choisir quels agrégats il veut voir) — V1 = les 3 agrégats ensemble ou rien.
- A/B testing du wording ou de la fréquence — V1 = hebdomadaire fixe, wording unique.
- Segmentation avancée du "membre inactif" (score d'engagement, ML) — V1 = règle simple basée sur `lastLoginAt`.

---

## Features

### F1 — Calcul des agrégats hebdomadaires, privacy-safe
**Priorité :** Must Have
**Persona concerné :** Membre dormant
**Job-to-be-done :** Quand le cron identifie un membre éligible, je veux calculer 3 compteurs régionaux sur une fenêtre glissante de 7 jours, pour alimenter un digest sans jamais révéler l'identité d'un tiers.

**Définitions de fenêtre (à porter dans le code, testables séparément)** :
- **Événements** (« N événements près de toi ») = `AssociationEvent` dont `eventDate` ∈ `[now, now+7j]` (ce qui **va se passer** cette semaine — pas ce qui a été créé), rattachés à une association dont `countryCode` = `user.countryCode` (et `city` = `user.city` si ce dernier est renseigné).
- **Annonces entraide** (« N nouvelles annonces ») = `ServiceRequest` avec `status='open'` et `createdAt` ∈ `[now-7j, now]`, `countryCode`/`city` scopés comme ci-dessus.
- **Nouveaux membres** (« N nouveaux membres ») = `User` avec `createdAt` ∈ `[now-7j, now]`, `status='active'`, **`privacyLevel='public'` uniquement**, `countryCode`/`city` scopés comme ci-dessus, en excluant le destinataire lui-même.

#### Critères d'acceptation

**AC-F1-01 — Comptage événements (fenêtre à venir, pas rétroactive)**
- **Given** un membre éligible avec `countryCode='NE'`, `city='Niamey'`, et 3 `AssociationEvent` dont `eventDate` tombe dans les 7 prochains jours pour une association `countryCode='NE'`/`city='Niamey'`, plus 2 événements hors fenêtre (dans 3 semaines) ou hors région (`countryCode` différent)
- **When** le cron calcule les agrégats de ce membre
- **Then** `eventsCount = 3` exactement (les événements hors fenêtre ou hors région ne sont pas comptés)

**AC-F1-02 — Comptage annonces entraide (fenêtre rétroactive)**
- **Given** 5 `ServiceRequest` `status='open'` créées dans les 7 derniers jours dans la région du membre, et 2 créées il y a 10 jours (hors fenêtre), et 1 `status='resolved'` créée cette semaine
- **When** le cron calcule les agrégats
- **Then** `annoncesCount = 5` (les 2 hors fenêtre et la résolue sont exclues)

**AC-F1-03 — Nouveaux membres : jamais un compte `private` ou `friends`, jamais le destinataire lui-même**
- **Given** dans la région du membre, cette semaine : 1 nouveau compte `privacyLevel='public'`, 1 nouveau compte `privacyLevel='private'`, 1 nouveau compte `privacyLevel='friends'`, et le membre destinataire lui-même vient de mettre à jour son profil (mais n'est pas "nouveau")
- **When** le cron calcule `newMembersCount`
- **Then** `newMembersCount = 1` (seul le compte `public` est compté ; le `private`, le `friends` et le destinataire lui-même sont exclus)
- **And** aucun identifiant, nom ou avatar d'un tiers (public ou non) n'apparaît nulle part dans le titre/corps/`data` de la notification générée — uniquement le nombre agrégé

**AC-F1-04 — Membre sans région = inéligible**
- **Given** un membre avec `countryCode=null`
- **When** le cron sélectionne les candidats du batch
- **Then** ce membre est exclu du digest (pas d'agrégat pertinent sans région)

**Règles métier :**
- Fenêtre "événements" = prospective (7 prochains jours) ; fenêtres "annonces" et "nouveaux membres" = rétrospectives (7 derniers jours).
- Région = `countryCode` obligatoire, affiné par `city` si renseigné côté destinataire (sinon comparaison au niveau pays uniquement).
- `newMembersCount` ne compte **que** `privacyLevel='public'` ET `status='active'` — jamais `private`, jamais `friends`, même en agrégat (cf. Risques : oracle sur petit nombre).
- Si les 3 compteurs valent 0 → aucun push n'est envoyé cette semaine-là (éviter un digest vide perçu comme du bruit), mais le membre est marqué "vérifié cette semaine" pour ne pas être re-scanné avant 7 jours (cf. F2).

**Cas d'erreur à gérer :**
- Échec DB pendant le calcul des agrégats d'un membre du batch → logger un warning, **ne pas** marquer ce membre comme "vérifié cette semaine" (il sera retenté au prochain tick), poursuivre le traitement du reste du batch.

---

### F2 — Cron hebdomadaire idempotent, ciblage membres inactifs opt-in
**Priorité :** Must Have
**Persona concerné :** Membre dormant
**Job-to-be-done :** Quand le cron tourne, je veux qu'il traite par lots bornés les membres inactifs opt-in dont la fenêtre de 7 jours est échue, afin d'envoyer au plus un digest par semaine et par utilisateur, à coût ressource négligeable.

#### Critères d'acceptation

**AC-F2-01 — Ciblage : inactif + opt-in + due**
- **Given** un membre avec `digestOptIn=true`, `status='active'`, `lastLoginAt` soit `null` soit antérieur à 7 jours, et `lastDigestSentAt` soit `null` soit antérieur à 7 jours
- **When** le cron sélectionne le batch de ce tick
- **Then** ce membre fait partie des candidats éligibles
- **Given** un membre avec `lastLoginAt` datant de moins de 7 jours (actif récemment)
- **When** le cron sélectionne le batch
- **Then** ce membre n'est **pas** inclus (le digest cible le rappel des dormants, pas une newsletter générale envoyée à tout le monde)
- **Given** un membre avec `digestOptIn=false`
- **When** le cron sélectionne le batch, quelle que soit son activité
- **Then** ce membre n'est jamais inclus

**AC-F2-02 — Idempotence : jamais de double envoi**
- **Given** un membre déjà traité cette semaine (`lastDigestSentAt` < 7 jours)
- **When** le cron est relancé (tick suivant, redémarrage du process, appel manuel)
- **Then** ce membre n'est **pas** re-sélectionné et ne reçoit pas de second push cette semaine-là
- **Given** un membre en cours de traitement dans le batch
- **When** le système persiste `lastDigestSentAt = now()` **avant** l'envoi effectif du push (stamp atomique par utilisateur)
- **Then** un crash du process juste après l'envoi ne peut au pire causer qu'un envoi manquant (jamais un doublon) — comportement "at-most-once" assumé (cf. Hypothèses)

**AC-F2-03 — Batch borné et throttlé (coût ressource ~0)**
- **Given** une population de membres éligibles supérieure à la taille de lot (ex. 200)
- **When** le cron tourne une fois (tick horaire)
- **Then** il traite au plus 200 membres ; le reste est repris aux ticks suivants, garantissant une couverture complète en ≤ 7 jours glissants tant que le volume reste raisonnable vs. la fréquence horaire

**Règles métier :**
- Cadence : cron horaire, même schéma que `apps/api/src/feed/stories.cron.ts` (`OnModuleInit` + `setInterval(1h).unref()`), zéro dépendance à un scheduler externe payant.
- Un membre ne reçoit jamais plus d'1 digest par fenêtre glissante de 7 jours, même en cas de relance multiple.
- Kill-switch `digest_enabled` (AppSetting, cf. F5) : lu en tête de traitement du batch, fail-closed.

**Cas d'erreur à gérer :**
- Lecture du kill-switch (Redis/DB) indisponible → fail-closed, aucun digest envoyé ce tick (cf. `SettingsService.getSetting` — comportement déjà défensif à réutiliser).
- Échec d'envoi push pour un token invalide → déjà géré nativement par `push.service.ts` (nettoyage des tokens périmés), aucun traitement spécifique à ajouter côté digest.

---

### F3 — Opt-out dans les réglages de confidentialité
**Priorité :** Must Have
**Persona concerné :** Tous
**Job-to-be-done :** Quand je veux arrêter de recevoir le digest hebdomadaire, je veux un switch clair dans mes réglages, pour que ça s'applique immédiatement et durablement.

#### Critères d'acceptation

**AC-F3-01 — Toggle visible et explicite**
- **Given** l'écran `Réglages > Confidentialité` (`apps/mobile/app/settings/privacy.tsx`)
- **When** j'affiche la section dédiée au digest
- **Then** je vois un switch « Recevoir le résumé hebdo de ma région », activé (ON) par défaut, avec une description indiquant le contenu (événements, annonces, nouveaux membres) et l'absence de tout nom de tiers dans la notification

**AC-F3-02 — Persistance immédiate**
- **Given** le switch activé
- **When** je le désactive
- **Then** `PATCH /profile/me { digestOptIn: false }` est appelé et validé par Zod (`digestOptIn: z.boolean().optional()`), et la valeur est persistée immédiatement (comme `newsletterOptIn` aujourd'hui)

**AC-F3-03 — Opt-out respecté par le cron, sans délai significatif**
- **Given** `digestOptIn=false`
- **When** le cron tourne, même si `lastLoginAt` indiquerait par ailleurs un membre inactif éligible
- **Then** ce membre n'est jamais inclus dans le batch tant que le switch n'est pas réactivé

**Règles métier :**
- `digestOptIn` : `Boolean @default(true)` sur `User` — modèle opt-out, cohérent avec `newsletterOptIn` déjà existant.
- Indépendant de `newsletterOptIn` (annonces produit) et de `proximityAlerts` : un membre peut couper l'un sans couper les autres.

**Cas d'erreur à gérer :**
- Payload `digestOptIn` avec un type invalide (ex. string au lieu de boolean) → 400 Zod, comme tout autre champ de `updateProfileSchema`.

---

### F4 — Deep-link du push digest
**Priorité :** Should Have
**Persona concerné :** Membre dormant
**Job-to-be-done :** Quand je tape sur la notification digest, je veux atterrir sur un écran pertinent de l'app, pour explorer directement ce qui est nouveau plutôt que sur un écran générique sans rapport.

#### Critères d'acceptation

**AC-F4-01 — Routage du tap vers un écran pertinent**
- **Given** une notification `type='weekly_digest'` reçue (in-app ou push)
- **When** je la tape
- **Then** je suis redirigé vers un écran cohérent avec le contenu du digest (a minima le Fil d'accueil ; option retenue à trancher — voir Questions ouvertes : routage fixe vers l'accueil vs. routage vers l'onglet dont le compteur est le plus élevé)

**AC-F4-02 — Pas de crash sur payload legacy/incomplet**
- **Given** une notification `weekly_digest` sans `data` exploitable
- **When** je la tape
- **Then** je suis redirigé vers un écran de repli sûr (accueil), sans erreur ni écran blanc

**Règles métier :**
- `routeForNotification` (`apps/mobile/app/settings/notifications.tsx`) et le deep-link push (`apps/mobile/app/_layout.tsx`) doivent tous deux ajouter un `case 'weekly_digest'` — sinon le tap ne navigue nulle part (dégradé mais non bloquant).

---

### F5 — Kill-switch admin `digest_enabled`
**Priorité :** Should Have
**Persona concerné :** N/A (opérationnel)
**Job-to-be-done :** Quand l'équipe a besoin de couper le digest sans redeploy (incident, abus, décision produit), je veux un flag fail-closed lisible par le cron.

#### Critères d'acceptation

**AC-F5-01 — Flag absent ou `false` = digest coupé**
- **Given** l'`AppSetting` `digest_enabled` absent ou valant `'false'`
- **When** le cron tourne
- **Then** aucun digest n'est envoyé, même pour des membres par ailleurs éligibles (0 push, 0 stamp `lastDigestSentAt`)

**AC-F5-02 — Flag `true` = flux normal**
- **Given** `digest_enabled='true'`
- **When** le cron tourne
- **Then** le traitement du batch s'exécute normalement (F1/F2)

**Règles métier :**
- Pattern identique à `SettingsService.isProximityEnabled()` : lecture via `AppSetting` (clé/valeur, table déjà existante, pas de migration), cache Redis court, fail-closed en cas d'échec de lecture.
- Valeur par défaut au premier déploiement : `'false'` (ship DARK, activation explicite ensuite) — cohérent avec le principe déjà appliqué à `proximity_enabled` et `video_enabled`.

---

## Exigences non-fonctionnelles

| Catégorie | Exigence | Mesure |
|-----------|----------|--------|
| Performance | Batch borné (≤200 membres/tick), requêtes de comptage sur colonnes déjà indexées (`countryCode`, `city`, `createdAt`) | Durée d'un tick < quelques secondes en usage normal |
| Coût ressource | Aucun nouveau service externe, cron in-process (setInterval), pas de job-runner distribué | 0 dépendance payante ; charge CPU/DB marginale (comptages simples) |
| Sécurité | `PATCH /profile/me` (digestOptIn) validé par Zod ; AuthZ = owner uniquement (déjà le cas pour `updateMe`) | Tests Jest + revue |
| Privacy | Un compte `private` ou `friends` n'apparaît JAMAIS, même en agrégat, dans un digest (ni compté, ni nommé) | Test unitaire dédié + vérification `gwani-pentest` |
| Idempotence | Un membre ne reçoit jamais plus d'1 push digest par fenêtre glissante de 7 jours, y compris en cas de relance du cron | Test d'intégration (relance à froid du batch) |
| Disponibilité | Fail-closed sur toute erreur (lecture kill-switch, DB) : en cas de doute, ne pas envoyer plutôt que sur-envoyer | Revue de code |
| Mobile | Toggle opt-out accessible en < 2 taps depuis Réglages, cohérent visuellement avec les switches existants (`newsletterOptIn`, `proximityAlerts`) | Revue UI |

---

## Métriques de succès

- **Taux de réactivation** : % de destinataires (inactifs) qui ouvrent l'app dans les 48h suivant réception du push digest — cible indicative > 8% (benchmark push de réactivation générique).
- **Taux d'opt-out du digest** : < 5% des destinataires cumulés sur 4 semaines glissantes (signal de fatigue à surveiller ; si dépassé, revoir la fréquence ou le ciblage).
- **Couverture du cron** : 100% des membres éligibles (inactifs + opt-in + région renseignée) traités au moins une fois par fenêtre de 7 jours glissants.
- **0 fuite de privacy** détectée par `gwani-pentest` sur les payloads de notification (aucun nom/avatar/id de tiers, aucun compte `private`/`friends` compté).
- **0 doublon d'envoi** détecté sur relance/redémarrage du process (test d'idempotence vert).

---

## Recommandations techniques issues de l'analyse marché

`memory/market.md` (2026-07-02) ne couvre pas directement la mécanique de digest push, mais confirme le contexte produit qui la justifie : les communautés diaspora s'organisent aujourd'hui sur des groupes WhatsApp faute d'outil dédié structuré (entraide, infos administratives, taux de change informels) — la « granularité ville d'accueil » est identifiée comme un avantage différenciant à faible coût technique pour NigerConnect. E-DIGEST capitalise directement sur cette granularité déjà présente (`User.city`/`countryCode`, `ServiceRequest.city`/`countryCode`) sans nouvelle dépendance.

Éléments techniques repérés dans le code existant, à confirmer par `gwani-architect` :
- **Cron** : suivre exactement le pattern `apps/api/src/feed/stories.cron.ts` (`OnModuleInit`/`OnModuleDestroy`, `setInterval(1h).unref()`, `NODE_ENV==='test'` skip).
- **Push + historique in-app** : réutiliser `NotificationService.create()` (pas un appel direct à `PushService`) pour bénéficier gratuitement de l'historique 24h et du deep-link générique déjà câblés.
- **Nouveau `NotificationType`** : ajouter `weekly_digest` à l'enum Prisma (migration additive, `ALTER TYPE ... ADD VALUE`).
- **Nouveaux champs `User`** (migration additive) : `digestOptIn Boolean @default(true) @map("digest_opt_in")`, `lastDigestSentAt DateTime? @map("last_digest_sent_at")`.
- **Zod** : ajouter `digestOptIn: z.boolean().optional()` à `updateProfileSchema` (`apps/api/src/profile/dto/update-profile.dto.ts`), miroir exact de `newsletterOptIn`.
- **Kill-switch** : réutiliser `SettingsService` (`AppSetting` clé/valeur déjà existante, pas de migration), pattern `isProximityEnabled()`.
- **Mobile opt-out** : nouveau `Switch` dans `apps/mobile/app/settings/privacy.tsx`, section dédiée (miroir exact du bloc `newsletterOptIn` existant, lignes ~208-225), via `profileApi.updateMe({ digestOptIn })`.
- **Mobile deep-link** : ajouter un `case 'weekly_digest'` dans `routeForNotification` (`apps/mobile/app/settings/notifications.tsx`) et dans le handler push de `apps/mobile/app/_layout.tsx`.
- **Livraison** : 100% API-only + migration additive (2 colonnes `User` + 1 valeur d'enum) → **OTA-safe côté mobile** (le toggle opt-out est un simple appel API existant, aucun module natif). Pas de bump `app.json`.

---

## Hypothèses

- **Définition « membre inactif »** = `lastLoginAt` absent ou antérieur à 7 jours (recommandation PM). Alternative plus simple mais moins ciblée : envoyer à tous les membres opt-in chaque semaine, indépendamment de l'activité — écartée en V1 car elle dénature l'intention "rappel des dormants" et augmente le risque de fatigue/opt-out des membres déjà actifs. À confirmer avec le proprio (cf. Questions ouvertes).
- **Source « événements »** = `AssociationEvent` existant (scope pays/ville de l'association), utilisé comme proxy en attendant les événements géolocalisés d'`E-DIASPORA` (sprint S6, pas encore livré). Le contrat (compteur agrégé) reste stable même si la source change plus tard.
- Un digest avec les 3 compteurs à 0 n'est **pas** envoyé (évite le bruit), mais le membre est marqué comme "vérifié cette semaine" pour borner le coût du cron (pas de re-scan horaire sur un membre à signal nul).
- L'historique in-app du digest hérite du TTL générique de 24h de `NotificationService.create()` (pas de traitement spécial pour ce type, malgré la cadence hebdomadaire de l'émission).
- Idempotence visée = **at-most-once** (stamp `lastDigestSentAt` avant l'envoi du push), pas at-least-once — jugé approprié pour un rappel de rétention non critique (mieux vaut occasionnellement rater un envoi qu'en dupliquer un).
- Pas de personnalisation de fuseau horaire ni de créneau horaire fixe en V1 : le cron horaire traite les membres "dus" au fil de l'eau (best-effort), cohérent avec la contrainte "1 cron simple, pas de scheduler externe".
- Le cron reste mono-process (pas de lock distribué) : acceptable car l'infra est un VPS unique mono-instance (pas de scaling horizontal de l'API en prod à ce jour).

---

## Risques identifiés

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| Oracle de petit nombre sur "nouveaux membres" (un compteur à 1 peut laisser deviner qui a rejoint) | Faible | Moyen | Le compteur n'inclut QUE les comptes `privacyLevel='public'` (déjà découvrables par choix explicite de l'utilisateur) ; `private`/`friends` jamais comptés, jamais nommés — revue `gwani-pentest` obligatoire avant activation |
| Digest perçu comme "vide" si les 3 agrégats sont souvent proches de 0 (petites communautés locales) | Moyenne | Moyen | Règle "skip si 0/0/0" (pas de push creux) ; surveiller le taux de push réellement envoyé vs. population éligible comme signal d'adoption |
| Fatigue/désabonnement si le ciblage "inactif" est mal calibré (trop large) | Faible-Moyenne | Moyen | Ciblage strict sur `lastLoginAt` > 7 jours (pas un envoi de masse) ; métrique de suivi = taux d'opt-out < 5% |
| Doublon d'envoi en cas de redémarrage du process pendant un batch | Faible | Faible | Stamp `lastDigestSentAt` atomique **avant** l'envoi push (idempotence testée, AC-F2-02) |
| Source "événements" (`AssociationEvent`) peu représentative d'un vrai "près de toi" géolocalisé, peut décevoir | Moyenne | Faible | Assumé comme proxy V1 documenté ; contrat stable pour un remplacement transparent par `E-DIASPORA` (S6) |
| Dérive de coût si la population de membres inactifs devient très grande | Faible | Faible | Batch borné + cadence horaire = coût plafonné mécaniquement, indépendant du volume total |

---

## Questions ouvertes (nécessitent une décision proprio avant implémentation)

1. **Définition "inactif"** : `lastLoginAt` > 7 jours (reco PM, ciblé) vs. envoi à tous les membres opt-in chaque semaine (plus simple, risque de fatigue) ?
2. **Source "événements près de toi"** : lancer maintenant avec `AssociationEvent` (proxy pays/ville, disponible aujourd'hui) vs. attendre `E-DIASPORA` (S6, événements géolocalisés) et ne livrer que 2 des 3 agrégats en attendant ?
3. **Kill-switch `digest_enabled`** : Must Have dès le premier ship (reco, coût nul, cohérent avec le reste du produit) ou Should Have différable ?
4. **Deep-link du tap (F4)** : routage fixe vers l'accueil (simple, sûr) vs. routage vers l'onglet correspondant au signal dominant du digest (plus pertinent, légèrement plus complexe) ?
5. **Taille de lot / cadence du cron** : 200 membres/tick horaire proposé par défaut — à valider une fois un ordre de grandeur de la population de membres inactifs connu (pas de données de volume disponibles à ce stade).

---

## Validation checklist

- [x] Vision en 1 phrase claire et spécifique
- [x] Persona principal (membre dormant) + persona secondaire (hors cible, garde-fou anti-fatigue) avec job-to-be-done
- [x] Chaque feature (F1-F5) a au moins 2 AC Given/When/Then
- [x] Tous les AC sont testables (comptages exacts, statuts booléens, présence/absence de champs)
- [x] Non-goals explicitement listés (section Périmètre V1 → Exclus)
- [x] Exigences non-fonctionnelles présentes (perf, coût, sécu, privacy, idempotence, dispo, mobile)
- [x] Hypothèses documentées
- [x] `market.md` consulté (contexte diaspora/WhatsApp) et référencé
