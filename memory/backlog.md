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
