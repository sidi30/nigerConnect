# Soumission Google Play & App Store — checklist & contenus

**But** : éviter un retour de review pour défaut de conformité.
**Cible** : NigerConnect 1.0.0, package `com.nigerconnect.app`.

Ce document fournit **tout** ce qu'un reviewer va demander, prêt à copier-coller.

---

## 1. URLs publiques requises (toutes vivantes)

Ces URLs doivent répondre **200 OK** pour passer la review. Toutes hébergées par `apps/web/` (Next.js sur Vercel).

| URL | Usage | Page |
|---|---|---|
| `https://nigerconnect.app/` | Site vitrine, lien "Visit website" | `app/page.tsx` ✅ |
| `https://nigerconnect.app/privacy` | **Privacy Policy URL** (Play + Apple obligatoires) | `app/privacy/page.tsx` ✅ |
| `https://nigerconnect.app/terms` | Terms of Service | `app/terms/page.tsx` ✅ |
| `https://nigerconnect.app/community` | Community guidelines | `app/community/page.tsx` ✅ |
| `https://nigerconnect.app/account-deletion` | **Account deletion** (Play obligatoire depuis avril 2024) | `app/account-deletion/page.tsx` ✅ |
| `https://nigerconnect.app/support` | Support + FAQ + emails dédiés | `app/support/page.tsx` ✅ |
| `https://nigerconnect.app/verify-email?token=…` | Lien de mail de vérification | `app/verify-email/page.tsx` ✅ |
| `https://nigerconnect.app/reset-password?token=…` | Lien de reset password | `app/reset-password/page.tsx` ✅ |

**Sanity check automatisé** : utiliser le script `scripts/smoke-prod.sh` qui vérifie d'un coup les URLs publiques, le bon `Content-Type` des `.well-known`, les headers de sécurité et `/health/live` + `/health/ready` :

```bash
./scripts/smoke-prod.sh \
  https://nigerconnect.app \
  https://api.nigerconnect.app
# Exit code 0 si tout est vert, sinon non-zero (utilisable en CI).
```

---

## 2. Google Play Console — checklist complète

### 2.1 « Main store listing »

| Champ | Valeur |
|---|---|
| App name | **NigerConnect** |
| Short description (80 chars max) | `Le réseau social de la diaspora nigérienne. Se retrouver, s'entraider.` (74 chars) |
| Full description (4000 chars max) | Voir §5 ci-dessous |
| App icon | `apps/mobile/assets/icon.png` (512×512 PNG) |
| Feature graphic | **À créer** : 1024×500 PNG/JPG, branding orange + drapeau Niger |
| Phone screenshots (min 2, max 8) | **À capturer** : 1080×1920 ou 1080×2400, écrans Feed / Carte / Chat / Profil / Stories |
| 7-inch tablet (optional) | Non requis (mobile-first) |
| Video promo (YouTube URL) | Optionnel |

### 2.2 « Store settings »

| Champ | Valeur |
|---|---|
| App or game | **App** |
| Free or paid | **Free** |
| Category | **Social** |
| Tags (5 max) | `social`, `community`, `messaging`, `diaspora`, `niger` |
| Contact email | `contact@nigerconnect.app` |
| Contact phone | (optionnel) |
| Contact website | `https://nigerconnect.app/` |
| Privacy Policy | `https://nigerconnect.app/privacy` |

### 2.3 « App content »

#### Privacy Policy
URL : `https://nigerconnect.app/privacy`

#### App access (Login required)
> ☑ All or some functionality is restricted

Fournir des credentials de test :

```
Email    : reviewer@nigerconnect.ne
Password : ReviewPlay2026!
Notes    : Compte test pré-rempli (3 amis fictifs, 2 conversations, 5 posts).
           Email pré-vérifié, identité non vérifiée.
           Pour tester la suppression : utilisez le compte
           reviewer-deletion@nigerconnect.ne / DeletePlay2026!
           (jetable, sera recréé après chaque review).
```

⚠️ **Action requise** : exécuter le seed pour créer ces comptes :

```bash
# Sur le VPS, après le 1er deploy
docker exec -it nigerconnect-api node -e "require('./dist/scripts/seed-reviewer').run()"
# OU en dev
pnpm --filter @nigerconnect/api seed:reviewer
```

Le script crée les deux comptes + 3 amis fictifs + 5 posts + 1 conversation pour que le reviewer ait un environnement déjà rempli (idempotent).

#### Ads
> ☐ My app does not contain ads

#### Content rating (questionnaire IARC)
Réponses pour NigerConnect :
- Catégorie : **Social Networking & Communication**
- Violence : **No**
- Sexual content : **No** (mais l'app permet user-generated content → Apple peut classer 17+)
- Profanity : **No**
- Drugs/alcohol/tobacco : **No**
- Gambling : **No**
- User-generated content : **Yes — texts, photos, video**
- Users can interact : **Yes — messaging, comments**
- Sharing user info publicly : **Yes — profile, posts (selon paramètre confidentialité)**
- Sharing user location : **Yes, approximate only — opt-in**
- Digital purchases : **No**

Rating attendu : **PEGI 12 / Teen / 13+**

#### Target audience and content
- Target age : **13+** (cohérent avec les CGU)
- Appeals to children : **No**
- Designed for Families : **No**

#### News app
> ☐ My app is not a news app

#### COVID-19 contact tracing
> ☐ Not a contact tracing app

#### Data safety form
Voir §3 ci-dessous (réponses prêtes).

#### Government apps
> ☐ Not a government app

#### Financial features
> ☐ Not a financial app (le marketplace est de l'entraide non-rémunérée)

#### Health apps
> ☐ Not a health app

#### Account deletion
> ☑ Yes, users can request account deletion

URL : `https://nigerconnect.app/account-deletion`

> ☑ When a user requests account deletion, both the account and associated data are deleted

Description :
```
Suppression immédiate et complète depuis l'app (Paramètres → Supprimer mon compte)
ou via l'URL publique. Toutes les données utilisateur (profil, publications,
messages, photos, amitiés, vérifications d'identité) sont effacées de la base
en moins de 5 secondes. Seuls les logs techniques anonymisés sont conservés
30 jours pour la sécurité, puis détruits.
```

### 2.4 « Sensitive permissions / API »

Justification à coller pour chaque permission « sensitive » :

| Permission | Justification |
|---|---|
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | Optionnelle. Permet à l'utilisateur d'apparaître sur la carte de la diaspora pour rencontrer d'autres membres dans sa ville. Désactivable à tout moment dans Paramètres → Confidentialité. Aucun usage publicitaire ni revente. |
| `CAMERA` | Prendre des photos pour le profil, les publications et les stories. Déclenchée uniquement par action utilisateur. |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` | Sélectionner une photo/vidéo existante depuis la galerie pour l'envoyer dans un message ou l'attacher à un post. |
| `POST_NOTIFICATIONS` | Notifier d'un nouveau message, d'une demande d'ami, ou d'un nouveau commentaire. Désactivable dans les réglages système. |
| `RECORD_AUDIO` | **Non utilisée activement**. Requise par Android pour permettre la capture vidéo silencieuse via la caméra. |

⚠️ **Action requise** : si Google Play demande la *Permissions Declaration Form* pour `ACCESS_FINE_LOCATION`, choisir « Approximate location », justifier par la carte de la diaspora, et joindre une vidéo de 30 s montrant le toggle dans les paramètres.

---

## 3. Google Play Data Safety form — réponses

À remplir dans Play Console → App content → Data safety. Toutes les réponses ci-dessous sont **alignées** avec ce qui est dit dans `/privacy`.

### Data collection and security

- **Encrypted in transit** : ✅ Yes (TLS 1.3 imposé par Cloudflare)
- **Encrypted at rest** : ✅ Yes (PostgreSQL volumes chiffrés VPS, S3 SSE-AES256, MFA secrets AES-256-GCM column-level)
- **Data deletion** : ✅ Yes (in-app + URL publique)
- **Independent security review** : ☐ No (audit interne seulement)

### Data types collected

| Catégorie | Sous-type | Collected? | Purpose | Optional? | Shared with 3rd party? |
|---|---|---|---|---|---|
| **Personal info** | Name | ✅ | App functionality, account | ❌ Required | ❌ No |
| | Email | ✅ | Account, communications | ❌ Required | ❌ No |
| | User ID | ✅ | App functionality | ❌ | ❌ |
| | Address | ❌ | — | — | — |
| | Phone number | ✅ | Account (optionnel) | ✅ Optional | ❌ |
| | Race/ethnicity | ❌ | — | — | — |
| | Political views | ❌ | — | — | — |
| | Sexual orientation | ❌ | — | — | — |
| | Religion | ❌ | — | — | — |
| | Other personal info | ✅ — Bio | App functionality | ✅ | ❌ |
| **Financial info** | — | ❌ | — | — | — |
| **Health & fitness** | — | ❌ | — | — | — |
| **Messages** | Emails | ❌ | — | — | — |
| | SMS or MMS | ❌ | — | — | — |
| | Other in-app messages | ✅ | App functionality (chat) | ❌ | ❌ |
| **Photos and videos** | Photos | ✅ | App functionality | ✅ | ❌ |
| | Videos | ❌ | — | — | — |
| **Audio files** | — | ❌ | — | — | — |
| **Files and docs** | — | ✅ — pièce d'identité | Identity verification | ✅ Optional | ❌ |
| **Calendar** | — | ❌ | — | — | — |
| **Contacts** | — | ❌ | — | — | — |
| **App activity** | App interactions | ✅ | Analytics (anonymisées) | ✅ | ✅ Sentry (errors only) |
| | In-app search history | ❌ | — | — | — |
| | Installed apps | ❌ | — | — | — |
| | Other user-generated content | ✅ — posts/comments | App functionality | ❌ | ❌ |
| **Web browsing** | — | ❌ | — | — | — |
| **App info & performance** | Crash logs | ✅ | Analytics (Sentry) | — | ✅ Sentry |
| | Diagnostics | ✅ | Analytics | — | ✅ Sentry |
| | Other app performance data | ✅ | Analytics | — | ✅ Sentry |
| **Device or other IDs** | Device or other IDs | ✅ | Push notifications, analytics | — | ✅ FCM |
| **Location** | Approximate location | ✅ | App functionality (carte) | ✅ Opt-in | ❌ |
| | Precise location | ❌ | — | — | — |

### Security practices summary

À cocher dans le formulaire :
- ☑ Data is encrypted in transit
- ☑ You can request that data be deleted

---

## 4. Apple App Store Connect — points spécifiques (si vous publiez aussi iOS)

### 4.1 App Information

| Champ | Valeur |
|---|---|
| Name | NigerConnect |
| Subtitle (30 chars) | `Diaspora nigérienne unie` |
| Bundle ID | `com.nigerconnect.app` |
| SKU | `nigerconnect-1` |
| Primary language | French (Canada) ou French (France) |
| Category | Social Networking |
| Secondary | Lifestyle |
| Content rights | Does not contain third-party content |
| Age rating | **17+** (Apple force 17+ pour user-generated content sans modération automatisée stricte) |

### 4.2 App Privacy (équivalent Apple du Data Safety)

Mêmes réponses que §3, format Apple.

### 4.3 Sign in with Apple — **bloquant pour l'iOS**

> Apple Guidelines 4.8 : si tu offres Google Sign-In, tu **dois** offrir Sign in with Apple.

Le code est **prêt pour les deux options** : un seul flag (`extra.appleSignInEnabled` dans `app.json`) contrôle l'affichage des boutons. Quand le flag est `false` (défaut actuel), Google Sign-In est automatiquement masqué sur iOS pour rester compliant 4.8 — la stratégie B "release rapide" est donc déjà active.

**A. Activer Apple Sign-In** (recommandé pour iOS — bouton Apple visible)
1. Apple Developer Program ($99/an) → indispensable pour publier
2. Identifiers → "+" → Service ID `com.nigerconnect.app.signin`
3. Activer "Sign in with Apple", configurer le domain `nigerconnect.app` + return URL
4. Créer une Key (`.p8`) avec Sign in with Apple enabled, télécharger
5. Remplir dans `.env.prod` :
   ```
   APPLE_CLIENT_ID=com.nigerconnect.app.signin
   APPLE_TEAM_ID=XXXXXXXXXX
   APPLE_KEY_ID=XXXXXXXXXX
   APPLE_PRIVATE_KEY=$(cat AuthKey_XXXXXXXXXX.p8 | base64)
   ```
6. Dans `apps/mobile/app.json`, basculer `extra.appleSignInEnabled` à `true` ET `ios.usesAppleSignIn` à `true`.
7. Rebuild EAS Production pour iOS.

**B. Pas Apple Sign-In maintenant — release iOS 1.0 sans aucun social login** *(actif par défaut)*
- `extra.appleSignInEnabled = false` → AppleButton invisible
- `Platform.OS === 'ios'` + flag false → GoogleButton invisible aussi (cf `components/ui/GoogleButton.tsx`)
- Sur iOS, l'utilisateur s'inscrit en email/password uniquement → 4.8 satisfait (pas de third-party social login)
- Sur Android, Google reste disponible
- Bascule en option A en release 1.1 quand la cert Apple est en main : il suffit de flipper le flag.

### 4.4 App Review Information

```
Demo account
Email    : reviewer@nigerconnect.ne
Password : ReviewApple2026!

Account deletion test
Email    : reviewer-deletion@nigerconnect.ne
Password : DeleteApple2026!

Notes
NigerConnect is a social network for the Nigerien diaspora (~62k people across
15+ countries). The app requires login because all features are user-to-user.

To test:
1. Open the app, sign in with the demo account.
2. Browse the Feed / Map / Services tabs.
3. Open a conversation under Messages → send a text and a photo.
4. Profile → Edit profile → Change avatar (uses camera or library).
5. Settings → Delete account to verify deletion flow.

Notification testing : the demo account is set to receive a daily test push
at 09:00 UTC.

Privacy policy : https://nigerconnect.app/privacy
Account deletion (web) : https://nigerconnect.app/account-deletion
Support : contact@nigerconnect.app
```

### 4.5 Export Compliance
Déjà géré dans `apps/mobile/app.json` :
```
"ITSAppUsesNonExemptEncryption": false,
"usesNonExemptEncryption": false
```
→ no extra documentation required.

---

## 5. Descriptions store (FR, prêtes à coller)

### Short description (80 chars)

```
Le réseau social de la diaspora nigérienne. Se retrouver, s'entraider.
```
(74 chars)

### Full description

```
NigerConnect est l'application qui rassemble les Nigériennes et Nigériens
vivant à l'étranger ou au pays. 62 000+ membres potentiels répartis dans
15+ pays — une vraie communauté pour se retrouver, s'entraider et rester
connectés à ses racines.

🌍 RETROUVE LA DIASPORA
- Carte interactive : repère les Nigériens autour de toi, partout dans le
  monde — Paris, New York, Dakar, Tunis…
- Recherche par ville, pays, association
- Profils vérifiés (badge ✓) pour tisser des liens en confiance

📰 RESTE CONNECTÉ
- Fil d'actualité : photos, témoignages, événements de la communauté
- Stories 24h : moments du quotidien
- Réagis, commente, repartage en quelques secondes

💬 DISCUTE EN PRIVÉ
- Messagerie temps réel
- Partage de photos
- Conversations chiffrées en transit

🤝 ENTRAIDE-TOI
- Marketplace solidaire : logement, démarches admin, transport, santé…
- Demande d'aide ou propose tes services
- Système de notation pour la confiance

🏛️ ASSOCIATIONS
- Liste des associations nigériennes par ville/pays
- Rejoins celles qui te ressemblent
- Découvre leurs événements

🔒 RESPECT DE TA VIE PRIVÉE
- Aucune publicité ciblée, aucun pistage publicitaire
- Données chiffrées (TLS 1.3 + repos)
- Suppression de compte immédiate, en 1 clic
- Conforme RGPD

NigerConnect est une app indépendante, gratuite, créée par et pour la
diaspora nigérienne. Pas de modèle économique caché : on construit ensemble
le réseau dont notre communauté a besoin.

Site : https://nigerconnect.app
Confidentialité : https://nigerconnect.app/privacy
Contact : contact@nigerconnect.app
```

### What's new (release notes 1.0.0)

```
👋 Bienvenue sur NigerConnect — première version publique !
- Fil d'actu, stories, messagerie temps réel
- Carte de la diaspora dans 15+ pays
- Marketplace d'entraide
- Associations
- Sign-in Google et email
```

---

## 6. Comptes de test — script idempotent

Le script `apps/api/scripts/seed-reviewer.ts` crée tout d'un coup et est idempotent (rerun sans problème) :

```bash
# Production (depuis le VPS)
docker exec -it nigerconnect-api node -e "require('./dist/scripts/seed-reviewer').run()"

# Dev local
pnpm --filter @nigerconnect/api seed:reviewer
```

Ce qu'il provisionne :
- `reviewer@nigerconnect.ne` / `ReviewPlay2026!` — compte principal pour la review
- `reviewer-deletion@nigerconnect.ne` / `DeletePlay2026!` — compte jetable pour le test de suppression
- 3 amis fictifs reliés au reviewer (Aminata Niamey, Ousmane Paris, Fatima Montréal)
- 5 posts variés du reviewer (mix `public` / `friends`)
- 1 conversation reviewer ↔ Aminata avec 2 messages

À relancer **après chaque review** pour recréer le compte deletion qui s'auto-supprime pendant le test :

```bash
docker exec -it nigerconnect-api node -e "require('./dist/scripts/seed-reviewer').run()"
```

---

## 7. Screenshots — guide rapide

### Tailles requises Google Play (au moins 2 par device)
- Phone : 1080 × 1920 (portrait) ou 1080 × 2400
- 7-inch tablet : 1200 × 1920 (optionnel)
- 10-inch tablet : 1440 × 2560 (optionnel)

### Tailles requises Apple
- iPhone 6.7" : 1290 × 2796 (iPhone 14/15 Pro Max)
- iPhone 6.5" : 1242 × 2688 ou 1284 × 2778
- iPhone 5.5" : 1242 × 2208 (legacy, parfois requis)
- iPad Pro 12.9" : 2048 × 2732

### Liste suggérée (5 captures)
1. **Hero / Welcome** — l'écran d'accueil avec le drapeau, le nom, le bouton "Se connecter"
2. **Feed / Stories** — un fil rempli avec stories en haut
3. **Carte** — la carte du monde avec markers Niger, France, USA
4. **Chat** — une conversation avec photo et message
5. **Profil** — un profil avec badge ✓ vérifié

Outil recommandé : `eas build --profile preview` puis screen recorder de l'émulateur Android Studio + simulateur Xcode. Polish dans Figma avec un mockup d'iPhone autour si tu veux marketing.

---

## 8. Checklist finale avant clic « Submit »

### Backend
- [ ] `https://nigerconnect.app/privacy` répond 200
- [ ] `https://nigerconnect.app/terms` répond 200
- [ ] `https://nigerconnect.app/community` répond 200
- [ ] `https://nigerconnect.app/account-deletion` répond 200
- [ ] Sitemap inclut les 4 URLs (`/sitemap.xml`)
- [ ] `https://api.nigerconnect.app/health` répond `ok` sur DB + Redis
- [ ] Comptes `reviewer@nigerconnect.ne` + `reviewer-deletion@nigerconnect.ne` créés en prod, mots de passe testés
- [ ] Compte reviewer principal a au moins 3 amis fictifs, 1 conversation, 5 posts
- [ ] Email `contact@nigerconnect.app` reçoit (test : envoyer un mail bidon, vérifier réception)

### Mobile
- [ ] `app.json:version = "1.0.0"`, `versionCode = 1`, `buildNumber = "1"`
- [ ] Build EAS production lancé (`eas build -p android --profile production`)
- [ ] Smoke test sur appareil physique : login, feed, chat (envoi + réception), upload photo, suppression compte
- [ ] Lien des CGU / privacy depuis le Footer du Welcome screen mène bien aux versions web

### Stores
- [ ] Google Play : tous les champs §2 remplis
- [ ] Google Play : Data Safety form §3 rempli
- [ ] Apple : App Privacy §4.2 rempli
- [ ] Apple : Sign in with Apple soit activé (4.A) soit Google retiré pour iOS (4.B)
- [ ] Screenshots déposés (5 phone, idéalement 5 tablet)
- [ ] Feature graphic 1024×500 déposé
- [ ] Description courte + longue copiées depuis §5
- [ ] Demo accounts copiés dans App access / Review information

### Post-soumission
- [ ] Sentry vérifié : aucune erreur critique sur les 2 derniers jours
- [ ] Backups Postgres planifiés (cf `docs/PRODUCTION_READINESS.md` §3.5)
- [ ] Quelqu'un d'astreinte est dispo pour répondre à un retour de review en < 24h

---

## 9. Bilan conformité

| Exigence Play Store | Statut |
|---|---|
| Privacy Policy URL publique | ✅ `/privacy` |
| Terms of Service URL publique | ✅ `/terms` |
| Community guidelines URL | ✅ `/community` |
| Support / contact URL | ✅ `/support` |
| Account deletion in-app | ✅ `Settings → Supprimer mon compte` |
| Account deletion URL publique | ✅ `/account-deletion` |
| RGPD export article 20 | ✅ in-app `Confidentialité → Exporter mes données` + endpoint `GET /profile/me/export` |
| Email de contact public | ✅ `contact@nigerconnect.app` (à activer côté boîte mail) |
| Test accounts pour reviewer | ✅ Script idempotent prêt (`pnpm seed:reviewer`) |
| Data Safety form rempli | 🟡 Réponses prêtes (§3) — à coller dans Play Console |
| Permission justifications | ✅ Texte prêt (§2.4) — permissions Android **minimisées** (RECORD_AUDIO retiré, FINE_LOCATION blocked) |
| Content rating | 🟡 Réponses prêtes (§2.3) — à valider dans Play Console |
| Pre-launch report (test interne EAS) | 🟡 À lancer via EAS après 1er build |

| Exigence App Store | Statut |
|---|---|
| Privacy Policy URL | ✅ |
| App Privacy declarations | 🟡 Réponses prêtes (§3) |
| Guideline 4.8 (Apple Sign-In si Google offert) | ✅ Code déjà conforme — Google masqué iOS quand `appleSignInEnabled=false` |
| Demo account | ✅ Script seed prêt |
| Screenshots requis | 🔴 À capturer (§7) — action manuelle |
| Feature graphic 1024×500 | 🔴 À créer (§7) |
| Export compliance | ✅ Déjà déclaré dans `app.json` |

**Légende** : ✅ fait / code prêt · 🟡 prêt à exécuter (action manuelle requise) · 🔴 bloquant non-codable

### Outillage de vérification automatisée

| Script | Usage |
|---|---|
| `scripts/smoke-prod.sh` | Vérifie d'un coup URLs publiques + headers sécu + `/health` après chaque deploy |
| `scripts/backup-pg.sh` | Dump Postgres quotidien gzip + retention 14j + Sundays 8w + miroir off-host (rclone) |
| `pnpm seed:reviewer` | Crée/met à jour les comptes test reviewer + leurs données fictives |
