# NigerConnect — Cadrage stratégique BETA (vidéo + « autres sujets »)

> Statut : **PROPOSITION** — aucune décision engagée. Hypothèses marquées `[SUPPOSÉ]` à trancher par le proprio.
> Date : 2026-07-03. Auteur : gwani-conseiller-strategique (via orchestration). Zéro code touché.
> Contexte : voir `memory/status.json`, `memory/backlog.md`, `memory/market.md`, `[[video-post-approche-A]]`.

---

## 0. Reformulation

Passer NigerConnect en **BETA publique**, fer de lance = **publication de vidéos pré-enregistrées** par les membres, + « plein d'autres sujets » non détaillés. Décision technique vidéo **déjà prise** : **Approche A** (compression on-device H.265, clips courts, MinIO self-host, zéro transcode serveur).

**Ancrage clé révélé par le code** : la vidéo est **déjà à moitié modélisée** — enum `MediaType.video` (`schema.prisma:221`), `PostMedia` porte déjà `mediaType/thumbnailUrl/width/height/blurhash` (`:494`). Pas un chantier vierge. Le vrai travail = garde-fous binding, disque, modération, mobile natif.

---

## 1. Diagnostic 9 axes (résumé)

1. **Profil** — solo dev, zéro dépense. Angle mort : la beta est un problème d'**opérations** (modération, support, monitoring disque), pas de code. Coût caché réel.
2. **Cible** — diaspora nigérienne. Veut l'expressivité (vidéo) ; a besoin d'utilité récurrente + confiance. La vidéo seule est un « veut », pas un « besoin ».
3. **Milieu** — vrais concurrents = WhatsApp/FB groups (gratuits, effet réseau). NigerConnect gagne par la **structure diaspora**, pas par « faire comme TikTok ». Vidéo courte = standard implicite.
4. **Mentalité** — forte sensibilité **privacy** (statut migratoire). Vidéo = visage/voix/lieu = bien plus identifiant qu'une photo. Privacy vidéo doit être irréprochable.
5. **Réalité** — VPS partagé serré (MinIO **512 Mo RAM**, **volume unique**, **aucun lifecycle configuré**). Zéro transcode ⇒ pas de HLS/ré-encodage/analyse serveur. Tout retombe sur le mobile.
6. **Terrain** — 4G faible, data comptée. Upload actuel **non resumable**. Micro **désactivé** (`RECORD_AUDIO` blocké). Compat HEVC Android inégale.
7. **Risque** — voir tableau ci-dessous.
8. **Avenir** — la vidéo est un **billet de parité**, PAS le moat. Moat = contexte diaspora (ville, GP, taux, multilingue). Ne pas en faire le cœur de roadmap.
9. **Objectif réel** — derrière « ajouter la vidéo » = « lancer une beta vivante, moderne, qui donne envie de rester ». Vidéo sert ça mais ne le remplit pas seule → beta = vidéo + rétention + polish.

### Risques (les morts silencieuses)
| Risque | Prob. | Impact | Note |
|---|---|---|---|
| **Disque VPS saturé** (vidéo permanente non bornée) | Élevée | **Critique** (tue TOUTES les apps du host) | Risque n°1. Sans quota + lifecycle + garde disque = bombe à retardement. |
| **Contenu T&S grave** sans modération pré-publication | Moyenne | **Critique** (légal/stores/réputation) | Zéro transcode = zéro analyse serveur bon marché. Maillon faible assumé. |
| Fuite privacy vidéo (bucket public) | Moyenne | Élevé | Vidéo `friends`/`private` = URL uuid en bucket public = sécurité par obscurité (hérité des images). |
| Upload échoue sur 4G faible | Élevée | Moyen | Pas de resumable → borner par taille + retry + cancel. |
| Scope creep beta | Élevée | Moyen | « Plein d'autres sujets » non cadré = dérive garantie. |
| Rebuild EAS casse l'existant | Faible | Moyen | Video = natif → rebuild + bump ; OTA crasherait. |

---

## 2. Périmètre BETA recommandé — thème « La diaspora prend vie »

Un thème fédérateur, pas une liste. La vidéo force un **rebuild natif + bump `1.9.0 → 1.10.0`** → livrer dans ce build ce qui a de la valeur immédiate, en résistant au scope creep : 1 chantier natif lourd (vidéo) + compagnons légers.

### ENTRE dans la beta
| Item | Pourquoi ICI | Coût/risque | Livraison |
|---|---|---|---|
| **Vidéo dans STORIES d'abord** (éphémère 24h) `[SUPPOSÉ: stories-first]` | Disque **borné** par TTL 24h (cron stories + MinIO lifecycle). Fenêtre modération courte. | Moyen. Rebuild. | Build 1.10.0 |
| **Vidéo courte en post feed — gated** (cohorte vérifiée + quota) `[SUPPOSÉ]` | Le « veut » explicite. Permanent → borner fort (quota + garde disque + cohorte verified). | Élevé (disque + modération) | Build 1.10.0 |
| **E-TAUX** (taux du jour + prix crowdsourcés) `[SUPPOSÉ, backlog S7]` | Habitude quotidienne = rétention beta. Source gratuite, bandeau feed. | Moyen, infra ~0 | API + OTA |
| **E-DIGEST** push hebdo `[SUPPOSÉ, S8]` | Ramène les dormants. 1 cron + Expo Push gratuit. Quick-win. | Faible, infra ~0 | API-only |
| **Kill-switch vidéo** (`video_enabled` AppSetting, fail-closed) | Ship DARK → activer sur cohorte → couper si abus (comme PX0 proximité). **Non négociable.** | Faible | API |

### ATTEND (hors beta v1 — anti scope creep)
E-GP colis-voyageurs (sprint dédié juste après, valeur max) · E-DIASPORA événements (carte à part) · **ANIM Vague B carte native + Lottie (NE PAS bundler avec la vidéo** — trop de natif d'un coup = risque régression carte) · i18n haoussa/zarma (sprint dédié) · suggestions IA/annuaire/transferts (V2+).

---

## 3. Dé-risquage Approche A (vidéo on-device, zéro transcode serveur)

### 3.1 Socle réel (file:line)
- `MediaType { image video }` **existe** (`schema.prisma:221`). `PostMedia`/`ServiceMedia` complets → **quasi aucune migration** vidéo.
- **Joint central à corriger** : `posts.service.ts:70` → `s3.assertOwnedPublicImage()` n'autorise QUE `image/jpeg|png|webp|heic` (`s3.service.ts:169`, cap 15 Mo). **Une vidéo est rejetée aujourd'hui.** De plus le `mediaType` vient du **client** sans confrontation au vrai `Content-Type` (HEAD) → spoofing possible. **C'est LE joint.**
- Presign verrouillé DTO images (`photo.dto.ts:12`). Clé `users/{userId}/{kind}`. Bucket public (sauf `identity` privé).
- Mobile : **aucun module vidéo** (`expo-video`/`expo-camera`/`react-native-compressor` absents). `expo-image-picker` (17.0.11) sait picker vidéo mais compression H.265 cap-dur = `react-native-compressor` (natif). Micro OFF (`microphonePermission:false`, `RECORD_AUDIO` blocké).

### 3.2 Limites chiffrées `[SUPPOSÉ — à valider]`
| Paramètre | Valeur | Justification |
|---|---|---|
| Durée max | **60 s** (stories 30 s) | Borne data/modération/disque |
| Résolution | **720p** (option 480p réseau faible) | Au-delà = coût sans gain perçu mobile |
| Codec | **H.265** cible, fallback **H.264** | iOS HEVC natif ; Android inégal. Le cap TAILLE est le vrai garde-fou |
| Bitrate | ~2 Mbps vidéo + AAC ~128 kbps | 720p HEVC = bon compromis |
| Content-Type | `video/mp4` (+ `video/quicktime`) | sortie react-native-compressor |
| **Taille max dure** | **≤ 25 Mo** (rejet strict) | ~10-18 Mo typique 60s/720p/HEVC. Sécurité disque + upload |
| Quota/user | **10 vidéos actives OU 200 Mo total**, **5 uploads/j** | Anti-abus disque (throttle Redis existant) |
| Rétention stories | **TTL 24h** + MinIO lifecycle expire 48h | Disque **borné** |
| Rétention feed | permanente MAIS quota/user + garde disque globale | Voir 3.4 |

### 3.3 Empreinte disque (risque n°1) — vidéo moyenne 15 Mo
- **Stories-vidéo (TTL 24h + purge 48h)** → régime stationnaire ≈ 2 jours. Ex. 100/j × 15 Mo × 2j ≈ **~3 Go stables**. Sûr.
- **Feed-vidéo (permanent)** → croissance **monotone** : 200 users × 0,5/sem ≈ **~6 Go/mois** ; 1000 users × 1/sem ≈ **~60 Go/mois → intenable** sans borne.
- **Conclusion** : la vidéo permanente est la vraie menace. Obligatoire : (a) stories-first, (b) quota/user strict + **garde disque globale fail-closed** (rejet au-delà d'un seuil volume MinIO) + alerte monitoring. Sans (a)+(b), **ne pas ouvrir la vidéo feed en beta**.

### 3.4 Rétention / purge (gratuit, self-host)
- **MinIO lifecycle** (`mc ilm rule add`) sur préfixe éphémère `users/*/story` → expire 48h. À ajouter au job d'init compose (aujourd'hui juste `mc mb`).
- **Cron stories existant** : étendre pour `s3.deleteObject(key)` du média (vérifier qu'il purge l'objet, pas juste la ligne DB).
- **Garde disque globale** : check volume MinIO → au-dessus d'un seuil, bascule `video_enabled=false` (fail-closed) + alerte.
- **Suppression post/compte** : `onDelete: Cascade` supprime la ligne `PostMedia` mais **PAS l'objet S3** → ajouter la purge objet (dette pré-existante, aggravée par la vidéo).

### 3.5 Modération (T&S élevé) — honnêteté
Zéro transcode = pas d'analyse serveur bon marché = **maillon faible assumé**. Palliatifs gratuits :
- **Cohorte restreinte** : vidéo réservée aux `identityStatus='approved'` en beta `[SUPPOSÉ]`.
- **Kill-switch `video_enabled`** fail-closed.
- **Signalement** : modèle `Report` existe → étendre à la vidéo. Takedown admin = soft-delete + `s3.deleteObject`.
- **Rate limits** upload (Redis) + **SLA retrait manuel court** (coût opérationnel proprio).
- **CGU / politique contenu** avant 1er upload.
- Honnête : pas de hachage CSAM/ML on-device gratuit fiable → **risque résiduel assumé**, borné par petite cohorte + retrait rapide + kill-switch. À **accepter explicitement** ou renoncer à la vidéo feed publique.

### 3.6 Privacy
- Fichier en **bucket public**, clé uuid non devinable → pour `friends`/`private` = **sécurité par obscurité**, comme les images aujourd'hui. Parité beta acceptable, à **documenter**.
- Vraie vidéo privée (visage/voix/lieu très identifiant) → option **bucket privé + presigned GET** (comme pièces d'identité), coût = 1 signature/visionnage (léger, pas de CPU). **Décision proprio.**
- Garde `users/{ownerId}/` reste valide → pas d'attache du média d'autrui.

### 3.7 Réseau faible
- Upload : cap bas + progress (déjà géré) + retry + cancel. Pas de resumable → cap dur = parade. 480p sur réseau faible.
- Lecture : **pas d'autoplay cellular**, vignette/poster (on-device) + tap-to-play, pas de préchargement multiple. Fichier progressif unique (pas de HLS).

### 3.8 Libs OSS (gratuites, toutes natives ⇒ rebuild + bump 1.10.0)
`react-native-compressor` (MIT, H.265 on-device, cap taille — **le pivot**) · `expo-video` (playback ; `expo-av` déprécié) · `expo-image-picker` (présent) · vignette via compressor ou `expo-video-thumbnails`. Réactiver micro (`microphonePermission`, retirer `RECORD_AUDIO` de `blockedPermissions`, ajouter `READ_MEDIA_VIDEO`).

---

## 4. « Plein d'autres sujets » — déduction `[TOUT SUPPOSÉ]`

Croisement `backlog.md` × `market.md` × gaps diaspora. Score = Valeur ÷ Effort ÷ Risque.

| Candidat | V | E | R | Verdict |
|---|---|---|---|---|
| **E-DIGEST** push hebdo (S8) | Haute | Faible | Faible | **DANS beta** (quick-win rétention) |
| **E-TAUX** taux + prix (S7) | Haute | Moyen | Faible | **DANS beta** (raison de revenir) |
| **E-GP** colis-voyageurs (S5) | Très haute | Moyen | Faible | **Juste après** (sprint dédié) |
| Kill-switch + modération vidéo | Critique | Faible | — | **DANS beta** (obligatoire) |
| E-DIASPORA événements (S6) | Haute | Moyen | Faible | Après |
| i18n haoussa/zarma | Haute | Faible | Faible | Sprint dédié |
| B1 likers / double-tap / heart-burst | Moyenne | Faible | Faible | Optionnel sur 1.10.0 |
| ANIM Vague B (carte native + Lottie) | Haute | Élevé | Moyen | **Pas dans la beta vidéo** |

**Contenu beta cohérent** = Vidéo (stories-first, feed gated) + E-TAUX + E-DIGEST + kill-switch/modération. E-GP en sprint suivant.

---

## 5. Suite : orchestrateur + sprints

**Oui, `gwani-orchestrator` bout-en-bout — MAIS après (a) validation périmètre proprio et (b) un ADR vidéo** (`gwani-architect`), comme LIVES et ANIM-7. Ne pas court-circuiter ce gate.

- **S-VIDEO-0 — ADR** : contrat pipeline (presign vidéo, `assertOwnedPublicMedia` + intégrité `mediaType` vs Content-Type HEAD, caps, quota, MinIO lifecycle, garde disque, modération, kill-switch, parité vs bucket privé). **Gate décision proprio.**
- **S-VIDEO-1 — Backend DARK** : presign vidéo, nouveau garde média (vidéo + caps + confronte Content-Type réel), quota/user, rate-limit, lifecycle MinIO, garde disque, `video_enabled` fail-closed. Déployable inerte.
- **S-VIDEO-2 — Mobile (rebuild)** : capture/pick + compression H.265 + vignette + player + progress/retry/cancel + no-autoplay-cellular + réactiver micro. **Bump 1.10.0. Build EAS = sortant → GO proprio.**
- **S-VIDEO-3 — Modération/T&S + tests** : report vidéo, takedown+purge S3, e2e, **gwani-pentest** (binding, mediaType spoofing, IDOR, privacy, quota, kill-switch). Verdict `OK_TO_DEPLOY` = gate dur.
- **Compagnons OTA-safe sur 1.10.0** : E-TAUX (API+mobile), E-DIGEST (API-only). E-GP en S-GP après.

DoD projet (Zod, AuthZ/IDOR, privacy, tests verts, revue, verdict sécu, bump) + gate `READY_FOR_DEPLOY` + approbation proprio avant tout déploiement.

---

## 6. Décisions proprio requises AVANT implémentation

1. **Vidéo : stories-first (éphémère, disque borné) d'abord, feed permanent ensuite ? Ou feed dès la beta ?** (Reco : stories-first + feed gated.)
2. **Cohorte beta vidéo** : tous les membres, ou uniquement **identity-verified** ? (Reco : verified-only.)
3. **Limites** : valider 60s / 720p / ≤25 Mo / quota 10 vidéos ou 200 Mo/user / 5 uploads/j.
4. **Privacy** : parité images (bucket public + uuid) OU vidéo `private`/`friends` en **bucket privé + presigned GET** ?
5. **Modération** : acceptes-tu le **risque résiduel T&S** (petite cohorte + retrait rapide + kill-switch) + un **SLA de retrait** ? Sinon renoncer à la vidéo feed publique.
6. **Contenu beta** : confirmes-tu **vidéo + E-TAUX + E-DIGEST** (E-GP après), et l'**exclusion** carte native/Lottie de ce build ?
7. **GO rebuild `1.10.0`** (action sortante EAS).

### Questions ouvertes
- Taille cohorte beta visée (200 ? 1000 ?) → conditionne le chiffrage disque.
- Le cron stories purge-t-il l'objet S3 ou juste la ligne DB ? (auditer)
- Vidéo beta sonore (réactiver `RECORD_AUDIO`) ou muette d'abord ?

> Rien ne part en code tant que les décisions **1-2-5-6** ne sont pas tranchées : elles déterminent si la beta vidéo est sûre pour un VPS partagé + solo-dev, ou une bombe disque/modération.
