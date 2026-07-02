# ADR-LIVES — Streaming direct (LIVES) — **RÉVISION 2 (self-host gratuit, audio-first)**

> # ❌ STATUT FINAL : FEATURE ÉCARTÉE (abandonnée le 2026-07-02, décision proprio)
> Le proprio a **abandonné la feature LIVES** : le coût ressource sur le VPS unique partagé est refusé, la vidéo
> impose une brique de fait payante/dédiée (interdite par la règle zéro-payant) sans alternative tenable, et même
> l'option **audio self-hostée** (LiveKit OSS + coturn, ~6,4 Mbps/100 viewers) a été refusée pour son empreinte
> RAM/CPU/bande passante sur l'hôte partagé. **Ce document est conservé UNIQUEMENT comme trace de décision
> (rejected).** Ne pas implémenter. Ne pas re-proposer sans demande explicite. Le chiffrage ci-dessous justifie
> l'abandon (vidéo ~150-250 Mbps/100 viewers intenable ; audio moins cher mais coût encore refusé).

**Statut :** `REJECTED` (feature écartée 2026-07-02). *(Analyse d'origine ci-dessous conservée en archive.)* **Aucun code de prod, aucune install.**
**Date :** 2026-07-02 (rév. 2)
**Auteur :** gwani-architect
**Périmètre :** `apps/api` (nouveau module `live` + enrichissement `geo`), `apps/mobile` (module natif WebRTC → **rebuild + bump**), `packages/shared-types`. **Web hors V1.**

> ### ⚠️ CE QUI CHANGE vs rév. 1 (deux contraintes DURES du proprio, qui priment)
> 1. **ZÉRO solution payante — règle absolue.** L'ancienne reco **LiveKit Cloud est INTERDITE**. Toute brique
>    normalement payante → alternative **gratuite, open-source, sécurisée, auto-hébergeable en conteneur** ; sinon la
>    brique/feature est **écartée**, jamais dégradée en sécurité, **jamais remplacée par un SaaS payant même en repli**.
> 2. **Infra imposée = le VPS existant** `46.224.193.109` (Docker Compose derrière Traefik), **hôte PARTAGÉ**
>    (sahabi-*, cs-*, miss-sahel…), budget RAM/CPU serré (l'API est déjà plafonnée à 1 Go).
>
> **Conséquences directes de la rév. 2 :**
> - **Moteur = LiveKit OSS auto-hébergé (Apache-2.0)** en conteneur sur le VPS. TURN = **coturn OSS**. Zéro SaaS.
> - **V1 = AUDIO-ONLY** (« live audio / room vocale géolocalisée »). Le chiffrage §5 démontre que **l'audio tient**
>   sur l'hôte partagé et que **la vidéo NE tient PAS** → **la vidéo est écartée sur l'infra actuelle** (§6).
> - Aucun `eas build`, aucun bump `app.json`, aucun provisioning n'est déclenché par cet ADR.

---

## 1. Contexte — état réel du code (inchangé, toujours valide)

### 1.1 Un gateway WebSocket temps réel existe déjà et est mûr
`apps/api/src/chat/chat.gateway.ts` (socket.io, namespace `/chat`) fournit **exactement** les briques dont le
temps réel du LIVE a besoin :

- **Auth handshake JWT RS256** : `verifyToken()` l.354-369 (iss/aud + rotation clé), **révocation par `jti`** via Redis
  `isJwtBlacklisted` l.95-97.
- **Rooms socket.io** : `user:{id}`, `conv:{id}` — directement transposable en `live:{sessionId}`.
- **Rate-limit par utilisateur en Redis, robuste au reconnect** : `incrementCounter` l.176-183.
- **Validation Zod côté socket rejouant le REST** : `socketSendMessageSchema.parse()` l.188-194.
- **Présence Redis** (`PresenceService`) — réutilisable pour le compteur de viewers.
- **Émission scopée** : `client.to(rooms).emit()` n'échoit jamais aux non-membres (l.142-153).

**Conséquence :** réactions, chat live, compteur de viewers, badge map et invitations co-host **réutilisent ce gateway**.
**Le SFU ne transporte QUE l'audio A/V.** (voir §4)

### 1.2 La carte applique déjà un gating privacy strict côté serveur
`apps/api/src/geo/geo.service.ts` : `getMarkers()` l.183-231 → `individuals()` l.1052-1111 ne renvoie **jamais** un
compte `private` ni `showOnMap=false` (filtre l.1066). Enrichissements « friends-only » (`hasActiveStory`,
`activeRecently`) calculés **uniquement pour les amis acceptés**, fail-open à `false` l.1092-1097. **Le badge
`isLiveNow` sera un enrichissement calqué sur `hasActiveStory`** → un compte `private` ne peut structurellement pas
fuiter (§7).

### 1.3 Kill-switch & modération : pattern déjà en place
`AppSetting` + `SettingsService` (ex. `proximity_enabled`) → flag global `lives_enabled` (défaut `false` = DARK).

### 1.4 Stack mobile & build
- **Expo SDK 54**, New Architecture, `app.json` **`version 1.8.0`**. Natif présent : `react-native-webview`,
  `react-native-reanimated`, `expo-location`, `react-native-maps`. **ABSENT : tout SDK WebRTC.**
- **Quota EAS cloud épuisé** ⇒ builds via CI (`.github/workflows/ios-build.yml`, `android-build.yml`, `eas build --local`).
  Déclenchement = **action sortante proprio**.

### 1.5 Contraintes d'infra vérifiées (`docker-compose.prod.yml`)
- Le nigerconnect commit déjà **~3,5 Go** de limites RAM : postgres 1G, redis 512M, minio 512M, **api 1G**, web 512M —
  **sur un hôte partagé avec d'autres stacks**.
- Le compose **ne mappe AUCUN port hôte** (« NO host port mappings — zero conflict with neighbors ») : tout passe par
  Traefik (L7 HTTP/WS). **Or WebRTC a besoin d'UDP**, que Traefik ne proxifie pas → point d'exploitation clé (§3.4).

---

## 2. Exigences (rappel) et ce qui reste faisable gratuitement

| # | Exigence | Statut rév. 2 | Transport |
|---|----------|---------------|-----------|
| E1 | Lancer un live depuis l'app | ✅ **audio** | REST (session) + SFU (publish **audio**) |
| E2 | Réactions/émojis temps réel | ✅ | **WS existant** |
| E3 | Compteur de viewers | ✅ | **WS + Redis** |
| E4 | Chat live | ✅ | **WS existant** |
| E5 | Inviter ≤2 co-diffuseurs (3 flux) | ✅ **audio** | REST + SFU (publish audio autorisé par token) |
| E6 | Badge « LIVE » sur la carte | ✅ | **`geo` enrichi**, gating §7 |
| — | **Vidéo (image)** | ❌ **ÉCARTÉE sur l'infra actuelle** (§5-§6) | — |

**Contrainte transverse (CLAUDE.md) :** un compte `private` ne fuit jamais sur `/geo/*`, feed, recherche, proximité.
**Le badge LIVE ne fait pas exception.**

---

## 3. Décision — moteur de streaming **100 % self-hosted, gratuit**

### 3.1 Rappel du nœud du problème : l'egress d'un SFU
Un SFU relaie le flux de **chaque publisher vers chaque subscriber** : `egress ≈ N_viewers × bitrate_publisher`.
C'est **linéaire en nombre de viewers** — c'est là que l'audio et la vidéo divergent d'un facteur ~30-50 (§5).

### 3.2 Comparatif des trois moteurs **gratuits** envisageables sur le VPS

Notation 1 (mauvais) → 5 (excellent). Tous Apache-2.0 / OSS, **aucun coût de licence**.

| Critère (poids) | **LiveKit OSS** (self-host) | **mediasoup** | **Jitsi / JVB** |
|---|---|---|---|
| **Empreinte RAM en conteneur** (×3) | 4 — binaire Go unique, idle ~80-150 Mo ; **audio-only** cappable à **256-384 Mo** | 4 — workers C++ efficaces, mais process/glue à dimensionner | **1** — pile JVM (Jicofo+**JVB**+Prosody+web), heap JVB **~0,5-1 Go** à lui seul → **incompatible budget hôte partagé** |
| **CPU / live** (×3) | 4 — SFU = **forwarding** (pas de transcodage), audio = paquets minuscules | 4 — idem, très efficace | 2 — JVM + conçu pour la visio, lourd pour de l'audio |
| **Faisabilité hôte partagé déjà chargé** (×3) | 4 — 1 conteneur + coturn ; tient en audio (§5) | 3 — faisable mais **tout à construire** | **1** — multi-conteneurs + RAM → **non** |
| **Effort d'exploitation** (×3) | **4** — turnkey (token API, webhooks, single-port UDP mux, mode TURN/443) | **1** — signaling + SFU + ICE + composition **à coder soi-même** | 2 — pile lourde, opinionated |
| **Compat Expo/EAS (SDK RN)** (×2) | **5** — `@livekit/react-native` + config plugin Expo (meilleur SDK RN du marché) | 2 — `react-native-webrtc` brut, intégration RN pénible | 3 — SDK RN Jitsi existe mais **impose son UI/flow** (peu compatible notre écran custom) |
| **NAT traversal** (×2) | 5 — ICE natif + **coturn** intégré, fallback TCP/443 | 4 — à câbler avec coturn | 4 — coturn |
| **Sécurité / contrôle** (×2) | 5 — tokens à permissions (`canPublish`/`canSubscribe`), webhooks, mute/kick serveur, Apache-2.0 | 5 — contrôle total (mais à écrire) | 4 — mûr mais surface plus large |
| **Score pondéré / 90** | **~76** | ~54 | ~41 |

### 3.3 Décision

> **Moteur = LiveKit OSS auto-hébergé** (Apache-2.0), **conteneur unique** sur le VPS, **en mode AUDIO-ONLY pour la V1**.
> **TURN/STUN = coturn OSS** (conteneur, §8). **Aucun SaaS, aucune clé payante.** Le client mobile utilise
> `@livekit/react-native` (config plugin Expo). L'API émet les tokens via un `LiveTokenService` (identique en forme à
> la rév. 1 : `room` + `identity` + permissions), de sorte que **basculer plus tard vers un nœud LiveKit dédié
> auto-hébergé ne touche que la config serveur** (URL SFU + clés).

**Pourquoi pas les autres :**
- **Jitsi/JVB** → **RAM JVM rédhibitoire** sur un hôte déjà à ~3,5 Go pour la seule stack NigerConnect + voisins ; et
  SDK RN qui impose son UI. **Écarté par la contrainte n°2.**
- **mediasoup** → gratuit et efficace, mais **coût d'ingénierie prohibitif** (tout le signaling/ICE/glue à écrire) pour
  une petite équipe ; on gagnerait un peu de RAM au prix de semaines de dev et d'une surface de bugs/sécu maison.
  Gardé comme **note de repli extrême** si LiveKit posait un problème de licence/maintenance (il n'y en a pas).

### 3.4 Point d'exploitation clé : WebRTC a besoin d'UDP, Traefik non
Traefik (L7 HTTP/WS) proxifie **la signalisation** LiveKit (WSS, sous-domaine ex. `rtc.nigerconnect.app`) sans souci.
**Le média (RTP) est en UDP** et ne passe pas par Traefik. Options, par ordre de préférence :
1. **UDP mux single-port** LiveKit (ex. `7881/udp`) publié sur l'hôte **+ coturn** pour le fallback → 1 seul port UDP,
   pas de plage large. C'est **un mapping de port par conteneur**, pas une action système globale.
2. **Mode TURN/TCP-443 forcé** via coturn si le proprio refuse tout port UDP hôte (latence un peu supérieure, **gratuit**).

> ⚠️ **Déviation assumée du pattern « no host port mappings »** : le SFU/coturn imposent d'exposer **1-2 ports** (UDP mux
> + TURN 3478/5349). C'est la seule entorse, **bornée et par conteneur**. → **Question ouverte Q1 (§12).**

### 3.5 Plan de repli — **toujours gratuit, jamais payant**
1. **UDP hôte refusé / réseaux restrictifs** → **coturn en TURN/TCP-443 only** (déjà OSS, déjà prévu). Latence ↑, coût 0.
2. **Contention audio réelle sur l'hôte partagé** (au-delà des caps §9) → **abaisser les caps** (viewers/lives) puis, si
   insuffisant, **déporter LiveKit sur un nœud auto-hébergé dédié** que **le proprio provisionne** (décision infra §12
   Q2) — **OSS self-host, jamais un SaaS**.
3. **Si aucune option gratuite+sécurisée ne tient** (ex. proprio refuse tout port + tout nœud dédié) → **écarter la
   feature LIVE** (la noter « écartée — dépendance infra sans alternative gratuite »). **On n'implémente pas dégradé.**

---

## 4. Découpage temps réel — SFU (audio) vs gateway WS existant

| Donnée | Transport | Détail |
|---|---|---|
| **Audio** (1 host + ≤2 co-hosts) | **SFU LiveKit** | `canPublish` réservé host + co-host `joined` ; viewers = `canSubscribe` seul. **Opus mono voix.** |
| Réactions/émojis (E2) | **WS `/live`** | throttlé + agrégé Redis, **jamais** via data-channel SFU |
| Chat live (E4) | **WS `/live`** | **rejoue Zod + rate-limit Redis** du chat existant |
| Compteur viewers (E3) | **WS + Redis** | `SADD live:viewers:{id}` au join, `SCARD` throttlé émis en `live:viewers` |
| Badge LIVE map (E6) | **REST `geo` enrichi** | bit `isLiveNow`, poll carte (pas de push temps réel V1) |
| Invitations co-host (E5) | **REST + WS** | REST (persisté) + push `live:cohost:invite` sur `user:{id}` |

**Pourquoi PAS le data-channel du SFU pour chat/réactions :** on perdrait révocation `jti`, rate-limit Redis, Zod,
modération et historique déjà éprouvés. **Média audio sur SFU, tout le reste sur socket.io.**

---

## 5. CHIFFRAGE de l'empreinte sur CE VPS (le cœur de la décision)

Rappel infra : **1 NIC partagée**, RAM déjà à ~3,5 Go pour NigerConnect + voisins, API cappée 1 Go.

### 5.1 Egress SFU = f(viewers, bitrate) — audio vs vidéo

| Scénario | Bitrate/flux | 1 host, 50 v. | 1 host, 100 v. | 1 host, 200 v. | 3 flux (host+2 co), 100 v. |
|---|---|---|---|---|---|
| **AUDIO Opus voix** | **~48-64 kbps** | ~3,2 Mbps | **~6,4 Mbps** | ~12,8 Mbps | ~19,2 Mbps |
| **VIDÉO 720p** | **~1,5-2,5 Mbps** | ~75-125 Mbps | **~150-250 Mbps** | ~300-500 Mbps | ~450-750 Mbps |

**Facteur ~30-40× entre audio et vidéo à audience égale.**

### 5.2 Pourquoi **l'AUDIO tient**
- **Egress** : même **3 lives audio concurrents × 100 viewers** ≈ **~19 Mbps** (1 host) à **~58 Mbps** (worst 3 co-hosts)
  agrégés → **absorbable** par la NIC partagée sans étouffer API/CDN/voisins (à condition des **caps §9**).
- **RAM** : LiveKit audio-only cappé **256-384 Mo** ; coturn **~64-128 Mo** → **~+0,4 Go** sur l'hôte. Tendu mais **tenable**.
- **CPU** : le SFU **ne transcode pas**, il **route des paquets Opus minuscules** ; une fraction de cœur suffit pour
  des centaines de flux audio.
- **Egress mensuel** : 1 live audio 1 h à 100 viewers ≈ 64 kbps × 100 × 3600 ≈ **~2,9 Go**. Modéré.

### 5.3 Pourquoi **la VIDÉO NE tient PAS** sur l'hôte partagé unique
- **Egress** : **1 seul live 720p à 100 viewers = ~150-250 Mbps SOUTENUS**. Cela **sature la NIC partagée** et
  **dégrade API + CDN MinIO + les autres apps** de l'hôte → viole « aucune action qui dégrade les voisins » et
  « budget serré ». **3 co-hosts × 100 viewers = jusqu'à ~750 Mbps** : hors de question.
- **Egress mensuel** : 1 live vidéo 1 h à 100 viewers ≈ **~68 Go** ; quelques lives/jour = **plusieurs To/mois** →
  risque de dépassement de quota de trafic de l'hôte (impacte **tous** les voisins).
- **CPU/RAM** : la vidéo (simulcast, PLI/NACK, gros paquets, jitter buffers) **multiplie** la charge SFU et la RAM.
- **Conclusion** : la vidéo **exige un nœud dédié** (NIC + CPU dédiés). Sur le VPS prod partagé, **impossible sans
  dégrader la sécurité de service des autres apps**. → **§6.**

---

## 6. VERDICT sur la VIDÉO (arbre de décision appliqué)

> **La VIDÉO est ÉCARTÉE de la V1 sur l'infra actuelle.** Motif (arbre de décision, branche b) : la seule façon de la
> servir sans dégrader les autres apps serait un **nœud auto-hébergé dédié** (NIC/CPU séparés) — **décision d'infra du
> proprio (§12 Q2)**, **jamais un SaaS payant**. Tant que ce nœud n'existe pas, la vidéo **n'est pas implémentée** et
> reste notée « **différée — dépendance infra (nœud dédié) non tranchée** ».
>
> **V1 buildable maintenant = AUDIO-FIRST**, 100 % self-host gratuit, qui tient sur le VPS sous les caps §9.
> **Aucune option payante n'est proposée, même en repli.**

Le design est **prêt pour la vidéo sans refonte** : passer `canPublish` en audio+vidéo et lever le flag `audioOnly`
côté token le jour où un nœud dédié existe. Le schéma, l'API et le WS restent identiques.

---

## 7. Confidentialité du badge LIVE sur la carte (inchangé, critique)

**Principe : le badge est un enrichissement de marqueurs DÉJÀ autorisés, jamais une nouvelle source de marqueurs.**
Helper `liveHostsAmong(userIds, viewer)` calqué sur `activeStoryAuthors()` (geo.service.ts l.1128-1146) :

1. `individuals()` a **déjà** exclu `private` et `showOnMap=false` (l.1066) → **un `private` n'est jamais un marqueur →
   son live ne peut pas afficher de badge. Fuite structurellement impossible.**
2. Le badge respecte **l'audience du live** (`LiveSession.visibility`) via `friendIds()` : `friends` → badge **amis
   seulement** (comme `hasActiveStory`) ; `public` → badge sur marqueurs déjà visibles ; `private` → **aucun badge**.
3. **Fail-open à `false`** : une panne SFU/DB **masque** le badge, ne l'ouvre jamais.
4. Position badge = **snapshot `LiveSession.lat/lng`** au démarrage (pas la position temps réel).
5. **Aucun nouvel endpoint géo** : `isLiveNow?: boolean` s'ajoute à `IndividualMarker`, servi par `getMarkers()`.

**STRIDE (feature LIVE audio) :**
| Menace | Risque | Mitigation |
|---|---|---|
| Spoofing | Se faire passer pour host/co-host | Token LiveKit émis par l'API, `canPublish` réservé host + co-host `joined` |
| Tampering | Forger/rejouer un token SFU | Tokens signés serveur, TTL court, room scoping |
| Repudiation | Nier un abus en live | Logs Pino + `AuditService`, webhooks LiveKit, chat persistable (Q4) |
| Info disclosure | Fuite `private` sur la map / accès audio friends par non-ami | §7.1-7.2 ; **token subscribe refusé** aux non-autorisés au `join` |
| DoS | Flood réactions/chat, spam de lives, **saturation NIC** | Rate-limit Redis + **caps §9** + kill-switch `lives_enabled` |
| EoP | Viewer qui publie, co-host qui kicke le host | Permissions par token ; actions host (`invite`/`kick`/`end`) gardées `hostId === userId` |

**Anti-IDOR (CLAUDE.md) :** toute action sur `LiveSession`/`LiveCohost` filtre par `hostId` ; le **token de join** est
refusé (403) si le viewer n'a pas le droit de voir le live.

---

## 8. coturn (TURN/STUN **gratuit**) — nécessité, empreinte, cap

**Pourquoi c'est nécessaire :** derrière un **NAT symétrique** (data mobiles carrier-grade NAT, Wi-Fi d'entreprise), les
pairs ne peuvent pas atteindre le SFU en connexion directe. Un relais **TURN** est alors **obligatoire** pour que le
média passe ; sans lui, une partie des utilisateurs **ne verrait/n'entendrait rien**. STUN seul ne suffit pas au NAT
symétrique. coturn est **OSS (BSD), gratuit, auto-hébergeable** → conforme à la règle « jamais un TURN payant ».

**Empreinte :** coturn en **relais** fait transiter le média **deux fois** (client→TURN→SFU et SFU→TURN→client), donc il
**double la bande passante** des seules connexions relayées. En pratique **~10-20 %** des connexions basculent en TURN
(le reste passe en direct/STUN). Pour l'audio, l'impact reste petit : 100 viewers dont 20 % relayés ≈ 20 × 64 kbps × 2
≈ **~2,6 Mbps** supplémentaires. RAM conteneur **~64-128 Mo**.

**Cap coturn :** `total-quota`, `bps-capacity` et `max-bps` par session dans `turnserver.conf` pour **borner** la bande
passante relayée et éviter qu'un pic TURN n'étouffe l'hôte. Ports : `3478/udp+tcp`, `5349/tcp` (TLS), plus une plage de
relais bornée (ex. `49160-49200/udp`) — **à cadrer avec Q1 (déviation « no host ports »)**.

---

## 9. LIMITES DURES (cadrage obligatoire — configurables via `AppSetting`)

| Limite | Valeur V1 proposée | Raison |
|---|---|---|
| **Modalité** | **AUDIO-ONLY** (`live.audioOnly = true`) | §5-§6, la vidéo ne tient pas |
| **Lives concurrents (global)** | **≤ 3** (`lives_max_concurrent`) | plafonne l'egress agrégé (~19-58 Mbps worst) sur NIC partagée — **Q3** |
| **Viewers / live** | **≤ 200** (`live_max_viewers`) | borne l'egress par live ; au-delà → file d'attente/refus 429 |
| **Co-diffuseurs** | **≤ 2** (3 flux audio) | E5 ; contrôle applicatif au `accept` |
| **Durée max / live** | **≤ 120 min** (`live_max_duration_min`) | coupe les sessions oubliées, borne l'egress cumulé |
| **Quota lives / user / jour** | **≤ 5** | anti-spam (Redis) |
| **Kill-switch global** | `lives_enabled` (défaut **false = DARK**) | rollout progressif, coupe-circuit instantané |
| **Feature flag** | **DARK** jusqu'au GO proprio | backend livrable sans exposer la feature |

**Kill-switch = coupe-circuit dur :** `lives_enabled=false` → REST `/live/*` renvoie `503 feature_disabled` **et** le
namespace WS `/live` refuse les nouveaux `live:join`. Permet d'éteindre instantanément si l'hôte souffre.

---

## 10. Modèle de données (esquisse Prisma — à affiner par backend)

```prisma
enum LiveStatus { live ended }
// visibility réutilise l'enum PrivacyLevel existant (public/friends/private)

model LiveSession {
  id          String       @id @default(uuid()) @db.Uuid
  hostId      String       @map("host_id") @db.Uuid
  host        User         @relation("LiveHost", fields: [hostId], references: [id], onDelete: Cascade)
  status      LiveStatus   @default(live)
  visibility  PrivacyLevel @default(friends)           // audience du live (≤ privacy du compte)
  audioOnly   Boolean      @default(true) @map("audio_only")   // V1 = toujours true (vidéo écartée §6)
  title       String?      @db.VarChar(120)
  roomName    String       @unique @map("room_name")   // room LiveKit (abstraction SFU)
  // Snapshot géo au démarrage → badge map SANS relire la position live du user.
  latitude    Float?
  longitude   Float?
  city        String?      @db.VarChar(100)
  countryCode String?      @map("country_code") @db.VarChar(2)
  peakViewers Int          @default(0) @map("peak_viewers")
  startedAt   DateTime     @default(now()) @map("started_at")
  endedAt     DateTime?    @map("ended_at")
  cohosts     LiveCohost[]

  @@index([status, visibility])   // requête badge map: lives actifs par audience
  @@index([hostId, status])
}

model LiveCohost {
  id        String      @id @default(uuid()) @db.Uuid
  sessionId String      @map("session_id") @db.Uuid
  session   LiveSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId    String      @map("user_id") @db.Uuid
  status    String      @default("invited")  // invited | joined | left | removed
  invitedAt DateTime    @default(now()) @map("invited_at")
  joinedAt  DateTime?   @map("joined_at")

  @@unique([sessionId, userId])   // pas de double invitation
  @@index([userId, status])
}
```

**Règles d'intégrité :**
- **Max 2 co-hosts `joined`** → contrôle applicatif au `accept` (compte les `joined`, sinon 409).
- `visibility` **ne peut jamais dépasser** la privacy du compte ; compte `private` → cf. Q7.
- Suppression user → cascade sessions + cohosts.
- **Chat/réactions = éphémères Redis en V1** (pas de table `LiveMessage`) sauf Q4.
- `LiveSession.status=live` orphelin (host crashé) → fermé par **webhook LiveKit `room_finished`** ou balayage TTL (≤ durée max §9).

---

## 11. Surface API / WS + découpage en incréments (détail : `memory/lives-api-contracts.json`)

**REST** (`/api/v1/live`, `EmailVerifiedGuard` + kill-switch `lives_enabled`) :
`POST /live` · `POST /live/:id/end` · `GET /live/:id` · `GET /live` · `POST /live/:id/join` (→ token **subscribe audio**,
gated visibility) · `POST /live/:id/cohosts` · `POST /live/:id/cohosts/accept` (→ token **publish audio**) ·
`POST /live/:id/cohosts/:userId/kick` · `POST /live/:id/report`.

**WS** (namespace `/live`, mêmes auth/jti/Zod/rate-limit que `/chat`) :
`live:join`/`live:leave` (E3) · `live:chat:send`→`live:chat:new` (E4) · `live:react`→`live:reaction` (E2) ·
`live:viewers` · `live:cohost:invite`/`live:ended` (push `user:{id}`).

### Incréments livrables

| ID | Incrément | Surface | Livraison |
|---|---|---|---|
| **LIVE-0** | Kill-switch `lives_enabled` + **conteneurs LiveKit OSS + coturn** (compose, RAM cappée) + `LiveTokenService` + config env | infra, api/live, AppSetting | **DARK**, deploy commit |
| **LIVE-1** | Modèles Prisma + `POST /live` / `end` + room LiveKit + token host (**publish audio**) + caps §9 | prisma, api/live, shared-types | migration |
| **LIVE-2** | `join`/`leave` + compteur viewers (Redis) + WS `/live` + token **subscribe** gated visibility | api/live | deploy commit |
| **LIVE-3** | Chat live + réactions WS (Zod + rate-limit réutilisés) | api/live | deploy commit |
| **LIVE-4** | Co-hosts invite/accept/kick (max 2) + upgrade token publish | api/live, api/social | deploy commit |
| **LIVE-5** | Badge `isLiveNow` sur la map (enrichissement gated §7) | api/geo, shared-types | deploy commit |
| **LIVE-6** | **Mobile** : `@livekit/react-native` (audio), écran diffuseur/viewer, chat/réactions UI, badge map | mobile | **rebuild + bump 1.9.0** |
| **LIVE-7** | e2e privacy (private ne fuit jamais ; live friends refusé aux non-amis) + **gwani-pentest** | e2e, api specs | gate BLOCK/OK |

**Backend-first :** LIVE-0→5 démontrables **sans build mobile** ; **LIVE-6 = seul incrément nécessitant le GO build**.

---

## 12. Impact EAS (NON négociable)

`@livekit/react-native` + `@livekit/react-native-webrtc` = **modules natifs avec config plugin**. Conséquences :
- **`prebuild` + rebuild EAS OBLIGATOIRE** — un OTA **crasherait** l'app (règle CLAUDE.md / MEMORY).
- **Bump `app.json` `1.8.0 → 1.9.0`** (runtimeVersion = appVersion).
- **iOS** : `NSMicrophoneUsageDescription`, background audio mode (le son continue écran verrouillé). **Pas de caméra en V1.**
- **Android** : `RECORD_AUDIO`, `FOREGROUND_SERVICE` (audio). **Pas de `CAMERA` en V1.**
- Build via **CI `ios-build.yml` / `android-build.yml`** (quota EAS épuisé) = **action sortante → GO proprio**.
- Le backend (LIVE-0→5) se livre **DARK sans toucher au mobile** ; le mobile (LIVE-6) attend le GO build.

---

## 13. Risques
- **R1 — Contention NIC/RAM sur hôte partagé** : mitigé par **caps §9** + kill-switch ; surveiller egress agrégé. Si insuffisant → nœud dédié (Q2).
- **R2 — Ports UDP sur hôte « no host ports »** : déviation §3.4 ; repli TURN/443 (§3.5.1).
- **R3 — Maturité SDK RN LiveKit sur New Arch (Expo 54)** : valider en spike avant LIVE-6.
- **R4 — Sessions orphelines** (host crash) : webhook `room_finished` + balayage TTL ≤ durée max.
- **R5 — Modération live audio** : host mute/kick + report + kill-switch ; modération humaine hors V1.
- **R6 — Batterie diffusion audio prolongée** : moindre qu'en vidéo, à surveiller UX.

---

## 14. Questions ouvertes — DÉCISION PROPRIO requise

1. **Ports média sur l'hôte partagé** — tolère-t-on **1 port UDP mux (LiveKit) + ports coturn** (déviation du pattern
   « no host port mappings »), ou impose-t-on le **mode TURN/TCP-443 only** (latence ↑, mais 0 port UDP hôte) ?
2. **Nœud dédié pour la vidéo (plus tard)** — le proprio veut-il, à terme, **provisionner un nœud auto-hébergé dédié**
   (OSS, non payant en licence) pour débloquer la vidéo, ou la vidéo reste-t-elle **définitivement hors périmètre** ?
3. **Caps de charge sur le VPS partagé** — valide-t-on **≤ 3 lives concurrents / ≤ 200 viewers / ≤ 120 min** (§9), ou
   plus conservateur encore vu les voisins ?
4. **Persistance chat live** — **éphémère Redis** (cheap) ou **table `LiveMessage`** (traçabilité modération) ?
5. **Périmètre V1** — livrer d'emblée la **co-diffusion audio 3 flux (E5)**, ou **1 seul diffuseur d'abord** ?
6. **Enregistrement / replay** — non par défaut V1 (coût stockage MinIO + modération). Confirmer.
7. **Lives des comptes `private`** — interdits, ou autorisés en « live privé non listé » (test/soi-même) ?
8. **GO build mobile** — LIVE-6 impose **rebuild EAS + bump 1.9.0** (action sortante). À confirmer au gate build.
