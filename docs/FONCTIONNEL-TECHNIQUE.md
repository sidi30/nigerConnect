# NigerConnect — Documentation fonctionnelle & technique

> Source de vérité = **le code** (`apps/api/src`, `apps/api/prisma/schema.prisma`, `apps/mobile/app`).
> Ce document est généré par lecture exhaustive du code (2026-06-29). Pour l'architecture/plan
> de conception, voir [`NigerConnect-Architecture-v2.md`](./NigerConnect-Architecture-v2.md) ;
> pour le déploiement, [`DEPLOY_PLAYBOOK.md`](../DEPLOY_PLAYBOOK.md).

**Conventions rappel** : préfixe global `/api` (sauf `/health`). Validation **Zod** via `ZodValidationPipe`
(le gateway WS rejoue la même validation que le REST). JWT **RS256** (iss/aud vérifiés, révocation par `jti`).
Médias bindés via `S3Service.assertOwnedPublicImage(url, userId)` (clé `users/{userId}/...`). Confidentialité
`public` / `friends` / `private` (un compte `private` ne fuite ni map, ni feed, ni recherche, ni proximité).
Mail = **SMTP IONOS** (`contact@gwani.fr`). Push = **Expo Push**.

> ℹ️ La **Partie 2 (contrat d'API)** fait autorité pour les chemins/méthodes exacts. Les Parties 1, 3 et 4
> décrivent le métier, les parcours et le mobile ; en cas d'écart de nommage d'endpoint, se référer à la Partie 2.

---

## Table des matières

1. [Spécification fonctionnelle (par module)](#partie-1--spécification-fonctionnelle-par-module)
2. [Contrat d'API (REST + WebSocket)](#partie-2--contrat-dapi)
3. [Parcours de bout en bout](#partie-3--parcours-de-bout-en-bout)
4. [Écrans mobile & navigation (expo-router)](#partie-4--écrans-mobile--navigation-expo-router)

---

# Partie 1 — Spécification fonctionnelle (par module)

### Auth

**Rôle**: Gère l'authentification (inscription, connexion, OAuth Google/Apple) et la vérification d'identité (KYC via documents). Contrôle les tokens JWT RS256, les sessions (refresh tokens), et l'accès aux endpoints protégés.

**Fonctionnalités**:
- Inscription email/password + OAuth (Google, Apple)
- Connexion email/password, OAuth, refresh token rotation
- Envoi/vérification email (code 6 chiffres ou lien token)
- Soumission et revue de documents d'identité (passeport, carte ID, permis, titre de séjour)
- **MFA TOTP** (Google Authenticator) pour le staff : enroll → confirm (10 codes de récupération à usage unique) → verify au 2ᵉ facteur · disable · status. Secret chiffré AES-256-GCM. Login d'un compte `mfaEnabled` retourne `{ mfaRequired, mfaToken }` (challenge RS256 court, audience `<aud>:mfa`) au lieu des tokens
- Compte lockdown escaladé après tentatives échouées (mauvais mot de passe ET mauvais code MFA partagent `failedLoginCount` : 5→15min, 10→30min, 15→60min)
- Export RGPD (art. 20) + suppression compte
- Logout révoque token et jti en Redis

**Règles métier / AuthZ**:
- `EmailVerifiedGuard` par défaut sauf endpoints `@Public` et `@AllowUnverified`
- **Statut compte appliqué globalement** : `EmailVerifiedGuard` rejette désormais `banned` (`ACCOUNT_BANNED`) / `suspended` (`ACCOUNT_SUSPENDED`) — verdict jamais caché (levée de sanction immédiate) ; seul l'état *vérifié* est mis en cache positif ~60s
- **MFA staff** : le réglage admin `admin_mfa_required` refuse au login (`MFA_REQUIRED_NOT_ENROLLED`) tout admin/moderator non enrôlé ; garde serveur anti-auto-lockout (impossible d'activer le réglage si soi-même non enrôlé). Le 2ᵉ facteur re-vérifie `status`/`lockedUntil` (fenêtre de 5min)
- Ownership strict : userId JWT vs paramètres
- Password : min 12 chars, 1 majuscule, 1 chiffre, 1 spécial (Zod)
- OAuth Google/Apple : vérifie email_verified avant auto-link
- Anti-takeover : ne link OAuth que si email non-propriétaire ou stub account (no password, no other provider)
- Identity documents : fileUrl doit pointer `s3://S3_PRIVATE_BUCKET/users/{userId}/identity/`
- Identité temporaire : expiresAt = approval + 30j
- Rate limits : register 3/min long 5/h | login 5/min | refresh 5/min | forgot 3/min | mfa/verify 8/min

**Entités Prisma**: User (mfaEnabled, mfaSecret, failedLoginCount, lockedUntil, isAmbassador), RefreshToken, EmailToken, IdentityDocument, MfaRecoveryCode

### Profile

**Rôle**: Gère les profils utilisateur (GET/PATCH infos, avatars, cover, photos, search, données RGPD).

**Fonctionnalités**:
- GET /me, PATCH /me (firstName, lastName, displayName, bio, city, country, lat/lon, languages, privacyLevel, showOnMap, proximityAlerts, proximityRadius)
- Upload avatar/cover (valide propriété S3)
- Galerie photos (presign → add → delete)
- Search profils (q, country, city, cursor, limit)
- Export données RGPD (JSON file ou email attachment)
- GET profil par ID (respecte privacy : public/friends/private, blocks)
- GET /photos/:id, /friends/:id (cursor-based pagination)

**Règles métier / AuthZ**:
- Ownership : updateMe/deleteMe/photos = données propres
- Privacy levels en lecture : public (visible) | friends (amis seulement) | private (owner only)
- Blocks : si bloqué → user not found (404 not 403)
- S3 URLs : avatarUrl/coverUrl validées via `assertOwnedPublicImage(url, userId)` → URL CDN canonique
- Photos presign : contentType enum (image/jpeg, png, webp), kind (avatar, cover, photo, identity)
- Coordonnées géocodées : si city/country change sans lat/lon, recalc depuis city-centroid
- Profile cache (Redis, ~5min TTL) invalidé à chaque update

**Entités Prisma**: User, UserPhoto, Block

### Social

**Rôle**: Amitié et blocage (friend requests, mutual friends, relationship status, suggestions).

**Fonctionnalités**:
- POST /friends/request/:userId → envoie demande (checks blocks, pas déjà amis/demande)
- POST /friends/accept/:friendshipId, decline
- DELETE /friends/:userId
- GET /friends (liste acceptées, cursor) ; GET /friends/requests (incoming), /requests/sent (outgoing)
- GET /friends/mutual/:userId, /relationship/:userId, /suggestions
- GET /friends/search (type-ahead amis acceptés pour les @mentions ; exclut bloqués ; throttle 30/10s)
- POST /blocks/:userId, DELETE /blocks/:userId, GET /blocks

**Règles métier / AuthZ**:
- Ownership : accept/decline = addressee only (Forbidden sinon)
- Anti-spam : sender != addressee
- Blocks : bidirectionnel (blocker → blocked)
- Re-send autorisé si demande déclinée (update status)
- Notifications auto : friend_request (+ actorId), friend_accepted
- Check amitié bidirectionnel : (requester=me AND addressee=target) OR inverse

**Entités Prisma**: Friendship, Block, User

### Feed

**Rôle**: Posts (création, édition, suppression soft), likes, commentaires, stories (24h), partage.

**Fonctionnalités**:
- POST /posts (content, visibility: public|friends|association, media[])
- GET /posts/:id, PATCH /posts/:id, DELETE /posts/:id (soft delete)
- GET /feed (cursor), /users/:userId/posts, /associations/:id/posts
- POST /posts/:id/like (toggle), GET /likes
- POST /posts/:id/comments (content, parentId), GET/PATCH/DELETE comments
- POST /posts/:id/share (caption optionnelle)
- POST /stories, GET /stories/feed, DELETE /stories/:id
- **@mentions** : `MentionsService` parse les tokens `@[Name](uuid)` du contenu post/commentaire et notifie (type `mention`) UNIQUEMENT les amis acceptés (cap fan-out 20)

**Règles métier / AuthZ**:
- Visibility : public (tous) | friends (amis) | association (membres approuvés)
- Association posts : auteur doit être membre approuvé
- Média validé : `assertOwnedPublicImage(mediaUrl, authorId)` par item
- Edit/delete = auteur seulement ; fenêtre d'édition 24h
- Soft delete : deletedAt = now (tombstone, jamais hard delete)
- Stories : isStory=true, storyExpiresAt = now+24h, cron cleanup ; visibilité forcée 'friends'
- Cache feed principal (Redis ~2min), invalidé quand auteur/amis/membres postent
- Compteurs like/comment/share dénormalisés (transactionnel)
- @mentions : UUID dans `@[Name](uuid)` = source de vérité (le nom affiché est cosmétique, re-dérivé au rendu) ; seuls les amis acceptés mentionnés sont notifiés (jamais d'inconnu/bloqué), cap 20

**Entités Prisma**: Post, PostMedia, Like, Comment, Association (membership)

### Chat

**Rôle**: Messages texte/image/file en conversations directes/groupe. WebSocket `/chat` temps réel + REST pour l'historique.

**Fonctionnalités (REST)**: GET /conversations, POST /conversations, GET /conversations/:id, /messages (cursor), POST /messages, PATCH /messages/:id (edit), DELETE /messages/:id (soft), POST /conversations/:id/read.

**Fonctionnalités (WebSocket /chat)**: auth JWT au handshake ; events in `message:send`, `message:read`, `typing:start`, `conversation:focus`, `conversation:blur`, `heartbeat` ; events out `user:online/offline`, `message:*` ; rooms `user:{userId}` (présence) + `conv:{conversationId}` (membres).

**Suppression push en conversation (côté serveur)**: présence "conversation active" en Redis (`PresenceService.setActiveConversation` TTL 120s / `clearActiveConversation` / `activeInConversation`), pilotée par `conversation:focus`/`blur`. `sendMessage` saute l'incrément `unreadCount` ET la notification pour les destinataires en train de regarder la conversation. Ouvrir une conversation (`markAsRead`) marque aussi lues ses notifications `type='message'` → vide le badge cloche. Le `MEMBER_SELECT` chat inclut désormais `identityStatus` + `isAmbassador` (badges vérifié/ambassadeur dans l'en-tête et la liste).

**Règles métier / AuthZ**:
- Ownership : send/edit/delete = sender only
- Membership : `assertMember(userId, conversationId)` avant toute op
- Fenêtre d'édition 15min
- Validation WS : Zod (même schéma que REST)
- Rate limit WS : 30 msg/60s par user (Redis sliding counter)
- Contenu : max ~5000 chars, sanitize control/invisible chars (anti-homograph)
- Média : `assertOwnedPublicImage`
- Soft delete : deletedAt + content/mediaUrl nulled → tombstone
- Présence diffusée uniquement aux conversations partagées
- Block : un bloqué ne peut pas messager le bloqueur

**Entités Prisma**: Conversation, ConversationMember, Message

### Geo

**Rôle**: Localisation (markers carte, autocomplete villes, alertes de proximité).

**Fonctionnalités**: GET /geo/members (bounds), /geo/stats (public), /geo/cities (public, autocomplete), /geo/country/:code (liste paginée des membres visibles d'un pays, filtre `?city=` optionnel), /geo/nearby, POST /geo/proximity/ping.

**Règles métier / AuthZ**:
- Endpoints publics : /stats, /cities
- /geo/country/:code : code ISO-3166-1 alpha-2 (sinon 400) ; même filtre de confidentialité que les pins (`showOnMap`, `status='active'`, `emailVerified`, `privacyLevel≠'private'`, non bloqué, hors soi-même) ; renvoie `identityStatus`+`isAmbassador` par membre
- Villes : min 2 chars, country ISO-3166-1 alpha-2 optionnel
- Bounds : zoom 1–20, type (all|people|associations)
- Nearby/proximity radius max 20km
- Candidat proximité : showOnMap=true AND proximityAlerts=true
- Utilisateurs cachés : status!='banned' AND (showOnMap=true OR owner)
- **Un compte `private` n'apparaît JAMAIS** (map, nearby, proximité) — même pour ses amis
- Coordonnées jittered au signup (~50-200m) pour éviter le stalking exact

**Entités Prisma**: User (latitude, longitude, showOnMap, proximityAlerts, proximityRadius, privacyLevel)

### Marketplace

**Rôle**: Demandes de services (emploi, logement, transport…) et réponses.

**Fonctionnalités**: POST /services, GET /services (filtres), /services/mine, /services/:id, POST /services/:id/respond, GET /services/:id/responses, PATCH /services/:id/resolve, POST /services/:id/rate.

**Règles métier / AuthZ**:
- Ownership : responder voit ses réponses | requester resolve
- Catégories : logement, transport, admin, sante, emploi, business, education, autre
- Workflow : open → in_progress → resolved/closed
- Urgence : urgent, normal
- Rate : 1–5 étoiles, requester note responder après resolve ; unique (serviceId + ratedUserId)
- responseCount dénormalisé

**Entités Prisma**: ServiceRequest, ServiceResponse, ServiceRating

### Association

**Rôle**: Groupes communautaires avec posts, événements, gestion des rôles.

**Fonctionnalités**: CRUD associations, join/leave, invite, change role, members (public), pending (admin), approve/reject, events, /events/upcoming.

**Règles métier / AuthZ**:
- Delete = créateur seulement
- Statut membre : pending | approved | rejected (requiresApproval=true → pending au join)
- Rôles : admin, moderator, member
- Posts visibilité 'association' → membres approuvés seulement
- Notifications au join/approval/rejection
- memberCount dénormalisé

**Entités Prisma**: Association, AssociationMember, AssociationEvent

### Notification

**Rôle**: Push (via Expo) + historique in-app (expiration 24h par défaut).

**Fonctionnalités**: GET /notifications (auto-purge expirées), /unread-count, PATCH /:id/read, /read-all, DELETE /:id, /clear-all, POST /register-device, DELETE /device.

**Règles métier / AuthZ**:
- Ownership : mark read/delete = recipient only
- Expiration 24h par défaut (expiresAt), purge à chaque list()
- Push fire-and-forget via Expo (n'échoue pas l'API)
- PushToken unique (userId, token)
- Types : friend_request, friend_accepted, like, comment, mention, message, service_response, association_invite, association_join_*, identity_*, proximity, page_follow, poll_new, review_received, system

**Entités Prisma**: Notification, PushToken

### Moderation

**Rôle**: Signalements (users, posts, messages, associations, commentaires).

**Fonctionnalités**: POST /reports, GET /reports (admin/moderator), PATCH /reports/:id/resolve.

**Règles métier / AuthZ**:
- TargetTypes : user, post, message, association, comment
- Reasons : spam, harassment, inappropriate, fake_identity, scam, other
- Statut : pending → reviewed → resolved | dismissed
- Actions : warning, content_removed, suspended, banned, none
- N'importe qui signale ; admin/moderator traite (RolesGuard)

**Entités Prisma**: Report

### Newsletter

**Rôle**: Abonnement landing + campagnes email admin.

**Fonctionnalités (public)**: POST /newsletter/subscribe (toujours 200), GET /newsletter/unsubscribe?token= (page HTML).
**Fonctionnalités (admin)**: subscribers, campaigns (draft/send/test), PATCH/DELETE campaign.

**Règles métier / AuthZ**:
- Endpoints publics sans auth
- Dedup email (lowercase + trim)
- Token unsubscribe opaque 64-char hex unique ; header List-Unsubscribe par abonné (RGPD/CAN-SPAM)
- Rate limit subscribe : 5/min long 20/h

**Entités Prisma**: NewsletterSubscriber, NewsletterCampaign

### Admin

**Rôle**: Console interne (web `tenant.nigerconnect.app`) : métriques, documents d'identité, **gestion des utilisateurs**, **badge ambassadeur**, **réglages** et **sécurité (MFA staff)**.

**Fonctionnalités**:
- Métriques : GET /admin/metrics, /metrics/timeseries?days=, /metrics/breakdowns
- Identité : GET /admin/identity (par statut, URLs presigned)
- **Utilisateurs** : GET /admin/users (paginé, recherche `q` + filtre `status`), GET /admin/users/search (type-ahead léger pour le badge), PATCH /admin/users/:id/status (active|suspended|banned), PATCH /admin/users/:id (édite champs profil + role), DELETE /admin/users/:id, PATCH /admin/users/:id/ambassador
- **Réglages** : GET/PATCH /admin/settings (registrationMode, defaultInviteQuota, inviteExpiryDays, adminMfaRequired)

**Règles métier / AuthZ**:
- RolesGuard : admin/moderator ; opérations sensibles (édition champ+role, delete, ambassador, PATCH settings, users/search) = **admin only**
- **Gardes anti-abus** : pas d'auto-action (statut/role/delete sur soi-même) ; un moderator ne peut pas toucher le staff (admin/moderator)
- Statut : `suspended`/`banned` révoque tous les refresh tokens de l'utilisateur (atomique)
- Champs éditables : displayName, firstName, lastName, city, countryCode, bio, role (email NON éditable)
- DELETE réutilise `ProfileService.deleteAccount` (cascade FK + nettoyage S3)
- **Badge ambassadeur** (`isAmbassador`) : distinction curatée admin, INDÉPENDANTE du badge identité-vérifiée (affiché à côté)
- **Sécurité MFA** : activer `adminMfaRequired` exige que l'admin ait lui-même enrôlé son TOTP (anti-auto-lockout)
- Identity view : URLs S3 presigned GET (privé, courte durée)

**Entités Prisma**: User (isAmbassador, status, role, mfaEnabled), IdentityDocument, Report, Post, AppSetting (clé/valeur : admin_mfa_required, registration_mode, default_invite_quota, invite_expiry_days)

### Review (avis)

**Rôle**: Notes/commentaires sur utilisateurs ou pages.

**Fonctionnalités**: POST /reviews (upsert), GET /reviews/:targetType/:targetId, /summary, DELETE /reviews/:id.

**Règles métier / AuthZ**:
- Upsert/delete = auteur only
- Unique (authorId, targetUserId) | (authorId, targetPageId)
- Agrégats ratingAvg/ratingCount dénormalisés sur User/Page
- Pas d'auto-review

**Entités Prisma**: Review, User, Page

### Page

**Rôle**: Entités créées par utilisateurs (community/cause/business/official/group), followers, admins, polls.

**Fonctionnalités**: CRUD pages, /pages/mine, follow/unfollow, admins (list/set role/remove).

**Règles métier / AuthZ**:
- Kinds : community, cause, business, official, group
- Delete/update = créateur | admin
- followerCount + agrégats reviews dénormalisés

**Entités Prisma**: Page, PageFollower, PageAdmin, Review

### Poll

**Rôle**: Sondages (single/multi-choice, optionnellement rattachés à une page).

**Fonctionnalités**: POST /polls, GET /polls (filtre pageId), /polls/:id, POST /polls/:id/vote, DELETE /polls/:id/vote (retract), DELETE /polls/:id.

**Règles métier / AuthZ**:
- Delete = auteur only
- SingleChoice : 1 vote/(poll,user) | MultiChoice : plusieurs optionIds
- Expiration : now + expiresInHours (max ~30j)
- voteCount dénormalisé ; unique (pollId, userId, optionId)

**Entités Prisma**: Poll, PollOption, PollVote

### Health

**Rôle**: Probes liveness/readiness (style Kubernetes).

**Fonctionnalités**: GET /health/live (process up), /health/ready (DB + Redis), /health (alias ready).

**Règles métier**: public ; live ne renvoie jamais 5xx ; ready → 503 si DB/Redis down ; exclu du préfixe `/api`.

---

# Partie 2 — Contrat d'API

### Auth

| Méthode | Chemin | Auth | Body/Params | Réponse | Codes erreur |
|---------|--------|------|-------------|---------|--------------|
| POST | /api/auth/register | Public | `{ email, password, firstName, lastName, phone?, city?, countryCode?, bio?, avatarUrl?, latitude?, longitude? }` (registerSchema) | `{ user, tokens: { accessToken, refreshToken } }` | 409 (email/phone exists), 400 (coords) |
| POST | /api/auth/login | Public | `{ email, password, deviceName? }` | `{ user, tokens }` | 401 (bad creds), 403 (locked/suspended/banned) |
| POST | /api/auth/google | Public | `{ idToken, nonce?, deviceName? }` | `{ user, tokens }` | 401 (unverified email), 409 (takeover) |
| POST | /api/auth/apple | Public | `{ identityToken, fullName?, email?, rawNonce?, deviceName? }` | `{ user, tokens }` | 401, 409 (takeover) |
| POST | /api/auth/refresh | Public | `{ refreshToken }` | `{ user, tokens }` | 401 (invalid/reused) |
| POST | /api/auth/logout | JWT (AllowUnverified) | `{ refreshToken }` | 204 | — |
| GET | /api/auth/me | JWT (AllowUnverified) | — | `{ user }` | 404 |
| POST | /api/auth/forgot-password | Public | `{ email }` | 204 | — (ne fuite pas l'existence) |
| POST | /api/auth/reset-password | Public | `{ token, password }` | 204 | 400 (token invalide/expiré) |
| POST | /api/auth/verify-email/send | JWT (AllowUnverified) | — | 204 | — |
| POST | /api/auth/verify-email/code | JWT (AllowUnverified) | `{ code }` (6 chiffres) | `{ ok: true }` | 400 (wrong/expired/locked) |
| GET | /api/auth/verify-email | Public | `?token=…` | 302 redirect ou `{ ok, message }` | — |
| POST | /api/auth/identity/submit | JWT (EmailVerified) | `{ documentType, fileUrl }` | 202 `{ status: "pending" }` | 400 (bad fileUrl) |
| GET | /api/auth/identity/status | JWT (EmailVerified) | — | `{ status, latestSubmission, rejectionReason }` | — |
| PATCH | /api/auth/identity/review | JWT (Admin/Moderator) | `{ userId, decision, reason? }` | `{ status }` | 404, 403 |
| POST | /api/auth/mfa/verify | Public | `{ mfaToken, code, deviceName? }` (2ᵉ facteur) | `{ user, tokens }` | 401 (bad code / locked / banned) |
| POST | /api/auth/mfa/enroll | JWT | — | `{ secret, otpauthUrl }` | — |
| POST | /api/auth/mfa/confirm | JWT | `{ code }` (6–20) | `{ recoveryCodes: string[] }` (×10, montrés une seule fois) | 400 |
| POST | /api/auth/mfa/disable | JWT | `{ code }` (TOTP ou code de récupération) | 204 | 400 |
| GET | /api/auth/mfa/status | JWT | — | `{ mfaEnabled }` | — |

`POST /api/auth/login` d'un compte `mfaEnabled` renvoie `{ mfaRequired: true, mfaToken }` (challenge RS256, audience `<aud>:mfa`) au lieu de `{ user, tokens }` → le client poursuit sur `/api/auth/mfa/verify`.

**Rate limits** : register 3/min 5/h · login 5/min 20/15min · google/apple 10/min 60/h · refresh 5/min 30/15min · forgot 3/min 10/h · verify-email/code 5/min 20/h · mfa/verify 8/min 30/15min.

### Profile

| Méthode | Chemin | Auth | Body/Params | Réponse | Codes |
|---------|--------|------|-------------|---------|-------|
| GET | /api/profile/me | JWT (EmailVerified) | — | `{ user }` (SelfUser) | 404 |
| PATCH | /api/profile/me | JWT (EmailVerified) | `{ firstName?, lastName?, displayName?, bio?, city?, countryCode?, latitude?, longitude?, showOnMap?, proximityAlerts?, proximityRadius?, languages?, privacyLevel? }` | `{ user }` | 400 |
| PATCH | /api/profile/me/avatar | JWT (EmailVerified) | `{ avatarUrl }` (url\|null) | `{ user }` | 400 (bad S3) |
| PATCH | /api/profile/me/cover | JWT (EmailVerified) | `{ coverUrl }` (url\|null) | `{ user }` | 400 (bad S3) |
| DELETE | /api/profile/me | JWT (EmailVerified) | — | 204 | — |
| GET | /api/profile/me/export | JWT (EmailVerified) | — | fichier JSON | 404 |
| POST | /api/profile/me/export/email | JWT (EmailVerified) | — | 202 `{ ok: true }` | 404 |
| GET | /api/profile/search | JWT (EmailVerified) | `?q=&country=&city=&cursor=&limit=` | `{ items: [PublicUser], nextCursor? }` | — |
| POST | /api/profile/me/photos/presign | JWT (EmailVerified) | `{ contentType, kind }` | `{ url: presignedUrl, … }` | 400 |
| POST | /api/profile/me/photos | JWT (EmailVerified) | `{ url, thumbnailUrl?, caption?, sortOrder? }` | `{ id, url, … }` | 400 (bad S3) |
| DELETE | /api/profile/me/photos/:photoId | JWT (EmailVerified) | — | 204 | 404 |
| GET | /api/profile/:id | JWT (EmailVerified) | — | `{ user }` (privacy gated) | 404 (bloqué/inexistant) |
| GET | /api/profile/:id/photos | JWT (EmailVerified) | `?cursor=&limit=` | `{ items: [UserPhoto], nextCursor? }` | 404 |
| GET | /api/profile/:id/friends | JWT (EmailVerified) | `?cursor=&limit=` | `{ items: [PublicUser], nextCursor? }` | 404 |

Pagination cursor-based, limit clampé 1–100.

### Social

| Méthode | Chemin | Auth | Réponse | Codes |
|---------|--------|------|---------|-------|
| POST | /api/friends/request/:userId | JWT | `{ id, status: "pending", … }` | 400 (self), 403 (blocked), 404, 409 (déjà ami/pending) |
| POST | /api/friends/accept/:friendshipId | JWT | `{ id, status: "accepted" }` | 404, 403 (not addressee), 400 |
| POST | /api/friends/decline/:friendshipId | JWT | `{ id, status: "declined" }` | 404, 403, 400 |
| DELETE | /api/friends/:userId | JWT | 204 | — |
| GET | /api/friends | JWT | `{ items: [{ friend, friendship }], nextCursor? }` | — |
| GET | /api/friends/requests | JWT | `{ items: [{ requester, friendship }] }` | — |
| GET | /api/friends/requests/sent | JWT | `{ items: [{ addressee, friendship }] }` | — |
| GET | /api/friends/mutual/:userId | JWT | `{ items: [PublicUser] }` | — |
| GET | /api/friends/relationship/:userId | JWT | `{ status, direction? }` | — |
| GET | /api/friends/suggestions | JWT | `{ items: [PublicUser] }` | — |
| GET | /api/friends/search | JWT | `?q=` → `{ items: [PublicUser] }` (amis acceptés, exclut bloqués ; throttle 30/10s) | — |
| POST | /api/blocks/:userId | JWT | 204 | 400 (self), 404 |
| DELETE | /api/blocks/:userId | JWT | 204 | — |
| GET | /api/blocks | JWT | `{ items: [PublicUser] }` | — |

### Feed

| Méthode | Chemin | Auth | Body/Params | Codes |
|---------|--------|------|-------------|-------|
| POST | /api/posts | JWT | `{ content?, visibility, associationId?, media?: [{ mediaUrl, thumbnailUrl?, mediaType, width?, height?, blurhash?, sortOrder? }] }` | 400, 403 (not member) |
| GET | /api/posts/:id | JWT | — | 404 (non visible) |
| PATCH | /api/posts/:id | JWT | `{ content?, visibility? }` | 404, 403 (not author / hors fenêtre) |
| DELETE | /api/posts/:id | JWT | — | 404, 403 |
| GET | /api/feed | JWT | `?cursor=&limit=` (1–50) | — |
| GET | /api/users/:userId/posts | JWT | `?cursor=&limit=` | — |
| GET | /api/associations/:id/posts | JWT | `?cursor=&limit=` | — |
| POST | /api/posts/:id/like | JWT | — → `{ liked }` | 404 |
| GET | /api/posts/:id/likes | JWT | `?cursor=&limit=` | 404 |
| POST | /api/posts/:id/comments | JWT | `{ content, parentId? }` | 404, 400 |
| GET | /api/posts/:id/comments | JWT | `?cursor=&limit=` | 404 |
| PATCH | /api/comments/:id | JWT | `{ content }` | 404, 403 |
| DELETE | /api/comments/:id | JWT | — | 404, 403 |
| POST | /api/posts/:id/share | JWT | `{ content? }` | 404 |
| POST | /api/stories | JWT | `{ content?, media: { mediaUrl, … } }` | 400 |
| GET | /api/stories/feed | JWT | — | — |
| DELETE | /api/stories/:id | JWT | — | 404, 403 |

Fenêtre d'édition post/comment : 24h.

### Chat (REST)

| Méthode | Chemin | Auth | Body/Params | Codes |
|---------|--------|------|-------------|-------|
| GET | /api/conversations | JWT | `?cursor=&limit=` | — |
| POST | /api/conversations | JWT | `{ participantIds: [uuid] (1–50), name? }` | 400 |
| GET | /api/conversations/:id | JWT | — | 403 (not member), 404 |
| GET | /api/conversations/:id/messages | JWT | `?cursor=&limit=` (max 100) | 403, 404 |
| POST | /api/conversations/:id/messages | JWT | `{ content?, messageType, mediaUrl?, replyToId? }` (content ou mediaUrl requis) | 403, 404, 400 |
| POST | /api/conversations/:id/read | JWT | — | 403, 404 |
| PATCH | /api/messages/:id | JWT | `{ content }` (max 5000) | 403 (not sender / hors fenêtre), 404 |
| DELETE | /api/messages/:id | JWT | — (soft delete) | 403, 404 |

Fenêtre edit/delete : 15min.

### Chat (WebSocket)

**Namespace** `/chat`. **Handshake** : token JWT en query `?token=<JWT>` (validation RS256 + jti blacklist + EmailVerified). Rejet si auth échoue.

**Events entrants**

| Event | Payload | Validation | Réponse |
|-------|---------|-----------|---------|
| `message:send` | `{ conversationId: uuid, content?, messageType, mediaUrl?, replyToId? }` | Zod sendMessageSchema | `{ ok, messageId?, error? }` |
| `message:read` | `{ conversationId: uuid, messageId? }` | uuid | (avale erreurs) |
| `typing:start` | `{ conversationId: uuid }` | room membership | broadcast only |
| `heartbeat` | — | — | — |

**Events sortants (scopés par room)** : `user:online` / `user:offline` (rooms `conv:{id}`, exclut sender) · `message:new` / `message:updated` / `message:deleted` · `message:read` (`{ userId, lastReadAt }`) · `typing:start`. **Rate limit** : 30 msg/60s par user (Redis).

### Geo

| Méthode | Chemin | Auth | Body/Params | Codes |
|---------|--------|------|-------------|-------|
| GET | /api/geo/members | JWT | `?north=&south=&east=&west=&zoom=&type=` | 400 |
| GET | /api/geo/stats | Public | — | — |
| GET | /api/geo/cities | Public | `?q=(min 2)&country=&limit=` | 400 |
| GET | /api/geo/country/:code | JWT | `?city=&cursor=&limit=(1–50)` → `{ items, nextCursor?, total? }` (membres visibles) | 400 (code ≠ ISO-2) |
| GET | /api/geo/nearby | JWT | `?lat=&lon=&radius=(≤20km)&limit=` | 400 |
| POST | /api/geo/proximity/ping | JWT | `{ lat, lon }` | 400 |

### Marketplace

| Méthode | Chemin | Auth | Body/Params | Codes |
|---------|--------|------|-------------|-------|
| POST | /api/services | JWT | `{ title, description?, category, urgency, budget?, city?, countryCode? }` | 400 |
| GET | /api/services | JWT | `?category=&country=&urgency=&status=&sort=&cursor=&limit=` | — |
| GET | /api/services/mine | JWT | — | — |
| GET | /api/services/:id | JWT | — | 404 |
| POST | /api/services/:id/respond | JWT | `{ message }` | 404 |
| GET | /api/services/:id/responses | JWT | — | 403, 404 |
| PATCH | /api/services/:id/resolve | JWT | — | 403, 404 |
| POST | /api/services/:id/rate | JWT | `{ ratedUserId, rating, comment? }` | 404, 409 (duplicate) |

### Association

| Méthode | Chemin | Auth | Body/Params | Codes |
|---------|--------|------|-------------|-------|
| POST | /api/associations | JWT | `{ name, description?, logoUrl?, coverUrl?, category, countryCode, city, website?, contactEmail?, requiresApproval? }` | 400 |
| GET | /api/associations | JWT | `?category=&country=&cursor=&limit=` | — |
| GET | /api/associations/mine | JWT | — | — |
| GET | /api/associations/:id | JWT | — | 404 |
| PATCH | /api/associations/:id | JWT | `{ name?, … }` | 403, 404 |
| DELETE | /api/associations/:id | JWT | — | 403, 404 |
| POST | /api/associations/:id/join | JWT | — | 409, 404 |
| DELETE | /api/associations/:id/leave | JWT | — | 404 |
| POST | /api/associations/:id/invite | JWT | `{ userId }` | 403, 404 |
| PATCH | /api/associations/:id/members/:userId/role | JWT | `{ role }` | 403, 404 |
| GET | /api/associations/:id/members | JWT | `?cursor=&limit=` | — |
| GET | /api/associations/:id/pending | JWT | `?cursor=&limit=` | 403, 404 |
| POST | /api/associations/:id/members/:userId/approve | JWT | — | 403, 404 |
| POST | /api/associations/:id/members/:userId/reject | JWT | `{ reason? }` | 403, 404 |
| POST | /api/associations/:id/events | JWT | `{ title, description?, eventDate, location?, coverUrl? }` | 403, 404 |
| GET | /api/associations/:id/events | JWT | — | 404 |
| GET | /api/events/upcoming | JWT | `?limit=` | — |

### Notification

| Méthode | Chemin | Auth | Body | Codes |
|---------|--------|------|------|-------|
| GET | /api/notifications | JWT | `?cursor=&limit=` | — |
| GET | /api/notifications/unread-count | JWT | — | — |
| PATCH | /api/notifications/:id/read | JWT | — | 404 |
| PATCH | /api/notifications/read-all | JWT | — | — |
| DELETE | /api/notifications/:id | JWT | — | 404 |
| DELETE | /api/notifications/clear-all | JWT | — | — |
| POST | /api/notifications/register-device | JWT | `{ token, platform }` | 400 |
| DELETE | /api/notifications/device | JWT | `{ token }` | — |

### Moderation

| Méthode | Chemin | Auth | Body | Codes |
|---------|--------|------|------|-------|
| POST | /api/reports | JWT | `{ targetType, targetId, reason, description? }` | 400, 404 |
| GET | /api/reports | JWT (Admin/Mod) | `?status=&cursor=&limit=` | 403 |
| PATCH | /api/reports/:id/resolve | JWT (Admin/Mod) | `{ action, note? }` | 403, 404 |

### Newsletter

| Méthode | Chemin | Auth | Body | Réponse |
|---------|--------|------|------|---------|
| POST | /api/newsletter/subscribe | Public | `{ email, source?, locale? }` | `{ ok: true }` (toujours 200) |
| GET | /api/newsletter/unsubscribe | Public | `?token=` | page HTML |

Rate limit subscribe : 5/min 20/h.

### Admin

| Méthode | Chemin | Auth | Params | Codes |
|---------|--------|------|--------|-------|
| GET | /api/admin/metrics | JWT (Admin/Mod) | — | 403 |
| GET | /api/admin/metrics/timeseries | JWT (Admin/Mod) | `?days=(7–90)` | 403, 400 |
| GET | /api/admin/metrics/breakdowns | JWT (Admin/Mod) | — | 403 |
| GET | /api/admin/identity | JWT (Admin/Mod) | `?status=&cursor=&limit=` (fileUrl presigned) | 403 |
| GET | /api/admin/users | JWT (Admin/Mod) | `?q=&status=&cursor=&limit=(1–100)` → `{ items, nextCursor }` | 403 |
| GET | /api/admin/users/search | JWT (Admin) | `?q=(min 2)&limit=(1–50)` | 403 |
| PATCH | /api/admin/users/:id/status | JWT (Admin/Mod) | `{ status: active\|suspended\|banned }` (révoque refresh tokens si ≠ active) | 403 (self / moderator vs staff), 404 |
| PATCH | /api/admin/users/:id | JWT (Admin) | `{ displayName?, firstName?, lastName?, city?, countryCode?, bio?, role? }` | 403 (self role), 404 |
| DELETE | /api/admin/users/:id | JWT (Admin) | — (cascade + S3) | 403 (self), 404 |
| PATCH | /api/admin/users/:id/ambassador | JWT (Admin) | `{ value: boolean }` → `{ id, isAmbassador }` | 403, 404 |
| GET | /api/admin/settings | JWT (Admin/Mod) | — → `{ registrationMode, defaultInviteQuota, inviteExpiryDays, adminMfaRequired }` | 403 |
| PATCH | /api/admin/settings | JWT (Admin) | `{ registrationMode?, defaultInviteQuota?, inviteExpiryDays?, adminMfaRequired? }` | 400 (MFA non enrôlé), 403 |

### Review

| Méthode | Chemin | Auth | Body | Codes |
|---------|--------|------|------|-------|
| POST | /api/reviews | JWT | `{ targetType, targetId, rating, comment? }` (upsert) | 400 |
| GET | /api/reviews/:targetType/:targetId | JWT | `?cursor=&limit=` | 400, 404 |
| GET | /api/reviews/:targetType/:targetId/summary | JWT | — | 400, 404 |
| DELETE | /api/reviews/:id | JWT | — | 403, 404 |

### Page

| Méthode | Chemin | Auth | Body | Codes |
|---------|--------|------|------|-------|
| POST | /api/pages | JWT | `{ name, description?, kind, avatarUrl?, coverUrl?, countryCode, city, website?, contactEmail? }` | 400 |
| GET | /api/pages | JWT | `?kind=&country=&q=&cursor=&limit=` | — |
| GET | /api/pages/mine | JWT | — | — |
| GET | /api/pages/:id | JWT | — | 404 |
| PATCH | /api/pages/:id | JWT | `{ name?, … }` | 403, 404 |
| DELETE | /api/pages/:id | JWT | — | 403, 404 |
| POST | /api/pages/:id/follow | JWT | — → `{ followed }` | 404 |
| DELETE | /api/pages/:id/follow | JWT | — | 404 |
| GET | /api/pages/:id/admins | JWT | — | 404 |
| PATCH | /api/pages/:id/admins/:userId | JWT | `{ role }` | 403, 404 |
| DELETE | /api/pages/:id/admins/:userId | JWT | — | 403, 404 |

### Poll

| Méthode | Chemin | Auth | Body | Codes |
|---------|--------|------|------|-------|
| POST | /api/polls | JWT | `{ question, options: [string], multiChoice?, pageId?, expiresInHours? }` | 400 |
| GET | /api/polls | JWT | `?pageId=&cursor=&limit=` | — |
| GET | /api/polls/:id | JWT | — | 404 |
| POST | /api/polls/:id/vote | JWT | `{ optionIds: [uuid] }` | 404, 400 |
| DELETE | /api/polls/:id/vote | JWT | — | 404 |
| DELETE | /api/polls/:id | JWT | — | 403, 404 |

### Health

| Méthode | Chemin | Auth | Réponse | Codes |
|---------|--------|------|---------|-------|
| GET | /health/live | Public | `{ status, service, timestamp, uptime }` | — |
| GET | /health/ready | Public | `{ status, checks: { db, redis } }` | 503 |
| GET | /health | Public | (alias /ready) | 503 |

### Détails transverses

- **JWT (RS256)** : claims `sub` (userId), `role`, `identityStatus`, `exp`, `iat`, `jti`. iss/aud vérifiés. Access ~15min, refresh ~7j (hashé en DB). Blacklist `jti` en Redis au logout. Header `kid` dérivé du hash de la clé publique.
- **Médias & S3** : presign → `users/{userId}/{kind}/...` (bucket public, CDN) ; documents identité → `users/{userId}/identity/...` (bucket privé, presigned GET). Validation `assertOwnedPublicImage(url, userId)`.
- **Mailer (SMTP IONOS)** : templates sendEmailVerification, sendWelcome, sendPasswordReset, sendIdentityApproved, sendDataExport. Fire-and-forget (n'échoue pas l'API).
- **Push (Expo)** : `PushService.sendToUser(userId, title, body, data)` ; PushToken (userId, token, platform). Fire-and-forget.
- **Throttling** : décorateurs `@Throttle()`, buckets short (1min) / medium (15min) / long (1h).
- **Erreurs** : existence de ressource toujours 404 (jamais 403) pour ne pas fuiter ; énumération email → 204 (forgot-password, subscribe).
- **Env** : valeurs de référence dans `apps/api/.env.example` (ne pas dupliquer de secrets ici).

---

# Partie 3 — Parcours de bout en bout

## 1. Inscription → activation email → premier accès feed

```
1. [Mobile] POST /api/auth/register
   ├─ Body: registerSchema (email, password [min 12, 1 maj, 1 chiffre, 1 spécial], firstName, lastName, city?, countryCode?, latitude?, longitude?)
   ├─ Zod (ZodValidationPipe) + rate limit IP: 3/60s, 5/3600s
2. [API] AuthService.register()
   ├─ Dédup: User.findFirst({email|phone})
   ├─ Hash: PasswordService.hash() → Argon2id
   ├─ Géo: si lat/lon client → resolveCityCentroid() + validation ≤150km (anti-spoof) ; sinon geocode(city, countryCode)
   ├─ User.create({ …, emailVerified: false })
   ├─ Fire-and-forget sendVerificationEmail():
   │  ├─ EmailTokenService.createWithCode(userId, 'verify_email') → { token, code(6 chiffres) }
   │  └─ MailerService.sendEmailVerification() via SMTP IONOS contact@gwani.fr ; lien APP_WEB_URL/verify-email?token=…
   └─ TokenService.issueTokens() → JWT RS256 { sub, role, identityStatus, jti } + refresh (hashé, 7j)
3. [DB] User créé (emailVerified=false, role=user, identityStatus=not_submitted, status=active)
4. [Email] code 6 chiffres + lien de vérification
5. [Mobile] saisie code OU clic lien:
   ├─ A: POST /api/auth/verify-email/code { code } (5/60s, 20/3600s) → consumeCode → User.updateMany({emailVerified:false}→true)
   └─ B: GET /api/auth/verify-email?token=… → consume(token) → emailVerified=true
6. [API] 1ʳᵉ vérif → sendWelcome() (fire-and-forget)
7. [Guard] EmailVerifiedGuard bloque tout sauf @Public / @AllowUnverified
8. [Feed] GET /api/feed → PostsService.getFeed(userId) : amis + blocks chargés, filtre visibilité, cache Redis ~120s
```
**Sécurité** : Argon2id · rate limit IP · token email TTL 24h · code 6 chiffres lock après N essais · EmailVerifiedGuard global · validation coordonnées.

## 2. Connexion OAuth (Google / Apple)

```
1. [Mobile] SDK natif → idToken/identityToken → POST /api/auth/google|apple (10/60s, 60/3600s)
2. [API] GoogleOAuthService.verifyIdToken / AppleVerifierService.verify:
   ├─ Fetch JWKS live, vérifie RS256, iss/aud, nonce (anti-replay)
   ├─ Refuse si email_verified=false (anti-takeover)
   └─ Apple: l'email du token prime sur l'email client
3. loginWithOAuth(provider, providerId, profile):
   ├─ User.findFirst({ oauthProvider, oauthProviderId })
   ├─ Si email existe sur autre compte → safeToLink (pas de password, pas d'autre provider) sinon ConflictException (anti-takeover)
   ├─ Sinon User.create({ …, emailVerified: true }) — garde de concurrence @@unique([oauthProvider, oauthProviderId])
   └─ TokenService.issueTokens() (même format que password)
```
**Modèle** : User.oauthProvider (google|apple), oauthProviderId, @@unique([oauthProvider, oauthProviderId]).

## 3. Publier un post avec photo + story 24h

```
1. [Mobile] GET /api/profile/me/photos/presign { contentType, kind } → S3Service.createPresignedUpload → key users/{userId}/posts/{uuid}.jpg + uploadUrl (15min) + publicUrl(CDN) ; puis PUT binaire sur uploadUrl
2. [Mobile] POST /api/posts { content?, media[], visibility, associationId? }
   └─ PostsService.create():
      ├─ visibility='association' → vérifie AssociationMember approved (sinon Forbidden)
      ├─ chaque mediaUrl → assertOwnedPublicImage(mediaUrl, authorId) (clé users/{authorId}/…, HeadObject, content-type image, taille) → URL canonique
      ├─ Post.create({ media:{create:[…]}, isStory:false, deletedAt:null })
      └─ invalidateFeedCache(authorId) + feeds amis ; si association → feeds des membres
3. [Feed] getFeed(userId) WHERE deletedAt null, isStory false, authorId NOT IN blocked, OR[ own | public & author non-private | ami & (public|friends) | association ∈ mes assos ] ORDER createdAt DESC
4. [Story] POST /api/stories → assertOwnedPublicImage → Post.create({ isStory:true, visibility:'friends' (forcé), storyExpiresAt:now+24h }) ; cron soft-delete expirées
```
**Confidentialité** : posts d'un profil `private` invisibles aux étrangers · posts association = membres approuvés seulement · posts d'un bloqué → 404 · fenêtre d'édition 24h.

## 4. Chat temps réel (Socket.io + REST)

```
1. [Mobile] GET /api/conversations (membership scoping, orderBy lastMessageAt)
2. [Mobile] GET /api/conversations/{id}/messages (assertMember, messages supprimés → tombstone)
3. [WS] handshake /chat : verifyAsync(token RS256, iss/aud) + jti blacklist → join user:{userId} + conv:{convId} ; PresenceService.markOnline (scopé membres)
4. [WS] message:send → rate limit 30/60s → Zod → ChatService.sendMessage:
   ├─ assertMember ; si mediaUrl → assertOwnedPublicImage ; sanitize (control/zero-width/bidi)
   ├─ Message.create ; Conversation.update(lastMessageAt)
   └─ broadcast conv:{id} 'message:new' + user:{id} 'conversation:updated'
5. [REST alt] POST /api/conversations/{id}/messages → mêmes validations → ChatGateway.broadcastNewMessage
6. [WS] message:read → ConversationMember.lastReadAt=now → broadcast (clients calculent ✓✓) ; typing:start/stop ; heartbeat
7. [Offline] PushService.sendToUser(recipient, …, { conversationId, senderId }) via Expo Push
```
**Sécurité** : JWT au handshake · ownership sender · membership gate · rate limit Redis · sanitization · média ownership · fenêtre 15min · pas de message vers un bloqué.

## 5. Carte communautaire (géolocalisation)

```
1. [Mobile] GET /api/geo/members { bounds, zoom, type } → GeoService.getMarkers:
   ├─ cache Redis ~300s ; blockedIds + memberships chargés
   ├─ zoom<4 → clusters pays | 4–8 → clusters ville | ≥9 → individus
   └─ individus: User IN bounds, status active, emailVerified, showOnMap, !blocked, EXCLUT privacyLevel='private'
2. [Privacy] private = jamais sur map (tout zoom), ni search, ni proximité ; posts = owner+amis only
3. [Proximity] POST /api/geo/proximity/ping { lat, lon } → geohash zones → users public|friends, showOnMap, !blocked, distance ≤ radius (JAMAIS private)
   ├─ dedup zone TTL 8h, habitual 3 jours/14j (mute), cap 50 matches/ping
   └─ PushService.sendToUser "X est à proximité"
4. [Cities] GET /api/geo/cities?q=&country= (public) → WorldCitiesService.search (accent-insensible, tri population)
5. [Stats] GET /api/geo/stats (public) → counts par pays
```
**Marqueurs** : CountryCluster · CityCluster · IndividualMarker · AssociationMarker · PageMarker.

## 6. RGPD — export données + suppression de compte

```
EXPORT:
- GET /api/profile/me/export (1/60s, 5/jour) → fichier JSON (Content-Disposition attachment)
- POST /api/profile/me/export/email → MailerService.sendDataExport (JSON joint)
- exportUserData(userId): Promise.all User(sans passwordHash/mfaSecret/oauthProviderId) + photos, friendships, blocks, posts, likes, comments, conversationMemberships, messages(les siens), services, associationMemberships, notifications, reports, identityDocuments(sans fileUrl), pushTokens, refreshTokens
- JSON _meta { exportedAt, format: nigerconnect-rgpd-v1, "credentials never exported" }

SUPPRESSION:
- DELETE /api/profile/me → deleteAccount(userId):
  ├─ collecte clés S3 (avatar, cover, photos, identity)
  ├─ User.delete() → CASCADE FK (posts, comments, likes, photos, tokens, friendships, blocks, conversationMembers, messages, services, associationMembers, notifications, reports, reviews)
  ├─ invalidateProfileCache(userId)
  └─ best-effort S3 cleanup (public + privé) via Promise.allSettled
- Suppression TOTALE (pas de tombstone) — RGPD art.17 ; messages restent côté pairs (qui ont leur propre export)
```
**Sécurité** : jamais d'export de passwords/MFA/oauthProviderId · messages des pairs référencés par id+nom · suppression cascade complète.

## 7. Connexion staff avec MFA TOTP (double authentification)

```
ENRÔLEMENT (console admin, une fois) :
1. POST /api/auth/mfa/enroll → { secret, otpauthUrl } ; le web rend un QR (qrcode) scanné dans Google Authenticator
2. POST /api/auth/mfa/confirm { code } → vérifie le code live, mfaEnabled=true, renvoie 10 codes de récupération (hashés SHA-256, usage unique) montrés UNE fois
   └─ secret stocké chiffré AES-256-GCM (mfa-secret.service)

LOGIN EN 2 ÉTAPES :
1. POST /api/auth/login { email, password } → AuthService détecte mfaEnabled
   └─ NE renvoie PAS les tokens → { mfaRequired: true, mfaToken } (challenge RS256 court, audience <aud>:mfa)
2. POST /api/auth/mfa/verify { mfaToken, code, deviceName? } :
   ├─ valide le challenge + accepte TOTP 6 chiffres (fenêtre ±1) OU code de récupération (consommé, usedAt)
   ├─ re-vérifie status (banned/suspended) + lockedUntil (la fenêtre de 5min a pu changer)
   ├─ mauvais code → registerFailedLogin() (même escalade que le mot de passe : 5→15min, 10→30min, 15→60min)
   └─ succès → TokenService.issueTokens() (format normal { user, tokens })

POLITIQUE admin_mfa_required :
- Réglage activable via PATCH /api/admin/settings { adminMfaRequired:true } — refusé si l'admin courant n'a pas lui-même enrôlé (anti-auto-lockout)
- Une fois actif : tout admin/moderator sans MFA est refusé au login → 403 MFA_REQUIRED_NOT_ENROLLED
```
**Sécurité** : secret chiffré AES-256-GCM · codes de récupération hashés à usage unique · challenge dédié (audience `:mfa`) non échangeable contre un access token · mauvais codes alimentent le lockout · re-check statut au 2ᵉ facteur.

### Récap gardes/validation par flux

| Flux | Garde principale | Détail |
|------|-----------------|--------|
| Inscription | Zod + Argon2id + rate limit IP | token 24h, code lock |
| OAuth | JWKS RS256 + email_verified + anti-takeover | nonce anti-replay |
| MFA staff | challenge `:mfa` + TOTP/recovery + re-check statut | secret AES-256-GCM, mauvais codes → lockout |
| Posts | EmailVerifiedGuard + S3 ownership + visibilité | private caché, association membres-only, 404 not 403 |
| Chat | JWT handshake + membership + ownership | rate 30/60s, sanitize, edit 15min |
| Geo | exclusion `private` + blocks | dedup proximité anti-spam |
| RGPD | pas de credentials exportés + cascade FK | suppression totale |

---

# Partie 4 — Écrans mobile & navigation (expo-router)

### 1. Arbre de navigation

```
apps/mobile/app/
├── _layout.tsx (Root: AuthGate + NotificationDeepLink + Stack)
│   ├── (auth) → groupe auth
│   └── (tabs) → navigation à onglets
├── (auth)/
│   ├── _layout.tsx
│   ├── welcome.tsx              → /
│   ├── login.tsx               → /(auth)/login
│   ├── register.tsx            → /(auth)/register (flux 3 étapes)
│   └── forgot-password.tsx     → /(auth)/forgot-password
├── (tabs)/
│   ├── _layout.tsx (Tabs + socket chat + proximity + notifs foreground)
│   ├── index.tsx               → /(tabs)/        (Feed + stories + friend requests)
│   ├── map.tsx                 → /(tabs)/map     (Leaflet WebView + géoloc)
│   ├── services.tsx            → /(tabs)/services (Entraide, filtres)
│   ├── messages.tsx            → /(tabs)/messages (Conversations + amis online)
│   └── profile.tsx             → /(tabs)/profile  (Mon profil + menu settings)
├── verify-email.tsx            → /verify-email     (code 6 chiffres / universal link)
├── complete-profile.tsx        → /complete-profile (post-OAuth: ville/pays)
├── reset-password.tsx          → /reset-password   (depuis email link)
├── chat/new.tsx                → /chat/new         [modal]
├── chat/[id].tsx               → /chat/[id]        (messages, images, edit 15min, typing)
├── post/new.tsx                → /post/new         [modal]
├── post/edit/[id].tsx          → /post/edit/[id]   [modal]
├── post/[id].tsx               → /post/[id]        (post + commentaires)
├── stories/new.tsx             → /stories/new      [fullscreen modal]
├── stories/[authorId].tsx      → /stories/[authorId] (viewer 5s/story, progress)
├── user/[id].tsx               → /user/[id]        (profil public + ajout ami + reviews)
├── associations/new.tsx        → /associations/new [modal] (identity verified requis)
├── associations/[id].tsx       → /associations/[id] (détail + join/leave + posts)
├── pages/new.tsx               → /pages/new        [modal]
├── pages/index.tsx             → /pages            (mes pages)
├── pages/[id].tsx              → /pages/[id]       (page + follow + polls + reviews)
├── services/[id].tsx           → /services/[id]    (détail + répondre)
├── settings/
│   ├── _layout.tsx
│   ├── edit-profile.tsx        → /settings/edit-profile
│   ├── identity.tsx            → /settings/identity
│   ├── photos.tsx              → /settings/photos
│   ├── associations.tsx        → /settings/associations
│   ├── requests.tsx            → /settings/requests
│   ├── notifications.tsx       → /settings/notifications
│   ├── privacy.tsx             → /settings/privacy
│   ├── language.tsx            → /settings/language
│   └── delete-account.tsx      → /settings/delete-account
├── friends/index.tsx           → /friends          (search/friends/received/sent/suggestions)
├── photos/viewer.tsx           → /photos/viewer    [fullscreen modal]
└── legal/{index,terms,privacy,community}.tsx → /legal/*
```

### 2. Écrans — rôle & données API

| Fichier | Route | Rôle | Endpoint(s) API | Auth |
|---------|-------|------|-----------------|------|
| (auth)/welcome.tsx | / | Splash + stats communauté | GET /geo/stats, GET /associations | Non |
| (auth)/login.tsx | /(auth)/login | Email/mdp + OAuth Apple/Google | POST /auth/login (+ /auth/google\|apple) | Non |
| (auth)/register.tsx | /(auth)/register | Inscription 3 étapes (profil→ville→review) | POST /auth/register | Non |
| (auth)/forgot-password.tsx | /(auth)/forgot-password | Récup mdp | POST /auth/forgot-password | Non |
| verify-email.tsx | /verify-email | Code 6 chiffres / lien | POST /auth/verify-email/code, /send | Oui |
| complete-profile.tsx | /complete-profile | Post-OAuth: ville/pays | PATCH /profile/me | Oui |
| reset-password.tsx | /reset-password | Nouveau mdp (email link) | POST /auth/reset-password | Non |
| (tabs)/index.tsx | /(tabs)/ | Feed infini + stories + demandes | GET /feed, /stories/feed, /friends/requests | Oui |
| (tabs)/map.tsx | /(tabs)/map | Carte Leaflet + clustering (tap cluster pays/ville → liste membres, sans auto-zoom ; pinch = pins) | GET /geo/members, /geo/country/:code, POST /geo/proximity/ping | Oui |
| (tabs)/services.tsx | /(tabs)/services | Entraide (filtres) | GET /services | Oui |
| (tabs)/messages.tsx | /(tabs)/messages | Conversations + amis online | GET /conversations, /friends | Oui |
| (tabs)/profile.tsx | /(tabs)/profile | Mon profil + menu | GET /profile/me, /friends, /profile/:id/photos, /associations/mine | Oui |
| chat/new.tsx | /chat/new | Créer conversation | GET /friends | Oui |
| chat/[id].tsx | /chat/[id] | Thread + média + typing + accusés de lecture (✓ gris/✓✓ bleu) + heure d'envoi ; émet `conversation:focus`/`blur` | GET /conversations/:id, /messages | Oui |
| post/new.tsx | /post/new | Composer (visibilité) | POST /posts, /profile/me/photos/presign | Oui |
| post/edit/[id].tsx | /post/edit/[id] | Éditer post | PATCH /posts/:id | Oui |
| post/[id].tsx | /post/[id] | Post + commentaires | GET /posts/:id, /comments | Oui |
| stories/new.tsx | /stories/new | Photo + caption | POST /stories | Oui |
| stories/[authorId].tsx | /stories/[authorId] | Viewer story | GET /stories/feed, DELETE /stories/:id | Oui |
| user/[id].tsx | /user/[id] | Profil public + ami + reviews | GET /profile/:id, /friends/relationship, /reviews | Oui |
| associations/[id].tsx | /associations/[id] | Détail + feed + join | GET /associations/:id, /posts | Oui |
| associations/new.tsx | /associations/new | Créer (identity verified) | POST /associations | Oui |
| pages/index.tsx | /pages | Mes pages | GET /pages/mine | Oui |
| pages/[id].tsx | /pages/[id] | Page + polls + reviews + follow | GET /pages/:id, /polls | Oui |
| pages/new.tsx | /pages/new | Créer page | POST /pages | Oui |
| services/[id].tsx | /services/[id] | Détail + répondre | GET /services/:id, POST /respond | Oui |
| settings/edit-profile.tsx | /settings/edit-profile | Éditer profil + avatar | PATCH /profile/me, /photos/presign | Oui |
| settings/identity.tsx | /settings/identity | Vérif identité | POST /auth/identity/submit | Oui |
| settings/photos.tsx | /settings/photos | Galerie | GET /profile/:id/photos, presign | Oui |
| settings/associations.tsx | /settings/associations | Mes associations | GET /associations/mine | Oui |
| settings/requests.tsx | /settings/requests | Mes demandes services | GET /services/mine | Oui |
| settings/notifications.tsx | /settings/notifications | Prefs push | register/delete device | Oui |
| settings/privacy.tsx | /settings/privacy | privacyLevel + bloqués | PATCH /profile/me, GET /blocks | Oui |
| settings/language.tsx | /settings/language | FR/EN | local | Oui |
| settings/delete-account.tsx | /settings/delete-account | Suppression compte | DELETE /profile/me | Oui |
| friends/index.tsx | /friends | 5 onglets amis | GET /friends, /requests, /sent, /suggestions, POST /profile/search | Oui |
| photos/viewer.tsx | /photos/viewer | Image fullscreen | URL S3 presigned | Non |
| legal/* | /legal/* | CGU / privacy / community | statique | Non |

### 3. Navigation & gardes

**AuthGate** (`_layout.tsx`) — état session via Zustand `useAuthStore`, hydraté au boot depuis `secureStore` → `GET /auth/me`. Redirection :
```
1. non auth + hors (auth)/reset-password → /(auth)/welcome
2. auth + email non vérifié + hors /verify-email → /verify-email
3. auth + OAuth (emailVerified mais countryCode null) + hors /complete-profile → /complete-profile
4. auth + vérifié + countryCode + sur (auth) → /(tabs)
```
**Splash** : `preventAutoHideAsync()` jusqu'à fonts chargées + session hydratée → `hideAsync()` (évite le flash login→feed).

**Deep-link push** (`NotificationDeepLink`) : route selon `data` → conversationId→/chat, postId→/post, pageId→/pages, associationId→/associations, requestId→/services, userId(proximity)→/user, friend_*→/friends. Cold-start via `getLastNotificationResponseAsync`, warm via `addNotificationResponseReceivedListener`.

**Token** (`services/api.ts`, `secureStore.ts`) : tokens en SecureStore (iOS Secure Enclave / Android Keystore). Intercepteur injecte `Authorization: Bearer` ; 401 → refresh (mono-vol) ; 403 emailUnverified → handler → redirect AuthGate.

### 4. State & data

**Stores Zustand** : `authStore` (user, isHydrated, isAuthenticated ; hydrate/login/register/logout/deleteAccount) · `inAppNotificationStore` (bannière unique) · `toastStore` (toast transient, auto-hide).

**TanStack Query (v5)** : staleTime 30s, gcTime 24h, networkMode online, persistance AsyncStorage (throttle 1s). Clés : `['feed']`, `['stories']`, `['conversations']`, `['post', id]`, `['profile', userId]`, `['friends', …]`, `['associations', …]`, `['services', …]`, `['geo','stats']`, `['notifications','unread-count']`, `['polls', id]`.

**WebSocket** (`hooks/useSocket.ts`) : Socket.IO `/chat`, `auth:{token}`, reconnection backoff. Monté UNE fois dans `(tabs)/_layout.tsx` (évite double socket). `message:new` → invalide `['conversations']` + `['notifications']` + bannière in-app si pas dans la conv. Singleton via `getChatSocket()`, cleanup au logout.

### 5. Modules natifs Expo

| Module | Usage | Écrans |
|--------|-------|--------|
| expo-camera / image-picker | prise/picker photo | post/new, stories/new, edit-profile, photos, identity |
| expo-location | carte + proximity | (tabs)/map, useProximityAlerts |
| expo-notifications | push + bannières foreground | (tabs)/_layout, feed |
| expo-secure-store | stockage tokens chiffré | login/logout (global) |
| expo-media-library | save image galerie | photos/viewer |
| expo-file-system / image-manipulator | resize/compress/temp | uploadService, mediaService |
| expo-web-browser | fallback OAuth | login/register |
| expo-apple-authentication | Sign in with Apple | login, register |
| react-native-google-signin | Sign in with Google | login, register |

Permissions `app.json` : iOS NSCamera/NSPhotoLibrary/NSLocationWhenInUse · Android camera, read media images, post notifications, coarse/fine location · blockedPermissions : read external storage, record audio, background location.

### 6. Détails techniques

- **Pagination curseur** : `useInfiniteQuery`, `CursorPage<T> = { items, nextCursor? }`.
- **Optimistic UI** : chat (message pending avant POST), posts (spinner + toast).
- **Pipeline upload** : pickImage → manipulate (resize/quality par kind) → presign → PUT S3 → publicUrl → POST API.
- **Prefetch images** : avatars amis après auth (fire-and-forget).
- **Offline** : `onlineManager` ↔ NetInfo, queries pausées hors-ligne, OfflineBanner.
- **Typing / read receipts** : `typing:start/stop` (timeout 2.5s) ; `message:read` → `peerLastReadAt` (monotone) : `createdAt ≤ peerLastReadAt` ⇒ lu (✓✓ bleu `#34B7F1`), sinon envoyé (✓ gris) ; heure `HH:MM`. Fenêtre édition/suppression image 15min (alignée serveur).
- **Présence en conversation** : `chat/[id].tsx` émet `conversation:focus` à l'ouverture et `conversation:blur` au démontage → le serveur supprime push + badge non-lu tant qu'on regarde le fil.
- **@mentions** : `MentionInput` (déclencheur `@`, recherche amis debounced 200ms via `GET /friends/search`, sérialise `@[Name](uuid)`) dans le composer post et l'input commentaire ; `MentionText` rend les tokens en liens oranges tappables dans `PostCard`/`CommentItem` (`utils/mentions.ts`).
- **Badge ambassadeur** : `components/ui/AmbassadorBadge` (étoile dorée `#E8A300`) rendu à côté du badge vérifié partout où `user.isAmbassador` (profil, map, messages, chat, amis, services, posts).

**Build** : Expo SDK 54 · expo-router v6 (typed routes) · bundleId `com.nigerconnect.app` · version 1.3.0 · supportsTablet false · newArchEnabled true · scheme `nigerconnect://` · OAuth Apple+Google · push Expo · EAS Update (runtimeVersion=appVersion) · Sentry initialisé avant le render.
