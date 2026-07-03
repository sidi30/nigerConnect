# ADR — Pipeline vidéo « stories-first » (beta)

**Version:** 1.0
**Date:** 2026-07-03
**Architecte:** gwani-architect
**Statut global:** Accepted (contrat figé — bloque S-VIDEO-1/2/3)
**Sprint:** S-BETA « La diaspora prend vie » — item S-VIDEO-0
**Livrable jumeau:** `memory/video-api-contracts.json`

---

## Vue d'ensemble

La vidéo entre dans NigerConnect **par les stories** (éphémère 24h), **cohorte verified-only**,
**compression 100% on-device (H.265)**, **stockage MinIO self-host avec purge + lifecycle**,
**zéro transcode serveur** (pas de ffmpeg sur l'hôte partagé). Le risque n°1 est le **disque** :
il est borné par une triple garde (TTL cron + lifecycle MinIO + garde disque globale fail-closed).
Le feed permanent vidéo est **hors scope** de cette beta.

Cet ADR fige le **contrat** (presign, garde média, bornage disque, quotas, kill-switch, modération,
privacy) sans coder la feature. Les défauts raisonnables sont **appliqués** ; ce qui exige un GO
proprio explicite est **balisé `⛔ GO PROPRIO`**.

---

## Décisions proprio verrouillées (rappel, non re-débattues)

1. **Stories-first** — vidéo éphémère 24h uniquement en beta ; feed permanent plus tard (gated).
2. **Verified-only** — publier une vidéo exige `identityStatus = 'approved'`.
3. **Modération avec garde-fous** — risque T&S résiduel accepté, borné par : cohorte verified +
   kill-switch `video_enabled` (fail-closed) + `Report` existant → takedown (soft-delete + purge S3) +
   rate-limit + SLA retrait manuel proprio.
4. **Approche A** — compression on-device H.265, clip court, cap taille dur, MinIO + lifecycle/purge,
   zéro transcode serveur.

---

## Joints de code réels (vérifiés — point de départ de l'implémentation)

| Joint | Fichier:ligne | État constaté |
|---|---|---|
| Garde média image | `apps/api/src/common/storage/s3.service.ts:212` `assertOwnedPublicImage` | Image-only (allowlist `image/jpeg\|png\|webp\|heic`, cap 15 Mo). HEAD confronte le **Content-Type réel** à l'allowlist, MAIS le `mediaType` **déclaré client** n'est **jamais** confronté au HEAD → **spoofing image↔vidéo possible**. |
| Delete objets | `s3.service.ts:243` `deleteObject` / `:255` `deletePrivateObject` | Existent, non câblés au cycle stories. |
| Presign download privé | `s3.service.ts:153` `createPresignedDownload` (cap 15 min) | Existe (identity docs, chat). |
| Presign upload | `s3.service.ts:108` `createPresignedUpload({folder,contentType,visibility})` | Générique ; folder = `users/{userId}/{kind}` côté profil (`profile.service.ts:578`). |
| Création story | `apps/api/src/feed/posts.service.ts:123-152` | `assertOwnedPublicImage(dto.media.mediaUrl, authorId)`, `visibility:'friends'`, `isStory:true`, `storyExpiresAt=now+24h`. |
| Purge stories expirées | `posts.service.ts:598` `deleteExpiredStories` | `updateMany` = **soft-delete DB seul, AUCUNE purge S3** → dette disque. Cron horaire `feed/stories.cron.ts`. |
| Delete story manuel | `posts.service.ts deleteStory` | Soft-delete seul, **pas de purge S3**. |
| Takedown modération | `apps/api/src/moderation/moderation.service.ts removeContent(post)` | Soft-delete `post.deletedAt`, **pas de purge S3**. Report/resolve : `moderation.controller.ts`. |
| DTO story | `apps/api/src/feed/dto/post.dto.ts:33` `createStorySchema` + `postMediaSchema:3` (`mediaType: enum['image','video']`). |
| Schéma média | `apps/api/prisma/schema.prisma:221` `enum MediaType{image video}` + `PostMedia` complet (mediaType/thumbnailUrl/width/height/blurhash) | **Quasi aucune migration média.** |
| AppSetting | `schema.prisma:1128` + `common/settings/settings.service.ts` `getSetting(key,default)` | Cache Redis write-through ; **fail-safe = renvoie le default** en cas d'échec DB/Redis. |
| Report | `schema.prisma:579` + enums `ReportTargetType{...post...}` / `ReportAction{content_removed...}` | Complet. `targetType='post'` couvre les stories. |
| minio-init | `docker-compose.prod.yml:153` | `mc mb` + `mc anonymous set` seulement — **AUCUN `mc ilm` lifecycle**. |
| Identity gate | JWT porte `identityStatus` (`current-user.decorator.ts`) ; lecture DB fraîche modèle `association.service.ts:43-45` (`identityStatus !== 'approved' → 403`). |
| Mobile | `apps/mobile/app.json` — aucun module vidéo ; micro **OFF** (`microphonePermission:false`, `RECORD_AUDIO` dans `blockedPermissions`). version `1.9.0`. |
| Throttler | `common/throttle/throttle.module.ts` (named limiters `short`/`medium`/`long`), `@Throttle` per-route. |

---

## Architecture Decision Records

### ADR-001 — Presign vidéo dédié, gaté à la source

**Statut:** Accepted
**Contexte:** Le presign profil (`/profile/me/photos/presign`) est image-only et non gardé
verified/kill-switch. Distribuer une URL d'upload vidéo à un compte non-verified ou quand la vidéo
est OFF gaspille du disque et contourne la cohorte.
**Décision:** Nouvel endpoint **`POST /stories/presign`** (contrôleur feed, `@Controller()` → `/api/stories/presign`).
Il applique **avant** de signer : (1) kill-switch `video_enabled` fail-closed, (2) gate verified-only
(lecture DB fraîche), (3) throttle + quota upload quotidien. Content-Types autorisés **`video/mp4` +
`video/quicktime`** uniquement. Clé sous préfixe éphémère **`stories/{userId}/{uuid}.{mp4|mov}`**
(voir ADR-003 pour le choix du préfixe). Bucket **public** (parité images, ADR-007). TTL presign **900 s**
(upload mobile lent sur réseau NE/diaspora). Réponse = shape `PresignedUpload` existant.
**Alternatives:**
- **Étendre le presign profil** — Simple / mais mélange domaines disque (users permanent vs stories éphémère) et rend le gating verified/kill-switch transverse fragile → Rejetée.
- **Presign non gardé + gating au create seulement** — moins de code / mais on signe des uploads pour des objets qui seront refusés → disque gaspillé, DoS disque trivial → Rejetée.
**Conséquences:**
- ✅ Un objet vidéo ne peut atterrir sur MinIO que si l'utilisateur est verified ET la vidéo est ON.
- ✅ Séparation nette des domaines disque (`stories/` purgeable vs `users/` permanent).
- ⚠️ Le presign ne peut pas garantir durée/résolution du clip (pas de ffprobe) — enforcement côté client + cap **taille** serveur au binding (ADR-002).

---

### ADR-002 — `assertOwnedPublicMedia` : garde média unifiée anti-spoofing

**Statut:** Accepted
**Contexte:** `assertOwnedPublicImage` ne confronte jamais le `mediaType` **déclaré client** au
Content-Type **réel** du HEAD. Dès que la story accepte la vidéo, un client peut déclarer
`mediaType:'video'` en pointant un objet image (ou l'inverse) et casser les invariants d'affichage/quota.
**Décision:** Ajouter dans `S3Service` :

```ts
// cap vidéo dédié — 25 Mo (ADR-006)
static readonly MAX_PUBLIC_VIDEO_BYTES = 25 * 1024 * 1024;
private static readonly ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

/**
 * Garde média générique au binding. Confirme l'hôte + ownership (préfixe requis),
 * HEAD l'objet, et — nouveauté — CONFRONTE le Content-Type RÉEL au mediaType
 * DÉCLARÉ par le client (rejet si divergence), puis applique le cap de taille du type.
 * @param requiredPrefix préfixe clé exigé (ex. `stories/{ownerId}/` ou `users/{ownerId}/`).
 */
async assertOwnedPublicMedia(
  url: string,
  expectedMediaType: 'image' | 'video',
  requiredPrefix: string,
): Promise<string>
```

Logique : `parsePublicKey` → `key.startsWith(requiredPrefix)` sinon 400 « Media does not belong to you » →
HEAD → `realType = head.ContentType`. Détermine `realKind` (`image` si ∈ ALLOWED_IMAGE, `video` si ∈
ALLOWED_VIDEO, sinon 400 « Unsupported media type »). **Si `realKind !== expectedMediaType` → 400
« Declared media type does not match uploaded file »** (ferme le spoof). Cap : image 15 Mo, vidéo 25 Mo
via `ContentLength`. Retourne l'URL CDN canonique.

`assertOwnedPublicImage` **reste** (photos/avatars/covers/associations) — refactorable en wrapper
`assertOwnedPublicMedia(url,'image',`users/${ownerId}/`)` mais **non obligatoire** pour cette story.
**Point d'appel:** `posts.service.createStory` remplace l'appel actuel par
`assertOwnedPublicMedia(dto.media.mediaUrl, dto.media.mediaType, `stories/${authorId}/`)`.
**Alternatives:**
- **Ne garder que le cap taille** — laisse le spoof mediaType ouvert (affichage cassé, quota déjouable) → Rejetée.
- **Transcode/ffprobe serveur pour valider le conteneur** — viole approche A (CPU sur hôte partagé) → Rejetée.
**Conséquences:**
- ✅ Spoofing image↔vidéo fermé côté serveur (source de vérité = HEAD réel).
- ✅ Un seul garde pour tous les futurs médias.
- ⚠️ Content-Type = celui figé par le presign PUT ; un client honnête l'a réglé au moment de l'upload. Le cap **taille** est l'enforcement dur ; durée/codec restent une promesse client (borné par cohorte verified + report).

---

### ADR-003 — Préfixe éphémère `stories/` séparé du permanent `users/`

**Statut:** Accepted
**Contexte:** Le lifecycle MinIO (`mc ilm`) filtre par **préfixe depuis la racine du bucket**. Impossible
d'exprimer `users/*/story/` (userId au milieu) en une règle. Or `users/` contient aussi avatars/covers/photos
**permanents** : une règle d'expiration sur `users/` les détruirait.
**Décision:** Les médias de story vivent sous un **préfixe de tête dédié** :
`stories/{userId}/{uuid}.{ext}` (bucket public). Le lifecycle et la purge s'appliquent à `stories/`
sans jamais toucher `users/`. L'ownership est vérifié via `requiredPrefix = stories/{ownerId}/` (ADR-002).
**Alternatives:**
- **`users/{id}/story/` + lifecycle par tag objet** — MinIO supporte l'expiration par tag, mais il faudrait tagger chaque PUT (le client presigné ne pose pas de tag fiable) → fragile → Rejetée.
- **Bucket MinIO séparé `nigerconnect-stories`** — lifecycle trivial / mais +1 bucket, +config Traefik CDN, +ACL → surcoût ops sur hôte contraint pour zéro bénéfice vs préfixe → Rejetée.
**Conséquences:**
- ✅ Une règle `mc ilm` unique couvre 100% des stories, zéro risque sur le média permanent.
- ✅ La garde disque peut cibler `stories/` conceptuellement.
- ⚠️ `createPresignedUpload` doit accepter `folder='stories/{userId}'` (déjà générique — OK).

---

### ADR-004 — Bornage disque : triple garde (le cœur)

**Statut:** Accepted
**Contexte:** Disque = risque n°1 sur VPS partagé. Un seul mécanisme = point de défaillance unique.
**Décision:** Trois couches indépendantes, dont deux fail-closed.

**(a) Purge S3 au cycle de vie DB (bretelles — primaire).**
- `deleteExpiredStories` (dette corrigée) : **avant** le soft-delete, `findMany` des stories expirées
  avec `media`, puis pour chaque `PostMedia` : `parsePublicKey(mediaUrl)` → `deleteObject(key)`
  (+ thumbnail si présent). Best-effort par objet (un échec ne bloque pas les autres, log warn),
  puis `updateMany(deletedAt)`. Batcher (ex. 200 stories/passe) pour ne pas charger la mémoire.
- `deleteStory` (delete manuel) : idem purge avant soft-delete.
- `removeContent(post)` (takedown modération, ADR-006) : idem purge.

**(b) Lifecycle MinIO (ceinture — backstop, tourne côté MinIO, zéro CPU API).**
Ajouter au `minio-init` (`docker-compose.prod.yml:153`), après les `mc mb` :
```sh
mc ilm rule add local/${S3_BUCKET} --expire-days 2 --prefix "stories/" ;
```
Expire à ~48h : si le cron (a) échoue durablement, MinIO nettoie seul. Filet, pas source de vérité
(24h = TTL métier, 48h = marge cron horaire).

**(c) Garde disque globale fail-closed (disjoncteur).**
Nouveau cron horaire `VideoDiskGuardCron` qui **lit l'usage sans scanner** via l'endpoint Prometheus
intégré de MinIO (`http://minio:9000/minio/v2/metrics/cluster`, métrique `minio_bucket_usage_total_bytes`
par bucket — maintenue par le scanner interne MinIO, **coût CPU nul côté API**). Si
`usage(publicBucket) >= VIDEO_DISK_GUARD_BYTES` (défaut **10 Go**) → `settings.setSetting('video_enabled','false')`
+ `logger.error` alerte (visible logs proprio pour SLA). Ne réactive **jamais** automatiquement
(réarmement manuel proprio via `/admin/settings` après purge). Fallback si metrics injoignable :
log warn + **ne pas** réactiver (on ne relâche jamais la garde sur incertitude).
**Alternatives (c):**
- **`ListObjectsV2` + somme des tailles** — exact / mais O(n) objets à chaque passe = CPU/IO sur hôte partagé → Rejetée.
- **`docker exec minio mc du`** — exige un exec cross-conteneur depuis l'API → couplage + droits → Rejetée au profit du scrape metrics HTTP interne.
**Conséquences:**
- ✅ Trois défenses indépendantes ; aucune seule défaillance ne remplit le disque.
- ✅ Le disjoncteur coupe la **source** (nouveaux uploads) avant saturation, sans supprimer le contenu vivant.
- ⚠️ La garde (c) est globale (bucket entier), pas par-préfixe — volontaire : simple, zéro CPU. Seuil à calibrer (voir Empreinte disque).

---

### ADR-005 — Quotas + rate-limit (Redis + throttler + DB)

**Statut:** Accepted (défauts appliqués)
**Contexte:** Sans quota/user, un compte verified peut à lui seul saturer la garde disque et noyer la modération.
**Décision:** Trois limites, appliquées **au presign ET au create** (le create est l'enforcement dur ;
le presign coupe tôt) :

| Limite | Défaut | Source de vérité | Clé/moyen |
|---|---|---|---|
| Uploads / jour | **5** | Redis compteur journalier | `video:uploads:{userId}:{YYYYMMDD}` INCR, TTL 24h, refus si `> 5` |
| Octets / 24h | **200 Mo** | Redis compteur journalier | `video:bytes:{userId}:{YYYYMMDD}` INCRBY(ContentLength), TTL 24h, refus si dépassement |
| Vidéos actives simultanées | **10** | DB (autoritatif) | `COUNT(post WHERE authorId, isStory, deletedAt null, storyExpiresAt>now, media.mediaType='video')` |
| Rate-limit HTTP | presign **5/min**, create **10/min** par user | throttler existant | `@Throttle({ short:{limit:5,ttl:60000} })` |

Le compteur octets est incrémenté **après** binding réussi (HEAD → ContentLength connu). Interprétation
« 200 Mo/user » = **par fenêtre 24h** (cohérent avec l'éphémère 24h ; pas de colonne `bytes` à ajouter →
zéro migration). Vidéos actives via DB = exact et auto-décrémenté par l'expiration.
**Conséquences:**
- ✅ Empreinte disque/user bornée : ≤ 200 Mo/24h → garde disque globale prévisible.
- ✅ Zéro migration (Redis + COUNT DB).
- ⚠️ Compteurs Redis journaliers (pas glissants) : reset minuit UTC. Acceptable en beta ; documenté.

---

### ADR-006 — Kill-switch fail-closed, gate verified-only, modération→takedown+purge

**Statut:** Accepted
**Contexte:** Risque T&S accepté mais borné. Il faut pouvoir tout couper instantanément et retirer un
contenu en purgeant le disque.
**Décision:**
- **Kill-switch `video_enabled`** (AppSetting) : lu via `settings.getSetting('video_enabled','false') === 'true'`.
  **Fail-closed par construction** : `getSetting` renvoie le **défaut `'false'`** en cas d'échec Redis ET DB
  (cf. `settings.service.ts:50-53`) ⇒ toute panne ⇒ vidéo OFF. Ships **DARK** (défaut off). Nouvelle
  méthode helper `settings.isVideoEnabled()` (miroir de `isProximityEnabled`). Vérifié à presign + create.
  Le create refuse le média `mediaType:'video'` si OFF ; le média `image` reste autorisé (stories image
  non impactées).
- **Gate verified-only** : à presign + create, **lecture DB fraîche** de `identityStatus`
  (modèle `association.service.ts`) ; `!== 'approved'` → 403 `IDENTITY_NOT_APPROVED`. On lit la DB (pas
  le claim JWT) pour ne pas dépendre d'un token périmé (approbation/révocation post-émission).
- **Modération** : `Report` existant, `targetType='post'`, `reason` (dont `inappropriate`, `harassment`,
  `scam`). `resolve` action `content_removed` → `removeContent(post)` **corrigé pour purger S3**
  (parseKey → deleteObject sur chaque PostMedia). Surface admin/modo existante (`GET /reports`,
  `GET /reports/:id/target`, `PATCH /reports/:id/resolve`, rôles admin+moderator). SLA retrait = manuel proprio.
**Conséquences:**
- ✅ Coupure globale instantanée (write-through Redis) et fail-closed sur incident.
- ✅ Un takedown libère réellement le disque (plus de fantôme S3).
- ✅ Réutilise 100% de la stack modération existante (zéro nouveau modèle).
- ⚠️ Le kill-switch coupe les nouveaux uploads/publications ; le contenu déjà publié reste visible jusqu'à
  expiration/takedown (choix : ne pas masquer rétroactivement massivement — évite un incident UX ; le
  takedown ciblé reste dispo).

---

### ADR-007 — Privacy : parité bucket public + UUID (statu quo images)

**Statut:** Accepted (reco appliquée)
**Contexte:** Les stories image actuelles sont `visibility:'friends'` mais stockées en **bucket public**
avec clé **UUID** (`createStory` → `assertOwnedPublicImage` bucket public). Deux options pour la vidéo.
**Décision:** **Parité avec les images** : bucket public + clé UUID imprévisible, story vidéo garde
`visibility:'friends'` (hérité de `createStory:131`). Le feed stories filtre déjà par `authorId ∈ friendIds`
(`posts.service.ts:579`). Aucune régression vs l'existant.
**Alternatives:**
- **Bucket privé + presigned GET** (`createPresignedDownload` existe) — étanchéité forte pour `friends`/`private` / mais coût : un GET signé **par vue** (CPU signature + round-trip API à chaque lecture de tuile story), casse le cache CDN immutable (`Cache-Control max-age=31536000` sur le sous-domaine CDN), complexifie le player mobile. Surcoût réel sur hôte contraint pour un **gain nul par rapport au niveau de protection déjà accepté sur les images** → Rejetée pour la beta.
**Conséquences:**
- ✅ Zéro surcoût CPU/latence ; cache CDN immutable conservé ; player mobile trivial (URL directe).
- ✅ Cohérent avec le modèle de menace déjà accepté (stories image en public bucket + UUID).
- ⚠️ **Résiduel assumé (identique aux images):** quiconque détient l'URL CDN peut lire l'objet sans auth,
  jusqu'à l'expiration 24h. Borné par : UUID non-énumérable + éphémère 24h + purge. **Si** on introduit
  un jour des stories `private` (1-à-1), il faudra rebasculer ces cas en bucket privé + presigned GET →
  **⛔ GO PROPRIO** à ce moment-là. En beta, stories vidéo = `friends` uniquement.

---

## Sous-décisions tranchées

### SD-1 — Limites exactes (défauts APPLIQUÉS, ajustables sans GO)
| Paramètre | Valeur beta | Enforcement | Justif ressource |
|---|---|---|---|
| Durée story | **30 s** | Client (compressor) — **non vérifiable serveur** (pas de ffprobe) | Cap durée ⇒ cap taille indirect |
| Résolution | **720p** | Client | Cible H.265 720p ⇒ ~1–2 Mo/s |
| Taille max | **≤ 25 Mo** | **Serveur (HEAD ContentLength)** — dur | 30 s × 720p H.265 ≈ 15–25 Mo |
| Vidéos actives/user | **10** | Serveur (COUNT DB) | Plafond storage/user |
| Octets/24h/user | **200 Mo** | Serveur (Redis) | ≥ 8 uploads pleins ; borne le disjoncteur |
| Uploads/jour/user | **5** | Serveur (Redis) | Anti-flood modération |
Ces valeurs sont des **AppSetting**/env ajustables. **Augmenter** taille/quota au-delà du budget disque
(ADR-004) = **⛔ GO PROPRIO** (impact disjoncteur).

### SD-2 — Audio : **MUET d'abord** (reco appliquée)
Beta = **vidéo muette**. On **garde `RECORD_AUDIO` bloqué** et `microphonePermission:false`. La
compression on-device (`react-native-compressor`) **strippe la piste audio** avant upload.
- **Impact modération:** l'audio multiplie la surface T&S (propos haineux, musique sous copyright,
  doxxing vocal, voix de tiers non-consentants) — incompatible avec une modération **manuelle SLA** en beta.
- **Impact privacy:** capter l'audio ambiant expose des tiers ; muet = zéro fuite audio.
- **Honnêteté serveur:** sans transcode, le serveur **ne peut pas garantir** l'absence de piste audio dans
  le conteneur uploadé (le cap taille et le HEAD ne l'inspectent pas). « Muet » est donc une **promesse
  client** (strip au compressor + UX sans capture micro), bornée par cohorte verified + report. Résiduel accepté.
- **Réactiver l'audio** (débloquer `RECORD_AUDIO`, UX sonore) = **⛔ GO PROPRIO** — et impose de toute façon
  un **rebuild EAS** (permission native) + réévaluation modération.

### SD-3 — Privacy stockage : **bucket public + UUID** (reco appliquée)
Voir ADR-007. Retenu pour la beta (parité images, zéro surcoût). Bascule privé/presigned = uniquement si
stories `private` introduites plus tard → **⛔ GO PROPRIO**.

---

## Ce qui exige un GO PROPRIO explicite (récapitulatif)
1. **Réactiver l'audio** (SD-2) — sécurité + rebuild natif.
2. **Augmenter taille/quota** au-delà du budget disque (SD-1) — impact disjoncteur.
3. **Stories `private`** → bucket privé + presigned GET (ADR-007/SD-3).
4. **Ouvrir la vidéo au feed permanent** (hors scope beta, décision proprio n°1).
Tout le reste est **appliqué** et n'exige pas de validation supplémentaire pour S-VIDEO-1.

---

## Modèle de données

**Zéro migration média** : `enum MediaType{image video}` et `PostMedia`
(mediaType/thumbnailUrl/width/height/blurhash) existent déjà (`schema.prisma:221,494`). La story vidéo =
un `Post{isStory:true, storyExpiresAt, visibility:'friends'}` + un `PostMedia{mediaType:'video'}`.

**Nouveaux AppSetting (clé/valeur, pas de migration — modèle générique):**
- `video_enabled` : `'true'|'false'` (défaut absent ⇒ `'false'` fail-closed).

**Aucune colonne `bytes`** sur PostMedia (quota octets géré en Redis, ADR-005) → zéro migration.

---

## Flux de données

**Upload + publication story vidéo (happy path):**
```
Mobile: capture/pick → compress H.265 720p ≤25Mo, strip audio (SD-2), génère vignette
  → POST /api/stories/presign {contentType:'video/mp4'}
     [gate: video_enabled ON + verified + throttle + daily-cap]
  ← 201 {uploadUrl, publicUrl, key, expiresIn:900, sseRequired}
  → PUT uploadUrl (binaire, Content-Type video/mp4)            [direct MinIO, l'API ne voit pas l'octet]
  → POST /api/stories {media:{mediaUrl, mediaType:'video', thumbnailUrl, width, height, blurhash}}
     [gate: video_enabled + verified + quota (active<10, bytes<200Mo/24h)]
     server: assertOwnedPublicMedia(url,'video','stories/{userId}/')  ← HEAD, anti-spoof, cap 25Mo
     server: create Post+PostMedia, storyExpiresAt=now+24h; INCR video:uploads / video:bytes
  ← 201 {story}
```
**Cycle de vie disque:**
```
T+24h  StoriesCron → deleteExpiredStories: purge S3 (deleteObject par media) PUIS soft-delete DB
T+48h  MinIO ilm  → expire tout objet résiduel sous stories/ (backstop)
hourly VideoDiskGuardCron → scrape metrics; usage ≥ 10Go ⇒ video_enabled=false + alerte
report content_removed → removeContent(post): purge S3 + soft-delete
```

---

## API Contracts (résumé — détail dans `memory/video-api-contracts.json`)

| Méthode | Route | Auth | Gates | Description |
|---|---|---|---|---|
| POST | /api/stories/presign | Oui | video_enabled, verified, throttle, daily-cap | Presign upload vidéo (mp4/mov) |
| POST | /api/stories | Oui | +quota (si video) | Créer story (image ou vidéo) — anti-spoof binding |
| DELETE | /api/stories/:id | Oui | owner | Supprimer sa story (+ purge S3) |
| POST | /api/reports | Oui | — | Signaler (targetType=post) |
| PATCH | /api/reports/:id/resolve | admin/modo | — | Takedown content_removed (+ purge S3) |
| PATCH | /api/admin/settings | admin | — | Toggle `videoEnabled` (réarmement disjoncteur) |

---

## Security Considerations — STRIDE (feature stories-vidéo)

| Menace | Vecteur | Mitigation figée |
|---|---|---|
| **Spoofing** | Déclarer `mediaType:'video'` sur un objet image (ou l'inverse) | ADR-002 : HEAD réel confronté au mediaType déclaré → rejet |
| **Spoofing identité** | Compte non-verified publie | Gate verified-only lecture DB fraîche (403) au presign+create |
| **Tampering** | Attacher l'objet d'autrui / URL forgée | `parsePublicKey` (host-binding) + `requiredPrefix=stories/{ownerId}/` |
| **Repudiation** | Nier un upload | Report auditable (reviewedById), logs Pino, cron logs |
| **Info disclosure** | Fuite d'une story `friends` | Feed filtré par friendIds (`:579`) ; UUID non-énumérable ; éphémère 24h (résiduel ADR-007 assumé) |
| **DoS disque** | Un user sature le disque | Quota 200Mo/24h + 5 uploads/j + 10 actives + disjoncteur 10Go fail-closed + TTL/lifecycle |
| **DoS upload** | Flood presign/create | `@Throttle` 5/10 par min ; presign gaté (pas d'objet sans droit) |
| **EoP** | Publier vidéo hors cohorte / quand OFF | Kill-switch fail-closed + verified gate aux deux points |
| **Contenu illicite** | Upload T&S | Cohorte verified + Report → takedown+purge + SLA manuel proprio |
| **Audio non-consenti** | Voix de tiers | SD-2 muet (strip client) ; réactivation = GO proprio |

**Conformité CLAUDE.md projet:** Zod sur `presignVideoSchema` + `createStorySchema` (inchangé) ;
AuthZ/ownership `stories/{ownerId}/` anti-IDOR ; privacy `friends` non fuitée ; média bindé via garde
S3 (`assertOwnedPublicMedia`) ; shared-types : aucun nouveau type partagé requis (mediaType existe) —
si un DTO presign vidéo est exposé au mobile, rebuild `@nigerconnect/shared-types`.

---

## Observabilité
- `StoriesCron` : log `purged N objects, soft-deleted M stories` (dont échecs purge en warn).
- `VideoDiskGuardCron` : log info usage horaire ; **error** + alerte au trip du disjoncteur.
- Takedown : log `content_removed post=<id> purged=<n>`.
- Kill-switch : le write-through Redis rend l'état lisible dans `/admin/settings`.

---

## Estimated Monthly Cost (cible = VPS UNIQUE PARTAGÉ 46.224.193.109)

| Composant | Empreinte ajoutée | Coût |
|---|---|---|
| MinIO (déjà déployé, limite 512 Mo RAM) | 0 nouveau conteneur ; +lifecycle (scanner interne, négligeable) | **0 €** |
| API Nest (déjà déployé) | +2 crons légers (scrape metrics + purge batch) ; pas de ffmpeg | **0 €** |
| Redis (déjà déployé) | +2 clés/user/jour (compteurs) | **0 €** |
| Disque MinIO (volume existant) | borné ≤ **10 Go** par le disjoncteur | inclus VPS |
| Transcode / SaaS vidéo | **AUCUN** (approche A, zéro payant) | **0 €** |
| **TOTAL marginal** | | **0 € / mois** |

**Empreinte disque chiffrée (worst-case borné):**
- Par user/24h : ≤ 200 Mo (quota octets) ⇒ storage/user plafonné.
- Steady-state ≈ (uploaders verified actifs/24h) × (octets/24h). Ex. 40 uploaders × ~125 Mo ≈ **~5 Go**.
- Plafond dur global : disjoncteur à **10 Go** (fail-closed) + lifecycle 48h ⇒ le disque **ne peut pas**
  déraper au-delà de l'ordre de grandeur du seuil, quel que soit le trafic. RAM/CPU API : négligeable
  (purge = deleteObject best-effort batché ; garde = 1 GET HTTP/heure).

---

## Plan de scalabilité
- **Beta (cohorte verified réduite):** architecture ci-dessus, single VPS, disjoncteur 10 Go.
- **Croissance:** relever `VIDEO_DISK_GUARD_BYTES` **après** avoir dimensionné le volume MinIO (GO proprio) ;
  passer les compteurs Redis en fenêtre glissante ; envisager un bucket stories dédié si le volume le justifie.
- **Feed permanent vidéo:** décision proprio ultérieure — nécessitera un stockage `users/` (permanent, hors
  lifecycle) + une stratégie disque distincte (pas d'expiration) → nouvel ADR.

---

## Hypothèses techniques (à valider en implémentation)
1. MinIO expose `minio_bucket_usage_total_bytes` sur `/minio/v2/metrics/cluster` (version image `minio:latest` du compose) — sinon fallback `mc admin info` via un conteneur sidecar mc éphémère, ou seuil sur `df` du volume.
2. `mc ilm rule add ... --expire-days 2 --prefix "stories/"` supporté par l'image `minio/mc:latest` du `minio-init` (syntaxe à confirmer ; variante `mc ilm add --expiry-days`).
3. Le compressor mobile (`react-native-compressor`) produit un `video/mp4` H.265 dont le Content-Type est correctement posé sur le PUT presigné (sinon fixer `Content-Type` explicitement côté client).
4. La cohorte verified reste réduite en beta ⇒ ~5 Go steady-state réaliste sous le seuil 10 Go.

---

## Tâches backend ordonnées pour S-VIDEO-1 (deployable INERTE, flag off)

1. **AppSetting kill-switch** — `settings.service.ts` : `isVideoEnabled()` (`getSetting('video_enabled','false')==='true'`). Défaut absent ⇒ OFF (fail-closed). *(bloquant pour 2/4)*
2. **Garde média** — `s3.service.ts` : `MAX_PUBLIC_VIDEO_BYTES=25Mo`, `ALLOWED_VIDEO_TYPES`, `assertOwnedPublicMedia(url, expectedMediaType, requiredPrefix)` avec confrontation Content-Type réel ↔ mediaType déclaré. Tests unit spoofing (image déclarée vidéo et inverse). *(bloquant pour 5)*
3. **Presign vidéo** — DTO Zod `presignVideoSchema` (contentType ∈ {mp4,mov}) ; `POST /stories/presign` (feed.controller) : gates video_enabled + verified(DB) + `@Throttle` + daily-cap Redis ; `createPresignedUpload({folder:'stories/{userId}', contentType, expiresIn:900})`.
4. **Create story vidéo** — `createStory` : si `mediaType==='video'` ⇒ gates video_enabled + verified + quota (active<10 via COUNT, bytes<200Mo/24h via Redis) ; binder via `assertOwnedPublicMedia(url,'video','stories/{authorId}/')` ; INCR `video:uploads` / `video:bytes`. Chemin image inchangé (mais migrer aussi son binding vers `assertOwnedPublicMedia(...,'image', 'stories/{id}/')` pour fermer le spoof côté image-story). *(dépend 1,2)*
5. **Purge S3 — dette (a)** — `deleteExpiredStories` : findMany media → deleteObject batché best-effort → puis soft-delete. Idem `deleteStory`. *(indépendant)*
6. **Purge S3 — takedown** — `moderation.service.removeContent(post)` : deleteObject des PostMedia avant soft-delete. *(indépendant)*
7. **Lifecycle MinIO (b)** — `docker-compose.prod.yml` minio-init : ajouter `mc ilm rule add local/${S3_BUCKET} --expire-days 2 --prefix "stories/"`. *(ops, indépendant)*
8. **Garde disque (c)** — `VideoDiskGuardCron` horaire : scrape metrics MinIO ; usage ≥ `VIDEO_DISK_GUARD_BYTES` (env, défaut 10Go) ⇒ `setSetting('video_enabled','false')` + log error. Jamais de réarmement auto. *(dépend 1)*
9. **Admin toggle** — `admin.service` getSettings/patchSettings + DTO : exposer `videoEnabled` (lecture/écriture `video_enabled`) pour réarmer le disjoncteur. *(dépend 1)*
10. **Env** — `env.validation.ts` : `VIDEO_DISK_GUARD_BYTES` (default 10*1024^3), optionnel `VIDEO_MAX_BYTES`/quotas si externalisés.
11. **Tests** — unit : anti-spoof garde, quota Redis, verified gate, kill-switch fail-closed, purge appelée. e2e : presign→PUT→create→GET friend visible / non-friend 404 / non-verified 403 / video OFF 403.

Ordre d'attaque conseillé : **1 → 2 → (3,4) ‖ (5,6,7) → 8,9 → 11**. Livraison **INERTE** : `video_enabled`
absent/`false` ⇒ aucun upload vidéo possible en prod tant que le proprio ne l'arme pas.

---

## AGENT COMPLETE
Livrables écrits : `docs/adr/ADR-video-stories.md` + `memory/video-api-contracts.json`.
Next agents : `gwani-backend` (S-VIDEO-1, deployable inerte flag off) puis `gwani-frontend` (S-VIDEO-2, rebuild EAS 1.10.0) puis `gwani-qa-tester → gwani-pentest` (S-VIDEO-3). STOP au gate `READY_FOR_DEPLOY`.
