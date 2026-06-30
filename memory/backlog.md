# NigerConnect — Backlog produit (priorisé)

> PO/SM : maître d'orchestre. Source de vérité du board = ce fichier + `memory/status.json`.
> Priorité = Valeur ÷ Effort (échelle 1–5). Le haut est raffiné (Ready), le bas reste grossier.
> Contraintes transverses (rappel CLAUDE.md, à porter dans CHAQUE item) : validation **Zod** sur tout body,
> **AuthZ/anti-IDOR** (filtrer par owner, vérifier ownership avant write), **privacy** public/friends/private
> (ne rien fuiter via feed/map/recherche/proximité), médias via `S3Service.assertOwnedPublicImage`,
> **mobile OTA vs rebuild** : un module natif AJOUTÉ ⇒ rebuild EAS ; JS-only ⇒ OTA (et NE PAS bumper
> la version sinon l'OTA cible un runtimeVersion que les builds existants n'ont pas).

---

## Synthèse concurrentielle (actionnable, surface par surface)

### Feed / posts / commentaires — modèle **Instagram**
- **Liste des likers** (qui a aimé) : standard IG/FB. Augmente la preuve sociale et la découverte de profils. *Backend déjà prêt* (`GET /posts/:id/likes`).
- **Like de commentaire** : engagement granulaire, hiérarchise les meilleures réponses. Colonne `Comment.likeCount` déjà présente mais inerte.
- **Réactions multi-emoji** (❤️😂😮😢👍) au lieu du like binaire : expressivité IG/FB, signal de sentiment plus riche pour la modération et le tri.
- Parité différée : double-tap-to-like, enregistrer/bookmark, “partager en story”, @mention dans commentaire, commentaire épinglé.

### Chat — modèle **Instagram / WhatsApp**
- **Swipe-to-reply** : geste attendu par tout utilisateur mobile. *Backend déjà prêt* (`replyToId` partout). Pur travail geste/UI.
- Parité différée : réactions emoji sur un message (long-press), accusés de lecture déjà partiels (`message:read`), présence en ligne, messages vocaux, galerie média de conversation.

### Stories — modèle **Instagram**
- **Répondre à une story** (→ DM à l'auteur) + **liker une story** + **like animé moderne** qui différencie le produit.
- Parité différée : “vu par” (seen-by list), barre de réactions rapides emoji, overlays texte/stickers, multi-média par story.

### Services — modèle **Facebook Marketplace**
- **Barre de recherche plein-texte** (manque vs filtres par thème déjà présents). Réduit le temps pour trouver un service.
- Parité différée : contacter le prestataire en 1 tap (chat), avis/notation (module `review` existe), tri par proximité (PostGIS dispo), photos sur la demande, “marquer résolu”.

### Carte — modèle **Snapchat (Snap Map)**
- Différenciateur fort : **anneau de story autour de l'avatar sur la carte** (tap → ouvre la story), **pins avatars animés**, **pulsation “actif récemment”**, clustering animé, calque “amis uniquement”. Le ping de proximité existe déjà (`POST /geo/proximity/ping`).

---

## ITEMS

### B1 — [QUICK WIN] Voir QUI a liké un post (liste des likers)  · Prio 4.0 (V4/E1)
**Story** : En tant qu'utilisateur, je veux voir la liste des personnes qui ont aimé un post afin de découvrir qui interagit et d'ouvrir leurs profils.
**Given/When/Then**
- Given un post avec ≥1 like, When je tape sur le compteur de likes, Then une feuille/écran liste les likers (avatar, nom) paginée.
- Given un liker dans la liste, When je le tape, Then j'ouvre `/user/[id]`.
- Given un post sur lequel je n'ai pas le droit de voir (privacy), When j'appelle l'endpoint, Then 403 (déjà géré par `assertCanViewPost`).
**Contraintes** : aucun nouveau backend. Privacy = réutiliser le gate existant. Pagination curseur.
**Backend** : déjà fait — `apps/api/src/feed/feed.controller.ts:112` (`GET posts/:id/likes`), `likes.service.ts:79` (`listLikers`).
**shared-types** : ajouter un type `Liker`/réutiliser `PublicUser` dans `packages/shared-types/src/post.ts`.
**Mobile** :
- `apps/mobile/services/feedApi.ts` — ajouter `getLikers(postId, cursor?)` → `GET /posts/${id}/likes` (manque, cf. map).
- `apps/mobile/components/feed/PostCard.tsx:178` — rendre le compteur de likes tappable (`onLikeCountPress`).
- nouvel écran/sheet likers (ex. `apps/mobile/app/post/[id]/likes.tsx` ou bottom-sheet) → push `/user/[id]`.
- Câbler depuis `apps/mobile/app/(tabs)/index.tsx` et `apps/mobile/app/post/[id].tsx`.
**Livraison** : JS-only → OTA iOS. Pas de bump.

### B2 — Swipe-to-reply dans le chat  · Prio 1.6 (V4/E2.5)
**Story** : En tant qu'utilisateur du chat, je veux glisser un message pour y répondre afin de citer le message dans ma réponse, comme IG/WhatsApp.
**Given/When/Then**
- Given un message, When je le glisse latéralement au-delà d'un seuil, Then une barre de composition “En réponse à …” s'affiche avec un aperçu du message cité.
- Given une réponse envoyée, When elle s'affiche, Then la bulle montre un aperçu cliquable du message cité (auteur + extrait).
- Given un `replyToId` invalide/d'une autre conversation, When j'envoie, Then rejet serveur (Zod uuid + appartenance conversation).
**Contraintes** : geste via `react-native-gesture-handler` (~2.28, déjà installé) + `react-native-reanimated` (4.1.7, déjà installé) ⇒ **pas de module natif nouveau ⇒ OTA OK**. AuthZ : vérifier que `replyToId` appartient à la même conversation côté gateway.
**Backend** : `replyToId` déjà accepté (`apps/api/src/chat/dto/chat.dto.ts:13`, gateway `chat.gateway.ts:161`). À AJOUTER : sérialiser le message cité (`replyTo` imbriqué : auteur + extrait/type) dans la réponse du gateway + endpoint historique, et valider l'appartenance conversation du `replyToId`.
**shared-types** : `packages/shared-types/src/message.ts:44` — ajouter `replyTo?: { id; senderName; content; messageType } | null` (aujourd'hui seul le scalaire `replyToId` existe).
**Mobile** : `apps/mobile/app/chat/[id].tsx` — wrapper la bulle (render à :803) dans un `Swipeable`/`GestureDetector`, état `replyingTo`, aperçu au-dessus de l'input, passer `replyToId` à `chatApi.sendMessage` (option déjà supportée `chatApi.ts:31`), retirer le `replyToId: null` codé en dur (:122), rendre l'aperçu cité dans la bulle.
**Livraison** : JS-only → OTA iOS. Pas de bump.

### B3 — Liker un commentaire  · Prio 1.6 (V4/E2.5)
**Story** : En tant qu'utilisateur, je veux liker un commentaire afin de valoriser les meilleures réponses.
**Given/When/Then**
- Given un commentaire, When je tape le cœur, Then `likeCount` s'incrémente et l'état “liké par moi” persiste (optimiste + confirmé serveur).
- Given un commentaire déjà liké, When je re-tape, Then unlike (toggle), `likeCount` décrémente, pas de double-compte (contrainte d'unicité).
- Given un commentaire d'un post que je ne peux pas voir, When je like, Then 403.
**Contraintes** : nouveau modèle `CommentLike` (migration Prisma + `prisma migrate deploy` au déploiement API). AuthZ : visibilité du post parent. Zod sur params. Unicité `(userId, commentId)` pour empêcher le double-like (IDOR/triche).
**Backend** :
- `apps/api/prisma/schema.prisma` — ajouter modèle `CommentLike (@@id([userId, commentId]))`, relation vers `Comment` (`likeCount` déjà à :485).
- `apps/api/src/feed/comments.service.ts` — `toggleCommentLike(userId, commentId)` (transaction maj `likeCount`), exposer `isLikedByMe` dans `list` (:131).
- `apps/api/src/feed/feed.controller.ts` — `POST comments/:id/like`.
**shared-types** : `packages/shared-types/src/post.ts:51` — `Comment.isLikedByMe: boolean`.
**Mobile** : `apps/mobile/components/feed/CommentItem.tsx` — bouton like + compteur ; `apps/mobile/services/feedApi.ts` — `toggleCommentLike(commentId)` ; maj optimiste dans `apps/mobile/app/post/[id].tsx`.
**Livraison** : API = migration + deploy dernier commit. Mobile JS-only → OTA iOS.

### B6 — Barre de recherche dans la section Services  · Prio 2.0 (V4/E2)
**Story** : En tant qu'utilisateur cherchant un service, je veux une barre de recherche plein-texte afin de filtrer par mots-clés en plus des thèmes.
**Given/When/Then**
- Given des demandes de service, When je tape “plombier” dans la barre, Then la liste se filtre sur titre+description (insensible casse), combinable avec les filtres thème/pays/urgence existants.
- Given une recherche vide, When je l'efface, Then la liste revient au filtrage par thème seul.
- Given une requête, When je tape vite, Then debounce (pas de spam réseau).
**Contraintes** : Zod (param `q` borné, ex. max 80). Pas de fuite privacy (les service-requests sont publics par nature — confirmer). Recherche `contains mode:insensitive` (pas besoin de PostGIS).
**Backend** : `apps/api/src/marketplace/dto/service.dto.ts:25` — ajouter `q: z.string().trim().min(1).max(80).optional()` ; `apps/api/src/marketplace/services.service.ts:43` — `if (dto.q) where.OR = [{ title: { contains: dto.q, mode:'insensitive' } }, { description: { contains: dto.q, mode:'insensitive' } }]`.
**shared-types** : `packages/shared-types/src/service-request.ts` — ajouter `q?` au type de params si typé côté client.
**Mobile** : `apps/mobile/app/(tabs)/services.tsx` — `TextInput` de recherche (au-dessus des pills :100), état `query` debouncé, passer `q` à `servicesApi.list` (:51) ; `apps/mobile/services/servicesApi.ts:4` — accepter `q`.
**Livraison** : API = deploy dernier commit (pas de migration). Mobile JS-only → OTA iOS.

### B7 — [BUG] La notif “demande d'ami” n'ouvre pas le profil du demandeur  · Prio 3.3 (V5/E1.5)
**Story** : En tant que destinataire d'une demande d'ami, je veux qu'en tapant la notification j'atterrisse sur le profil du demandeur avec les actions Accepter/Refuser, afin de répondre en 1 geste.
**Given/When/Then**
- Given une notif `friend_request`, When je la tape (in-app OU push), Then j'ouvre `/user/[requesterId]` qui affiche “Accepter la demande / Refuser” (état `incoming`).
- Given j'accepte depuis ce profil, When je tape Accepter, Then `POST /friends/accept/:friendshipId` (déjà câblé `user/[id].tsx:163`).
- Given `friend_accepted`, When je la tape, Then j'ouvre le profil de celui qui a accepté.
**Cause racine (cf. map)** : le payload push de `friend_request` ne contient que `{ friendshipId }` — pas de `requesterId`. Les deux handlers routent en dur vers `/friends`.
**Backend** : `apps/api/src/social/friends.service.ts:88` — ajouter `requesterId` (et pour accepted, l'acteur) dans `data`. Vérifier `notification.service.ts:46` propage bien les champs `data` dans `pushData`.
**Mobile** :
- `apps/mobile/app/settings/notifications.tsx:25-27` — `routeForNotification` : `friend_request`/`friend_accepted` → `/user/${data.requesterId}` (fallback `/friends` si absent).
- `apps/mobile/app/_layout.tsx:234-236` — deep-link push : router vers `/user/${data.requesterId}` (fallback `/friends`).
**Contraintes** : ne pas exposer de données privées dans le payload (juste l'id). Garder le fallback `/friends` pour les anciennes notifs sans `requesterId`.
**Chaîne** : bug-hunter → fixer → e2e-tester (préférence proprio).
**Livraison** : API = deploy dernier commit. Mobile JS-only → OTA iOS.

### B5 — Story : répondre + liker + like animé moderne  · Prio 1.0 (V4/E4) → SPLIT
> Décision lib (à valider proprio) : **garder reanimated 4** (déjà natif dans le build ⇒ OTA-safe) pour un “heart-burst” spring custom différenciant ; OU **lottie-react-native** pour une animation premium type Telegram — mais c'est un **module natif ⇒ rebuild EAS obligatoire + bump version** (pas d'OTA). Recommandation PO : reanimated en Sprint, lottie en option si on rebuild de toute façon.
- **B5a — Liker une story (animé)** · V3/E2.5. Réutiliser `POST /posts/:id/like` (fonctionne sur l'id de story) + composant cœur animé reanimated dans `apps/mobile/app/stories/[authorId].tsx`. JS-only → OTA si reanimated.
- **B5b — Répondre à une story (→ DM)** · V3/E3. Endpoint qui crée un message chat vers l'auteur référant la story (réutilise chat) ; input de réponse dans le story viewer. Backend (conversation lookup/create + ref story) + mobile. Migration possible si on tague le message.

### B4 — [EPIC] Réactions multi-emoji sur un post  · Prio 0.8 (V4/E5)
**Story** : En tant qu'utilisateur, je veux réagir avec ❤️😂😮😢👍 (long-press) au lieu d'un like binaire, comme IG/FB.
**Périmètre** : nouveau modèle `Reaction (userId, postId, emoji)` (migration), agrégation par emoji, endpoints set/remove + likers par emoji, sérialisation `myReaction` + `reactionCounts`, shared-types, UI long-press picker + barre de comptes. **Migration de l'existant `Like`** à arbitrer (garder `Like` comme ❤️ ou migrer vers `Reaction`). Nécessite **gwani-architect** d'abord (ADR + contrat). Probable Sprint 2.

---

## PARITY SWEEP — opportunités rangées (grossier, bas de backlog)

| # | Surface | Opportunité (réf concurrent) | V | E |
|---|---------|------------------------------|---|---|
| P-01 | Chat | Réactions emoji sur un message (long-press, IG) | 3 | 2 |
| P-02 | Story | “Vu par” / seen-by list (IG) — besoin tracking vues | 3 | 3 |
| P-03 | Story | Barre de réactions rapides emoji (IG) | 3 | 2 |
| P-04 | Carte | **Anneau de story autour de l'avatar → tap ouvre la story (Snap Map)** — différenciateur fort | 4 | 4 |
| P-05 | Carte | Pulsation “actif récemment” + pins avatars animés (Snap) | 3 | 3 |
| P-06 | Services | Contacter le prestataire en 1 tap (chat) | 4 | 2 |
| P-07 | Services | Avis/notation prestataire (module review existe) | 3 | 3 |
| P-08 | Services | Tri par proximité (PostGIS dispo) | 3 | 2 |
| P-09 | Feed | Double-tap-to-like (IG) | 3 | 1 |
| P-10 | Feed | Enregistrer/bookmark un post (IG) | 3 | 2 |
| P-11 | Feed/Story | Partager un post en story (IG) | 2 | 3 |
| P-12 | Commentaire | @mention + notif (IG) | 3 | 3 |
| P-13 | Commentaire | Commentaire épinglé par l'auteur (IG/YT) | 2 | 2 |
| P-14 | Chat | Présence en ligne / dernière activité | 3 | 2 |
| P-15 | Chat | Messages vocaux (module natif audio ⇒ rebuild) | 3 | 4 |

---

# Sprint 2 — Proximité (« Rencontre de proximité rue-à-rue », double-aveugle)

> Design VALIDÉ et décisions VERROUILLÉES : `memory/proximity-rencontre-design.md` (ne pas rediscuter, appliquer).
> Modèle : `ProximityEncounter` mutuel à 2 participants, **anonyme des deux côtés** (`encounterId` opaque,
> distance **gelée** au croisement). Statuts `active→requested→accepted|declined|expired`. L'un OU l'autre `connect`
> (demandeur révélé) ; `accept` → visibilité mutuelle + `Friendship(accepted)`. Collision (les 2 cliquent) = match direct.
> 2 niveaux INDÉPENDANTS : visibilité profil (globale) ≠ notif proximité (rayon local) — la visibilité globale ne
> conditionne JAMAIS le croisement ni la demande.
>
> **Garde-fous non négociables (à porter dans CHAQUE item)** : jamais de coordonnées/distance fine renvoyées ;
> foreground-only, ZÉRO background ; position éphémère écrasée, zéro historique ; `encounterId` opaque usage unique ;
> plafonds + cooldown + **pas de re-demande après decline/block** ; kill-switch `proximity_enabled` (AppSetting) ;
> ID vérifiée (`identityStatus=approved`) + **18+ (DOB)** des DEUX côtés ; signal **jitté** (1–10 min).
>
> **Socle réel (~80% existe)** : `apps/api/src/geo/geo.service.ts` `proximityPing` (l.445), matcher Haversine sur
> `proximity_lat/lon` privés, dédup zone/cooldown Redis (l.550–595), cap fan-out `PROXIMITY_MATCH_LIMIT`,
> `blockedIds`. Mobile : `hooks/useProximityAlerts.ts` (watch foreground + ping), `services/geoApi.ts:131`.
> **Livraison mobile** : aucun module natif nouveau (réutilise expo-location foreground + expo-notifications déjà
> dans le build) ⇒ **OTA iOS**. **NE PAS bumper `app.json version`** (orphelinerait l'OTA). Si un module natif
> s'avère requis ⇒ STOP, signaler (rebuild EAS + bump). API : deploy dernier commit + `prisma migrate deploy`.

## ITEMS Sprint 2

### PX0 — [INFRA] Kill-switch `proximity_enabled` + allowlist ville pilote (g)  · Prio 5.0 (V5/E1)
**Story** : En tant que proprio, je veux activer/désactiver la proximité globalement et la restreindre à une ville pilote, afin de livrer la feature DARK puis faire un rollout maîtrisé.
**Given/When/Then**
- Given `app_settings.proximity_enabled='false'`, When un user ping ou appelle un endpoint encounter, Then 200 `{matches:[]}` / 403 silencieux — aucune notif, aucun encounter créé.
- Given `proximity_enabled='true'` + `proximity_city='Niamey'`, When le pinger n'est pas rattaché à la ville pilote, Then il ne croise personne (gate par `user.city`/zone).
- Given le flag flip à 'true', When un user éligible ping, Then le flux normal s'active sans redeploy.
**Contraintes** : lecture `AppSetting` (key/value string, `schema.prisma:1034` — **pas de migration**, juste 2 rows). Cache court (≤60s) pour ne pas lire la DB à chaque ping. Fail-CLOSED si lecture échoue (proximité OFF).
**Backend** : nouveau helper `geo.service.ts` `isProximityEnabled()/isCityAllowed(city)` lisant `AppSetting` ; gate en tête de `proximityPing` (avant l.449) ET de chaque endpoint encounter (PX4). Seed des clés via le mécanisme AppSetting admin existant.
**shared-types** : néant.
**Livraison** : API deploy (pas de migration). Flag posé à `false` au déploiement (DARK).
**DoD** : flag OFF prouvé inerte (test) ; flag ON + ville prouvé filtrant ; fail-closed testé.

### PX1 — DOB sur IdentityDocument + gate 18+ + capture à la revue admin (a)  · Prio 4.5 (V5/E2)
**Story** : En tant que plateforme, je veux exiger une date de naissance validée à la revue manuelle de la pièce d'identité, afin de garantir 18+ fiable et bloquer la proximité tant que la DOB est absente.
**Given/When/Then**
- Given un admin qui approuve une pièce, When il valide SANS saisir `dateOfBirth`, Then 400 (DOB obligatoire si `decision='approved'`).
- Given une DOB saisie `< 18 ans` à ce jour, When l'admin approuve, Then approbation possible MAIS l'utilisateur reste **inéligible proximité** (gate `isAdult`).
- Given un user `identityStatus='approved'` mais DOB absente (approuvé avant cette feature), When il ping, Then aucun croisement (gate bloque tant que DOB null).
- Given DOB présente + ≥18 + `approved`, When il ping, Then éligible.
**Contraintes** : Zod ; DOB stockée sur `IdentityDocument` (privé, jamais exposée au public ni au pair) ; ne jamais renvoyer la DOB dans une réponse API destinée à un autre user.
**Backend / prisma** :
- `apps/api/prisma/schema.prisma:728` `IdentityDocument` — ajouter `dateOfBirth DateTime? @db.Date @map("date_of_birth")`. **Migration**.
- `apps/api/src/auth/dto/verify-identity.dto.ts:10` `reviewIdentitySchema` — ajouter `dateOfBirth: z.string().date().optional()` + `.refine(d => d.decision!=='approved' || !!d.dateOfBirth)` (obligatoire à l'approbation) + refus si futur.
- `apps/api/src/auth/auth.service.ts:863` `reviewIdentity(...)` — accepter `dateOfBirth`, le persister sur le doc approuvé (transaction l.878-893). Helper `isAdult(dob)` (≥18 ans) réutilisable.
- Gate proximité (consommé par PX2) : un user n'est éligible que si `identityStatus='approved'` ET il existe un `IdentityDocument` approuvé avec `dateOfBirth` non null et `isAdult`. Exposer `proximityEligible` via une vue/agrégat ou jointure dans la requête matcher.
**Admin review UI** : champ `dateOfBirth` (date picker) dans l'écran de revue des pièces (admin console web `apps/web` — surface qui consomme `admin.service.ts:901 listIdentityDocuments` + `POST` review). Vérifier le câblage exact dans `apps/web` avant impl.
**shared-types** : ajouter `dateOfBirth?` au type de payload review si typé client.
**Livraison** : migration + deploy. Admin = web.
**DoD** : migration verte ; DOB obligatoire à l'approbation prouvée ; gate <18 et DOB-absente prouvés bloquants ; DOB jamais fuitée (vérifié pentest).

### PX2 — Découpler proximité de showOnMap/privacy + anonymiser le payload matcher (b)  · Prio 5.0 (V5/E2) — SPIKE
**Story** : En tant qu'utilisateur discret (profil masqué/privé), je veux pouvoir croiser et être croisé en proximité sans apparaître sur la carte ni révéler mon identité, afin que la proximité soit un canal autonome double-aveugle.
**Given/When/Then**
- Given un pinger `proximityAlerts=true`, `showOnMap=false`, `privacyLevel='private'`, éligible (PX1), When il ping, Then il croise/est croisé normalement (les gates carte ne s'appliquent PLUS).
- Given un croisement, When la notif part vers l'autre, Then elle ne contient NI nom, NI avatar, NI userId du pinger — seulement `encounterId` opaque + bucket de distance.
- Given la réponse du ping au pinger, When `matches[]` revient, Then chaque entrée = `{ encounterId, distance:bucket }` UNIQUEMENT (plus de `userId/name/avatarUrl`).
- Given un user non éligible (PX1 : pas approuvé / pas 18+ / DOB absente), When il ping, Then `{matches:[]}`.
**Contraintes** : aucune coordonnée/distance fine ; le payload ne doit JAMAIS permettre de résoudre l'autre avant `accept` (cf. PX7). Conserver dédup zone/cooldown/familiar Redis existants. Jitter (1–10 min) du signal sortant = anti-corrélation temporelle.
**Backend** : `apps/api/src/geo/geo.service.ts` —
- `proximityPing` gate l.**463-469** : retirer `!pinger.showOnMap` et `pinger.privacyLevel==='private'` ; remplacer par éligibilité PX1 (`approved` + DOB adulte). Garder `proximityAlerts`.
- `updateMany` l.**478-481** : retirer `showOnMap: true` de la clause `where`.
- requête candidats l.**517-521** : retirer `AND show_on_map = TRUE` et `AND privacy_level <> 'private'` ; ajouter `AND identity_status = 'approved'` + jointure éligibilité DOB/adulte.
- notif l.**602-609** : `title` générique (ex. « Quelqu'un est à proximité »), `body` sans nom, `data:{ encounterId }` (PLUS `userId`), `actorId` retiré (ne pas révéler l'acteur via la notif).
- `matches.push` l.**617-622** : renvoyer `{ encounterId, distance: bucket }` seulement (supprimer `userId/name/avatarUrl`). `pingerName` (l.532) devient inutile pour la notif.
- Jitter : différer l'émission de la notif d'un délai aléatoire 1–10 min (queue/scheduled — pas de `setTimeout` volatil en prod ; réutiliser un mécanisme durable s'il existe, sinon table d'attente). **À cadrer avec gwani-architect** si pas de job-runner existant.
**shared-types** : `packages/shared-types/src/proximity.ts` (nouveau) — `EncounterMatch { encounterId; distance:number }`, `ProximityEncounterSummary`.
**Mobile** : `services/geoApi.ts:131-139` (type retour `matches`), `hooks/useProximityAlerts.ts:116` `maybeNotify` (ne plus afficher de nom — heads-up générique « Une rencontre à proximité »).
**Couplage** : livré AVEC PX3 (l'`encounterId` provient de l'encounter). = cœur du spike Sprint 2.
**Livraison** : API deploy. Mobile OTA (pas de bump).
**DoD** : aucun attribut identifiant dans notif/`matches` (test asserte) ; gates carte retirés ; éligibilité PX1 appliquée ; pentest OK sur la dé-anonymisation.

### PX3 — Modèle `ProximityEncounter` + migration + dédup paire non-ordonnée (c)  · Prio 5.0 (V5/E3) — SPIKE
**Story** : En tant que système, je veux matérialiser chaque croisement en un objet mutuel opaque dédupliqué par paire, afin de porter le cycle connect/accept/decline sans jamais lier l'identité avant accord.
**Given/When/Then**
- Given deux users qui se croisent, When le matcher tourne, Then UN seul `ProximityEncounter` existe pour la paire **non ordonnée** (A<B), `status='active'`, `distanceBucket` gelé, `requesterId=null`.
- Given un encounter déjà `active/requested/accepted` pour la paire, When ils se recroisent, Then pas de nouvel objet (idempotent) ; le bucket reste **gelé** (anti-triangulation).
- Given un encounter `declined`, When ils se recroisent, Then **aucun** nouvel encounter (silence — cf. PX5).
- Given lecture d'un encounter par un tiers (ni A ni B), When il tente, Then 404.
**Contraintes** : `encounterId` = uuid opaque, aucun attribut de l'autre stocké en clair côté client ; participants stockés triés `userAId<userBId` ⇒ `@@unique([userAId, userBId])` = dédup non-ordonnée (corrige le risque de double-objet symétrique). `version Int` pour lock optimiste (PX4). Pas d'historique de position dans l'objet (juste bucket + zone).
**Backend / prisma** :
- `schema.prisma` — modèle `ProximityEncounter { id uuid; userAId; userBId; status ProximityEncounterStatus @default(active); requesterId String? ; distanceBucket Int; zone String; version Int @default(0); createdAt; respondedAt DateTime?; expiresAt DateTime? }` + enum `ProximityEncounterStatus { active requested accepted declined expired }` + relations vers `User` (3 FKs : A, B, requester) + `@@unique([userAId, userBId])` + index. **Migration**.
- `geo.service.ts` matcher (boucle l.541-623) : remplacer la création de notif directe par `upsert` de l'encounter pour la paire triée ; si existant non-`active`/`declined` → skip selon règle ; récupérer `encounterId` pour PX2.
**shared-types** : enrichir `proximity.ts`.
**Livraison** : migration + deploy.
**DoD** : migration verte ; dédup non-ordonnée prouvée (A→B et B→A = 1 objet) ; bucket gelé prouvé ; accès tiers = 404.

### PX4 — Endpoints connect/accept/decline + collision (lock optimiste) + plafonds/cooldown/jitter (d)  · Prio 5.0 (V5/E3)
**Story** : En tant qu'utilisateur croisé, je veux pouvoir demander à connecter (je me révèle), accepter ou refuser, afin de transformer un croisement anonyme en lien — avec gestion saine des deux qui cliquent en même temps.
**Given/When/Then**
- Given un encounter `active` dont je suis participant, When `POST /geo/proximity/encounters/:id/connect`, Then `status→requested`, `requesterId=moi` ; l'AUTRE reçoit une notif révélant le demandeur (moi) UNIQUEMENT.
- Given je ne suis PAS participant, When je `connect/accept/decline`, Then **404** (ni 403 — ne pas confirmer l'existence).
- Given l'encounter est `requested` par l'autre, When je `connect`, Then = `accept` (collision) → `accepted`.
- Given `requested` (par l'autre), When j'`accept`, Then `status→accepted`, `Friendship(accepted)` créé/réutilisé, visibilité mutuelle ; je ne peux PAS accepter ma propre demande (`requesterId===moi` → 400).
- Given deux `connect` simultanés, When ils s'exécutent en concurrence, Then le **lock optimiste** (`where:{id,version}`+`version++`) sérialise : 1er=requested, 2e détecté requested-par-l'autre ⇒ accepted (pas de double-transition, pas de perte).
- Given `accepted/declined/expired`, When `connect/accept`, Then 409/400 (transition invalide).
- Given mes plafonds atteints (`connects/jour` ~5–10, `encounters reçus/jour` ~3 puis silence) ou cooldown actif, When j'agis, Then 429.
**Contraintes** : Zod (param `:id` uuid) ; **AuthZ stricte = participant only, sinon 404** (anti-IDOR critique) ; transition d'état atomique sous lock optimiste/transaction ; réutiliser `Friendship(accepted)` en vérifiant les DEUX directions (`@@unique([requesterId,addresseeId])` ordonné `schema.prisma:377` — upsert prudent) ; jitter sur la notif de `connect`.
**Backend** :
- `geo.controller.ts` — `GET /geo/proximity/encounters` (liste anonyme), `POST …/:id/connect|accept|decline` (`@HttpCode(200)`).
- `geo.service.ts` — `listEncounters(userId)`, `connect/accept/decline(userId, encounterId)` ; à l'accept, créer/réutiliser `Friendship(accepted)` (cf. `friends.service.ts:95-115` pour le pattern, réutiliser le service).
- DTO Zod dédiés.
**shared-types** : `proximity.ts` — types réponses connect/accept/decline + liste.
**Livraison** : API deploy.
**DoD** : non-participant=404 prouvé ; collision sans race prouvée (test concurrent) ; plafonds/cooldown 429 prouvés ; Friendship réutilisée sans doublon ; pentest OK (IDOR/rejeu/race).

### PX5 — Anti-spam : dédup paire + interdiction de re-création après decline/block (e)  · Prio 4.0 (V4/E2)
**Story** : En tant qu'utilisateur ayant refusé (ou bloqué) quelqu'un, je veux ne plus jamais être re-sollicité par cette personne via proximité ou amitié, afin de ne pas être harcelé.
**Given/When/Then**
- Given un encounter `declined` pour la paire, When ils se recroisent, Then aucun nouvel encounter ni notif (silence permanent pour cette paire).
- Given A a bloqué B (`Block`), When le matcher tourne, Then aucun encounter (déjà filtré `blockedIds`, vérifier la symétrie).
- Given une `Friendship` `declined` existante, When on re-`sendRequest`, Then **plus de re-send permissif automatique** : aligner sur la règle proximité (corrige `friends.service.ts:71` qui ré-ouvre une `declined` en `pending`).
- Given le block intervient APRÈS un encounter `requested`, When l'autre tente `accept`, Then 403/404 (block prime).
**Contraintes** : pas d'IDOR ; le « decline » ne doit pas révéler qui a refusé (silencieux des deux côtés).
**Backend** :
- `geo.service.ts` matcher : avant upsert encounter, exclure les paires avec encounter `declined` et avec `Block` (l'un OU l'autre sens).
- `apps/api/src/social/friends.service.ts:71` — retirer/durcir le re-send auto d'une `declined` (au minimum : pas de réouverture silencieuse ; décision proprio = bloquer ou exiger un délai). **À confirmer proprio** car ça change le comportement amitié existant.
**Livraison** : API deploy.
**DoD** : re-croisement après decline prouvé silencieux ; block (2 sens) prouvé bloquant ; `friends.service.ts:71` durci + test ; pentest OK (anti-harcèlement/rejeu).

### PX6 — UI mobile : liste rencontres anonymes + écran demande + accept/decline + réglages proximité (f)  · Prio 3.5 (V4/E3) — Sprint 3
**Story** : En tant qu'utilisateur, je veux voir mes rencontres de proximité anonymes, demander à connecter, et répondre aux demandes, afin de vivre le parcours double-aveugle.
**Given/When/Then**
- Given des encounters `active`, When j'ouvre l'écran proximité, Then liste ANONYME (bucket distance, libellé zone, « Demander à connecter ») — aucun nom/avatar.
- Given je tape « connecter », When `POST …/connect`, Then état `requested` (en attente).
- Given une demande reçue (`requested` par l'autre), When j'ouvre la notif, Then écran révélant le DEMANDEUR (nom/avatar) + Accepter/Refuser.
- Given j'accepte, Then visibilité mutuelle + ami ; Given je refuse, Then disparaît, plus de re-sollicitation.
- Given réglages, When je règle mon rayon minimum + toggle notif proximité, Then `proximityAlerts/proximityRadius` persistés (le croisement n'a lieu que si les DEUX consentent — le plus restrictif gagne).
**Contraintes** : aucune fuite avant accept (l'écran liste ne reçoit que `{encounterId,distance}`) ; OTA-safe (pas de module natif). Deep-link notif proximité → écran demande.
**Mobile** : nouvel écran `apps/mobile/app/proximity/index.tsx` + `apps/mobile/app/proximity/[encounterId].tsx` ; `services/geoApi.ts` (listEncounters/connect/accept/decline) ; routing notif `app/settings/notifications.tsx` + `app/_layout.tsx` (type `proximity` → écran demande) ; réglages `app/settings/privacy.tsx:26-28,146-183` (rayon « minimum », libellé consentement mutuel) ; `hooks/useProximityAlerts.ts:116` heads-up générique.
**Livraison** : OTA iOS, **pas de bump**.
**DoD** : parcours démontré ; aucun attribut identifiant côté liste (vérifié) ; deep-link OK.

### PX7 — [TESTS] e2e double-aveugle : aucun des deux ne résout l'autre avant accept (h)  · Prio 5.0 (V5/E2)
**Story** : En tant que garant sécurité, je veux des tests e2e prouvant l'anonymat symétrique jusqu'à l'accept, afin d'empêcher toute régression de fuite.
**Given/When/Then (cas « les deux invisibles »)**
- Given A et B `proximityAlerts=true`, `showOnMap=false`, `privacyLevel='private'`, tous deux `approved`+18+, When ils se croisent, Then chacun obtient un `encounterId` mais AUCUN endpoint accessible ne renvoie l'identité/avatar/userId de l'autre.
- Given B `connect`, When A lit, Then A voit B (demandeur révélé) mais B ne voit toujours pas A.
- Given A `accept`, Then et SEULEMENT alors les deux se résolvent + `Friendship(accepted)`.
- Given un tiers C, When il sonde l'`encounterId`, Then 404.
- Given decline puis re-croisement, Then silence (PX5).
**Backend tests** : `e2e/tests/api/proximity.spec.ts` (Playwright API, cf. `e2e/tests/api/*`). Couvre PX2/PX3/PX4/PX5. + unit Jest sur le matcher anonymisé (`apps/api/src/geo/*.spec.ts`).
**Livraison** : tests (pas de deploy).
**DoD** : suite verte ; un test échoue si on réintroduit `userId/name/avatar` dans notif/`matches`/liste (test de non-régression de fuite).

### PX8 — [SÉCURITÉ] Audit gwani-pentest OBLIGATOIRE du diff proximité  · Prio 5.0 (V5/E1)
**Story** : En tant que proprio, je veux un audit offensif du diff sensible (dé-anonymisation, IDOR, rejeu, race), afin d'obtenir un verdict `OK_TO_DEPLOY` avant toute activation.
**Périmètre** : déanonymisation (peut-on relier `encounterId`→user avant accept ?), IDOR sur `:id` (non-participant), rejeu (re-`connect`/`accept`), race (double connect, lock optimiste), fuite DOB, timing/oracle (404 vs 403), abus plafonds/cooldown, kill-switch contournable.
**Livraison** : verdict `BLOCK_DEPLOY`/`OK_TO_DEPLOY` (corrige+teste). **Gate dur** avant READY_FOR_DEPLOY.
**DoD** : verdict `OK_TO_DEPLOY`, 0 critical/high non résolu.

---

# Sprint Animations — « façon Snapchat » (4 axes validés proprio)

> Demande proprio : système d'animation **sur la carte ET sur les icônes** — fluide, original, beau, façon Snapchat.
> Les 4 axes sont VALIDÉS (tout). Découpage en **2 vagues** selon le critère de livraison mobile :
> **Vague A = OTA-safe** (axes 1 + 3) : reanimated 4.1.7 + worklets 0.5.1 sont DÉJÀ dans le build, animations
> webview = CSS/JS pur ⇒ **aucun module natif ⇒ OTA iOS, PAS de bump** `app.json version` (sinon l'OTA
> orpheline les builds existants). **Vague B = natifs** (axes 2 + 4) : `react-native-maps` ET `lottie-react-native`
> = 2 modules natifs ⇒ **UN SEUL rebuild EAS + UN SEUL bump** (1.7.0 → 1.8.0) couvrant les deux (cf. justif §Vagues).
>
> **Socle réel vérifié (file:line)** : carte = WebView Leaflet `apps/mobile/app/(tabs)/map.tsx`, HTML/JS injecté
> l.58-201 (`renderMarkers` l.135-197 avec `markerLayer.clearLayers()` l.136 = flash actuel ; classes CSS pins
> l.62-77 ; `flyTo` l.107-109 déjà animé ; `drawMe`/zone l.115-124 ; injection l.358-360). Like feed =
> `components/feed/PostCard.tsx` `ActionButton` l.288-315 (Feather heart statique), `handleLike` l.70-77.
> Like commentaire = `components/feed/CommentItem.tsx` heart l.137-141, `handleLike` l.48-55. Tab bar =
> `app/(tabs)/_layout.tsx` `TabIcon` l.18-39 (statique), badge l.32-36. Stories = `app/stories/[authorId].tsx`
> (PAS de like/reply aujourd'hui). `GestureHandlerRootView` au root `app/_layout.tsx:123`. reanimated réellement
> utilisé : `components/ui/Skeleton.tsx`, `Toast.tsx` ; `ReanimatedSwipeable` en prod dans le chat.
>
> **Contraintes perf transverses (à porter dans CHAQUE item, = critères DoD)** :
> - **60fps, zéro jank**. reanimated : tout sur le **thread UI/worklet** (`useSharedValue`/`withSpring`/`withTiming`),
>   JAMAIS de re-render React par frame, pas de `setState` dans une boucle d'anim.
> - **WebView Leaflet** : animer uniquement `transform`/`opacity` (composités GPU), pas de `width/height/top/left`
>   (reflow). Keyframes CSS, `will-change:transform`. **Plafonner** : pas d'anim d'entrée au-delà de ~60 pins
>   visibles (stagger borné), réutiliser/differ les markers au lieu de `clearLayers()` global.
> - Respecter **reduce-motion** (désactiver/raccourcir si l'OS le demande) et dégrader proprement sur entrée de gamme.
> - **Aucune régression `npx tsc --noEmit`** (api + mobile). Démo visuelle obligatoire (capture/vidéo) à la review.

## VAGUE A — OTA-safe (axes 1 + 3) = Sprint Animations v1

### ANIM-1 — [OTA] Carte vivante : entrée des pins (drop + fade + stagger)  · Prio 4.0 (V4/E1)
**Story** : En tant qu'utilisateur ouvrant la carte, je veux que les pins avatars apparaissent en tombant/fondu de façon échelonnée, afin d'une première impression vivante et premium façon Snap Map.
**Given/When/Then**
- Given un viewport avec des pins, When `renderMarkers` s'exécute, Then chaque pin entre par un drop (translateY) + fade (opacity 0→1) avec un léger stagger ; au repos, transform/opacity stables (pas de boucle).
- Given un re-render (pan/zoom léger), When les mêmes pins restent visibles, Then ils ne re-jouent PAS l'entrée (anti-clignotement — diff au lieu de clear global).
- Given > ~60 pins, When ils entrent, Then le stagger est borné/désactivé pour tenir 60fps.
**Contraintes perf** : CSS `@keyframes` sur `transform: translateY()` + `opacity` uniquement ; `animation` posée à l'ajout du divIcon ; ne PAS animer si le pin existait déjà.
**Fichiers** : `apps/mobile/app/(tabs)/map.tsx` — bloc `LEAFLET_HTML` : ajouter keyframes dans `<style>` (l.62-77), classe d'entrée sur `.marker-ind`/`.marker-assoc`/`.marker-page`/`.marker-cluster`, et logique de diff dans `renderMarkers` (l.135-197) pour ne pas `clearLayers()` aveuglément (l.136).
**Livraison** : **[OTA]** front-only (CSS/JS dans la WebView). Pas de bump.
**DoD** : entrée fluide 60fps prouvée (démo) ; pas de re-jeu sur pan ; cap > 60 pins respecté ; tsc vert.

### ANIM-2 — [OTA front + petit ajout API] Pulsation « actif récemment » + halo de proximité  · Prio 3.5 (V4/E1.5)
**Story** : En tant qu'utilisateur, je veux qu'un halo pulsé entoure les personnes actives récemment (et un anneau de proximité autour de « moi »), afin de repérer qui est vivant sur la carte façon Snapchat.
**Given/When/Then**
- Given un membre actif < N min (`activeRecently`), When il est rendu, Then un halo pulse en boucle douce (scale+opacity) sous son avatar ; les inactifs n'ont PAS de halo.
- Given mon marqueur « moi » (`drawMe` l.115-124), When la carte se localise, Then un anneau de proximité animé apparaît (pulse une fois à la localisation, puis statique discret).
- Given le champ d'activité absent (vieux client/API), When je rends, Then dégradation propre = pas de halo (jamais de crash).
**Contraintes** : la pulsation infinie = 1 seul élément CSS animé par pin actif (GPU). **Dépendance backend** (n'empêche PAS l'OTA front, déployée indépendamment) : exposer `activeRecently:boolean` (ou `lastActiveAt`) sur le marqueur individuel — `MapMarker.individual` ne l'a PAS (`apps/mobile/services/geoApi.ts:25-28`). Source : `apps/api/src/geo/geo.service.ts` (select + build marqueur ~l.258-286, dériver de `lastSeenAt`/`updatedAt`). **Pas de migration** si le champ existe déjà sur `User` ; sinon arbitrer. Privacy : ne JAMAIS exposer un horodatage fin — juste un booléen.
**Fichiers** : `apps/mobile/app/(tabs)/map.tsx` (`<style>` keyframe `pulse`, `.marker-ind` halo conditionnel dans `renderMarkers` l.160-169 ; `drawMe` l.115-124 anneau animé) ; `apps/mobile/services/geoApi.ts:25-28` (type) ; `apps/api/src/geo/geo.service.ts` (champ `activeRecently`) ; `packages/shared-types` si le type marqueur y est partagé.
**Livraison** : **[OTA]** front. Backend = deploy dernier commit (pas de migration a priori). Pas de bump mobile.
**DoD** : halo seulement sur actifs ; dégradation si champ absent ; 60fps ; pas de fuite d'horodatage (revue) ; tsc vert.

### ANIM-3 — [OTA] Transitions de cluster douces + recentrage/localisation premium  · Prio 3.0 (V4/E2)
**Story** : En tant qu'utilisateur qui pan/zoome, je veux des transitions de cluster douces et un recentrage fluide, afin que la carte respire au lieu de « sauter ».
**Given/When/Then**
- Given un changement de viewport qui recompose les clusters, When `renderMarkers` re-rend, Then les clusters apparaissent/disparaissent en fondu (pas de flash de `clearLayers`).
- Given un tap « recentrer » (`recenterOnMe`) ou un `flyTo`, When la caméra bouge, Then l'animation a un easing premium (durée/ease cohérents) et le « moi » pulse une fois à l'arrivée.
- Given un cluster dont le `count` change, When il se met à jour, Then une micro-anim (bump scale) signale le changement.
**Contraintes perf** : réutiliser le diff d'ANIM-1 ; fondu via opacity ; pas de relayout.
**Fichiers** : `apps/mobile/app/(tabs)/map.tsx` — `renderMarkers` (l.135-197, diff/fondu clusters l.184-195), `flyTo`/`recenterMe` (l.107-127), injection (l.358-360, `onZoomToCluster` l.547-552).
**Livraison** : **[OTA]** front-only. Pas de bump.
**DoD** : pas de flash sur recompose ; recentrage fluide 60fps ; bump cluster visible ; tsc vert.

### ANIM-4 — [OTA] Heart-burst au like (feed + commentaire + story) + double-tap-to-like (P-09)  · Prio 4.5 (V5/E2)
**Story** : En tant qu'utilisateur, je veux une animation de cœur moderne (burst + particules) au like sur le feed, les commentaires et les stories, et pouvoir double-taper une photo pour liker, afin d'un engagement satisfaisant façon Instagram/Snap.
**Given/When/Then**
- Given un post non liké, When je tape le cœur, Then heart-burst (scale spring + petites particules/rayons) + bascule couleur ; un re-tap (unlike) joue l'anim inverse douce. Optimiste, source de vérité inchangée (`feedApi.toggleLike`).
- Given une photo de post, When je double-tape (P-09), Then un gros cœur apparaît/disparaît au centre + like si non liké (jamais d'unlike au double-tap).
- Given un commentaire, When je tape son cœur, Then micro heart-burst (échelle réduite).
- Given une story, When je tape « j'aime », Then heart-burst (réutilise `POST /posts/:id/like` sur l'id de story, cf. B5a).
**Contraintes perf** : reanimated worklets (`useSharedValue`+`withSpring`/`withSequence`), anim sur le thread UI, AUCUN `setState` par frame ; particules = composant léger réutilisable (`components/ui/HeartBurst.tsx` à créer). Gesture double-tap via `Gesture.Tap().numberOfTaps(2)` (gesture-handler déjà au root `app/_layout.tsx:123`).
**Fichiers** : nouveau `apps/mobile/components/ui/HeartBurst.tsx` ; `apps/mobile/components/feed/PostCard.tsx` (`ActionButton` l.288-315 + `handleLike` l.70-77 + double-tap sur `PhotoGallery` l.263-286) ; `apps/mobile/components/feed/CommentItem.tsx` (heart l.137-141, `handleLike` l.48-55) ; `apps/mobile/app/stories/[authorId].tsx` (ajouter bouton like animé) ; câblage `apps/mobile/app/(tabs)/index.tsx:237` inchangé.
**Livraison** : **[OTA]** JS-only (reanimated déjà natif). Pas de bump.
**DoD** : 60fps sur le burst (démo) ; double-tap = like only ; optimiste cohérent serveur ; tsc vert.

### ANIM-5 — [OTA] Tab bar animée : bounce de l'onglet actif + badge animé  · Prio 3.5 (V4/E1.5)
**Story** : En tant qu'utilisateur, je veux que l'onglet sélectionné rebondisse et que le badge non-lu s'anime, afin d'une navigation vivante façon Snapchat.
**Given/When/Then**
- Given un changement d'onglet, When un onglet devient `focused`, Then son icône joue un bounce (spring scale) ; l'inactif revient à l'échelle 1 en douceur.
- Given un nouveau message, When `unreadTotal` augmente, Then le badge fait un pop (scale) + éventuel halo ; à 0, il disparaît en fondu.
- Given des changements rapides d'onglet, When je tabote vite, Then pas d'accumulation d'anims (interruptibles).
**Contraintes perf** : reanimated worklet sur `focused`/`badge` ; pas de re-render de toute la tab bar.
**Fichiers** : `apps/mobile/app/(tabs)/_layout.tsx` — `TabIcon` (l.18-39) → animer `Feather` (scale sur `focused`) et le badge (l.32-36, pop sur changement de valeur).
**Livraison** : **[OTA]** JS-only. Pas de bump.
**DoD** : bounce 60fps interruptible ; badge pop sur incrément ; tsc vert.

### ANIM-6 — [OTA] Badges animés (vérifié / ambassadeur) + transitions d'icônes  · Prio 2.5 (V3/E1.5)
**Story** : En tant qu'utilisateur, je veux que les badges vérifié/ambassadeur aient une entrée animée et que les bascules d'icônes (ex. ami ajouté) soient fluides, afin d'un produit qui se distingue dans le détail.
**Given/When/Then**
- Given un profil/post vérifié ou ambassadeur, When le badge apparaît, Then entrée pop discrète (scale/rotation légère), une seule fois (pas de boucle).
- Given une bascule d'icône d'action (ex. `user-plus` → `check` après ajout d'ami sur la map sheet), When l'état change, Then cross-fade/scale au lieu d'un switch sec.
**Contraintes perf** : anims one-shot, pas de boucle ; réutilisables.
**Fichiers** : `apps/mobile/components/ui/AmbassadorBadge.tsx` (l.14-25), `apps/mobile/components/ui/VerifiedBadge.tsx` ; transitions d'icônes optionnelles dans `apps/mobile/app/(tabs)/map.tsx` (`IndividualSheet` `friendIcon` l.734-741) et boutons d'action friend.
**Livraison** : **[OTA]** JS-only. Pas de bump.
**DoD** : entrée one-shot ; bascule fluide ; tsc vert.

## VAGUE B — Natifs (axes 2 + 4) = UN SEUL rebuild EAS + UN SEUL bump (1.7.0 → 1.8.0)

> **Justification du regroupement** : `react-native-maps` (axe 2) ET `lottie-react-native` (axe 4) sont tous deux
> des **modules natifs** ⇒ chacun impose un rebuild EAS (l'OTA crasherait). Les livrer ensemble = **un seul
> build iOS + un seul bump `app.json version`** au lieu de deux cycles store. On gèle la Vague A en OTA d'abord
> (valeur immédiate sans rebuild), puis on groupe tout le natif dans le build 1.8.0. **STOP avant build = action
> sortante, approbation proprio obligatoire** (Norton CA + EAS `sidi30`, cf. CLAUDE.md).

### ANIM-7 — [REBUILD+bump] ADR carte native Snapchat : react-native-maps vs @rnmapbox/maps  · Prio 4.0 (V5/E2) — ARCHITECT D'ABORD
**Story** : En tant que proprio, je veux une décision d'architecture documentée avant de migrer la carte Leaflet vers du natif, afin de ne pas casser geo/markers/clustering/proximité.
**Périmètre ADR (gwani-architect)** : choix `react-native-maps` (Google/Apple) vs `@rnmapbox/maps` (style Snap, vector) ; impact sur le contrat `geo/members` (clustering aujourd'hui côté serveur/bounds), portage des markers avatars (divIcon → marqueur natif/Marker custom + anneau story P-04), clustering natif vs serveur, recentrage/proximité, coût (clé API Mapbox ?), **stratégie migration vs cohabitation** (garder Leaflet en web `apps/web`, natif en mobile ?), et plan de non-régression. Produit : ADR + impact sur `app.json` (plugin natif, permissions).
**Fichiers à cadrer** : `apps/mobile/app/(tabs)/map.tsx` (réécriture du rendu), `apps/mobile/services/geoApi.ts`, `apps/api/src/geo/geo.service.ts`, `packages/shared-types`, `app.json` (plugin + version bump).
**Livraison** : ADR (doc). **Pré-requis** d'ANIM-8. Pas de code prod tant que l'ADR n'est pas validé proprio.
**DoD** : ADR écrit + arbitrage lib tranché + plan migration/cohabitation + estimation rebuild.

### ANIM-8 — [REBUILD+bump] Carte native : pins avatars 60fps + anneau de story (P-04) + Snap-glide + clustering natif  · Prio 3.5 (V5/E5)
**Story** : En tant qu'utilisateur, je veux une carte native ultra-fluide façon Snap Map — pins avatars vrais natifs, anneau de story autour de l'avatar (tap → ouvre la story), glisse 60fps, clustering natif — afin d'une expérience carte best-in-class.
**Given/When/Then** (détaillé après ADR ANIM-7)
- Given la lib choisie, When je pan/zoome, Then 60fps natif (vs WebView), pins avatars rendus nativement.
- Given un membre avec story active, When je vois son pin, Then un **anneau de story** (P-04) l'entoure ; tap → ouvre `app/stories/[authorId].tsx`.
- Given une densité de pins, When je dézoome, Then clustering natif fluide.
- Given la proximité/`drawMe`, When localisé, Then parité fonctionnelle avec l'actuel (zone, recenter, sheets).
**Contraintes** : **module natif ⇒ rebuild EAS + bump**. Non-régression totale du parcours carte actuel (sheets, recherche, filtres, friend actions). Réutiliser les endpoints geo existants (sauf décision ADR contraire).
**Fichiers** : `apps/mobile/app/(tabs)/map.tsx` (réécriture rendu carte), `app.json` (plugin + `version`), composant pin natif + anneau story.
**Livraison** : **[REBUILD+bump]** — groupé avec ANIM-9 dans le build 1.8.0.
**DoD** : parité fonctionnelle prouvée (aucune régression sheets/recherche/filtres) ; 60fps natif ; anneau story tap→story ; bug-hunter→fixer→e2e ; build EAS seulement après GO proprio.

### ANIM-9 — [REBUILD+bump] Premium Lottie : like premium, écrans de succès, empty-states animés  · Prio 3.0 (V4/E3)
**Story** : En tant qu'utilisateur, je veux des animations Lottie premium (like premium, écrans de succès, empty-states illustrés), afin d'un produit qui paraît haut de gamme.
**Given/When/Then**
- Given une action de succès (ami accepté, post publié, invitation envoyée), When elle réussit, Then un Lottie de succès joue puis se ferme.
- Given un écran vide (feed/services/recherche sans résultat), When affiché, Then un empty-state illustré animé (vs texte sec actuel).
- Given un like « premium » (option), When déclenché, Then anim Lottie riche (au-delà du heart-burst reanimated d'ANIM-4).
**Contraintes** : `lottie-react-native` = **module natif ⇒ rebuild EAS + bump**. Poids des fichiers `.json` Lottie maîtrisé (lazy/bundle). Ne PAS remplacer ANIM-4 (reanimated reste le défaut OTA-livrable ; Lottie = couche premium).
**Fichiers** : nouveau `apps/mobile/components/ui/LottieSuccess.tsx` / `LottieEmpty.tsx` + assets ; empty-states existants (feed `app/(tabs)/index.tsx`, services `app/(tabs)/services.tsx`, recherche) ; `app.json` (version bump partagé).
**Livraison** : **[REBUILD+bump]** — groupé avec ANIM-8 dans le build 1.8.0.
**DoD** : Lottie jouent sans jank ; poids assets maîtrisé ; build EAS seulement après GO proprio ; e2e visuel.
