# Go-Live — checklist NigerConnect

Tout ce qui reste avant de générer l'app prod et la pousser sur les stores.
Code = `v1.0.0` + Phase 11. Ne reste que de la **config / secrets / assets**.

État local déjà appliqué :

- ✅ `.gitignore` couvre maintenant `.env.prod`
- ✅ `.env.prod` créé avec passwords aléatoires
- ✅ `apps/mobile/app.json` → `version` bumpée à `1.0.0`
- ✅ `apps/web/public/.well-known/` (templates AASA + assetlinks)
- ✅ Headers `Content-Type: application/json` configurés pour les `.well-known`
- ✅ **Apple Sign-in désactivé** (bouton caché, code conservé pour réactivation rapide)
- ✅ **Email verification UX livré** : page web `/verify-email`, écran mobile `verify-email`, bannière de rappel dans le feed

---

## ~~Apple Sign-in~~ ❌ désactivé

**Statut** : ne pas inclure dans le 1er release MVP.

**Pourquoi** : nécessite Apple Developer Program à 99 $/an + une Service ID + une Key `.p8`. Pas indispensable côté Android.

**Conséquence importante** : Apple impose dans ses guidelines (4.8) que toute app iOS proposant un login social tiers (Google, Facebook…) propose **aussi** Sign in with Apple. Donc :

- ✅ OK pour Android (Google Play)
- ⚠️ Le 1er build iOS sera **rejeté** par Apple si on garde Google Sign-in. Deux options :
  1. Désactiver aussi Google sur iOS pour le 1er build (login email seul)
  2. Activer Apple Sign-in avant submit iOS (réactiver `AppleButton.tsx` + remplir `APPLE_*` dans `.env.prod` + déclarer Service ID Apple)

**Code conservé** dans `AppleButton.tsx` derrière un `return null` — facile à réactiver.

---

## Étape 1 — Sentry (~5 min)

**Ce qu'il faut faire concrètement :**

1. Aller sur <https://sentry.io>, créer un compte gratuit (ou se connecter).
2. Créer une **organisation** `nigerconnect` (ou réutiliser une existante).
3. Créer **3 projets** dans cette org :
   - "Create Project" → plateforme **Node.js** → nom `nigerconnect-api`
   - "Create Project" → plateforme **Next.js** → nom `nigerconnect-web`
   - "Create Project" → plateforme **React Native** → nom `nigerconnect-mobile`
4. Pour chaque projet, Settings → Client Keys (DSN) → copier le DSN (format `https://xxxxx@sentry.io/yyyy`).
5. Coller :

| DSN | Où |
|---|---|
| API | `.env.prod` ligne `SENTRY_DSN=` |
| Web | Vercel → Settings → Env Vars → `NEXT_PUBLIC_SENTRY_DSN` (ou directement `apps/web` si déploiement VPS) |
| Mobile | `apps/mobile/app.json` → `extra.sentryDsn` |

**Tier gratuit** : 5 000 events/mois, suffisant largement.

**Optionnel** : configurer le sample rate dans `.env.prod` :
```
SENTRY_TRACES_SAMPLE_RATE=0.3
```

---

## Étape 2 — Firebase / FCM push (~15 min)

**Pourquoi** : pour envoyer des notifications push aux apps mobiles.

**Ce qu'il faut faire concrètement :**

### a) Créer le projet Firebase

1. <https://console.firebase.google.com> → "Add project" → nom `NigerConnect`.
2. Désactiver Google Analytics si tu n'en as pas besoin (plus simple).

### b) Ajouter l'app Android

1. Console Firebase → "Add app" → icône Android.
2. Package name : `com.nigerconnect.app` (doit matcher `apps/mobile/app.json` → `android.package`).
3. Télécharger `google-services.json` → placer dans `apps/mobile/google-services.json`.
4. **Ajouter à `.gitignore`** : `apps/mobile/google-services.json` (déjà couvert par `*.json` ? À vérifier — sinon explicite).

### c) Ajouter l'app iOS

1. Console Firebase → "Add app" → icône iOS.
2. Bundle ID : `com.nigerconnect.app` (matche `apps/mobile/app.json` → `ios.bundleIdentifier`).
3. Télécharger `GoogleService-Info.plist` → placer dans `apps/mobile/GoogleService-Info.plist`.

### d) Récupérer le service account pour l'API

1. Console Firebase → ⚙️ Project settings → onglet **Service accounts** → "Generate new private key" → JSON téléchargé.
2. Encoder en base64 :
   ```bash
   base64 -w 0 ~/Downloads/nigerconnect-firebase-adminsdk.json > fcm.b64
   cat fcm.b64
   ```
   Ou en PowerShell :
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\ramzi\Downloads\nigerconnect-firebase-adminsdk.json"))
   ```
3. Coller la chaîne base64 dans `.env.prod` → `FCM_SERVICE_ACCOUNT_JSON=`.

### e) APN key (iOS uniquement, plus tard)

Apple Developer → Keys → "+" → enable APNs → upload du `.p8` dans Firebase → Project settings → Cloud Messaging.

**À faire seulement quand tu actives la build iOS.**

---

## Étape 3 — Google OAuth (uniquement, Apple skippé) (~20 min)

**Pourquoi** : pour le bouton "S'inscrire avec Google" sur mobile + web.

**Ce qu'il faut faire concrètement :**

1. Aller sur <https://console.cloud.google.com> → sélectionner le projet Firebase (créé étape 2 — Firebase = un projet GCP).
2. Menu → **APIs & Services → Credentials**.
3. **OAuth consent screen** d'abord (si pas déjà fait) :
   - User Type : External
   - App name : NigerConnect
   - User support email : ton email
   - App logo : icône 120×120
   - Authorized domains : `sahabiguide.com`
   - Scopes : `email`, `profile`, `openid` (les 3 par défaut)
   - Test users : ton email (en mode "Testing")
   - **Publier l'app** une fois prêt (sinon limité à 100 users de test)

4. **Credentials → Create Credentials → OAuth client ID** — répéter **3 fois** :

| # | Application type | Champs | Variable cible |
|---|---|---|---|
| 1 | **Web application** | Authorized redirect URIs : `https://api-nigerconnect.sahabiguide.com/auth/google/callback` | `GOOGLE_CLIENT_ID_WEB` |
| 2 | **Android** | Package : `com.nigerconnect.app`<br>SHA-1 : à récupérer après le 1er `eas build` Android via `eas credentials -p android` | `GOOGLE_CLIENT_ID_ANDROID` |
| 3 | **iOS** | Bundle ID : `com.nigerconnect.app` | `GOOGLE_CLIENT_ID_IOS` |

5. Coller les 3 client IDs (format `xxxxx.apps.googleusercontent.com`) :
   - `.env.prod` → `GOOGLE_CLIENT_ID_WEB / ANDROID / IOS`
   - `apps/mobile/app.json` → `extra.googleClientIdAndroid` et `extra.googleClientIdIos` (le Web est déjà rempli)

> **Note SHA-1 Android** : le keystore est généré par EAS au 1er build. Donc ordre : (a) faire un build Android dev/preview, (b) `eas credentials -p android` → noter SHA-1, (c) créer le client OAuth Android avec ce SHA-1, (d) builder à nouveau en prod.

---

## Étape 4 — Resend (emails de vérification + reset)

**Pourquoi** : envoyer les emails de vérification d'adresse + reset password. Sans Resend, les liens sont juste loggés dans la console — donc bloquant pour la prod.

**Ce qu'il faut faire concrètement :**

1. <https://resend.com> → créer compte (gratuit jusqu'à 3 000 emails/mois, 100/jour).
2. **Domains → Add domain** → `sahabiguide.com`.
3. Resend te donne 4 enregistrements DNS à créer dans Cloudflare :
   - 1 × MX (`send.sahabiguide.com`)
   - 1 × SPF (TXT)
   - 2 × DKIM (TXT)
4. Ajoute-les dans Cloudflare → **proxied = OFF** (DNS only, sinon Cloudflare casse la résolution mail).
5. Resend → Domains → "Verify" → attendre ~30 s → status doit passer à **Verified**.
6. **API Keys → Create API key** → nom `nigerconnect-prod` → permission Full Access → copier (commence par `re_…`).
7. Coller dans `.env.prod` → `RESEND_API_KEY=`.

**Test** : après deploy, tu fais un signup avec ton email → tu dois recevoir l'email de vérification.

---

## Étape 5 — DNS Cloudflare (3 records)

Dans la zone `sahabiguide.com`, **proxied = ON** (orange) :

| Sous-domaine | Type | Cible |
|---|---|---|
| `nigerconnect.sahabiguide.com` | A | `46.224.193.109` |
| `api-nigerconnect.sahabiguide.com` | A | `46.224.193.109` |
| `cdn-nigerconnect.sahabiguide.com` | A | `46.224.193.109` |

Propagation ~1-5 min. Pas besoin d'attendre la propagation pour lancer le deploy — Traefik gère le cert dès que le DNS résout.

---

## Étape 6 — Deploy VPS (création OU mise à jour)

**Le script `scripts/deploy-vps.sh` est idempotent.** Il fait la bonne chose dans les deux cas :

### Première fois (clone + setup)

```bash
ssh root@46.224.193.109
git clone <repo> /opt/apps/nigerConnect
cd /opt/apps/nigerConnect

# Copier .env.prod (jamais via git)
# Depuis ta machine locale :
scp .env.prod root@46.224.193.109:/opt/apps/nigerConnect/.env.prod

./scripts/deploy-vps.sh
```

Le script va :
- générer le keypair JWT RS256 dans `secrets/`
- générer `DATA_ENCRYPTION_KEY` si encore à `__CHANGE_ME__` (ici déjà fait)
- builder les images Docker (~5 min première fois)
- démarrer Postgres/Redis/MinIO + créer les buckets MinIO
- appliquer les migrations Prisma
- démarrer api + web

### Mise à jour ultérieure (après modif code)

```bash
# Sur le VPS, après git pull
cd /opt/apps/nigerConnect
./scripts/deploy-vps.sh --pull
```

`--pull` fait : `git pull` + rebuild images + apply new migrations + restart api+web. Les keys et passwords sont conservés.

### Mise à jour rapide sans rebuild (après .env change)

```bash
./scripts/deploy-vps.sh --no-build
```

### Vérifs

```bash
curl -f https://api-nigerconnect.sahabiguide.com/health
# → {"status":"ok",...}

curl -fI https://nigerconnect.sahabiguide.com/
# → HTTP/2 200
```

---

## Étape 7 — Vercel (web) — optionnel

Si tu déploies déjà le web via Docker sur le VPS (étape 6), Vercel n'est **pas nécessaire**. À ne faire que si tu veux la latence Edge globale Vercel.

Sinon, voir `docs/DEPLOYMENT-WEB.md`.

---

## Étape 8 — Universal Links / App Links

Une fois la web prod up :

1. `apps/web/public/.well-known/apple-app-site-association` → remplacer `__APPLE_TEAM_ID__` par le Team ID Apple (**à faire quand tu activeras Apple, sinon ignorer pour le MVP**).
2. `apps/web/public/.well-known/assetlinks.json` → remplacer `__SHA256_FROM_EAS_CREDENTIALS__` par l'empreinte du keystore Android :
   ```bash
   cd apps/mobile
   eas credentials -p android
   # → Keystore → View → SHA-256 fingerprint
   ```
3. Re-deploy le web.
4. Vérifier :
   ```bash
   curl https://nigerconnect.sahabiguide.com/.well-known/assetlinks.json | jq .
   ```

---

## Étape 9 — Mobile : assets stores + eas.json

### Assets à régénérer (les actuels sont des placeholders ~10 KB)

Voir `apps/mobile/assets/README.md` :
- `icon.png` 1024×1024 sans alpha
- `adaptive-icon.png` 1024×1024 (logo dans cercle 66 %)
- `splash.png` 1284×2778 fond `#FDFBF7`
- `notification-icon.png` 96×96 blanc/transparent

### `apps/mobile/eas.json` — section `submit.production.android`

Remplacer la section iOS si tu skippes Apple :

```json
"submit": {
  "production": {
    "android": {
      "serviceAccountKeyPath": "./play-service-account.json",
      "track": "internal"
    }
  }
}
```

Le `play-service-account.json` se récupère via Google Play Console → Setup → API access → Create service account (rôle Release Manager).

### Build prod Android

```bash
cd apps/mobile
eas login
eas build --profile production --platform android
```

Le 1er build Android demande de générer un keystore (laisser EAS le gérer).

**Récupérer SHA-1 + SHA-256** :
```bash
eas credentials -p android
```
- SHA-1 → coller dans le client OAuth Android (étape 3)
- SHA-256 → coller dans `assetlinks.json` (étape 8)

Puis re-builder une dernière fois pour que l'app embarque le bon `GOOGLE_CLIENT_ID_ANDROID`.

---

## Étape 10 — Soumission Google Play

```bash
eas submit --profile production --platform android
```

Google Play Console : remplir métadonnées (description FR, screenshots min 2, content rating, data safety, privacy policy URL = `https://nigerconnect.sahabiguide.com/legal/privacy`).

Premier upload sur le track `internal` → tester avec quelques comptes → promouvoir vers `production`.

---

## Récapitulatif des secrets à coller

| Étape | Variable | Où | Source |
|---|---|---|---|
| 1 | `SENTRY_DSN` | `.env.prod` | Sentry projet API |
| 1 | `extra.sentryDsn` | `apps/mobile/app.json` | Sentry projet mobile |
| 2 | `FCM_SERVICE_ACCOUNT_JSON` | `.env.prod` | Firebase service account JSON (base64) |
| 2 | `google-services.json` | `apps/mobile/` | Firebase Android app |
| 2 | `GoogleService-Info.plist` | `apps/mobile/` | Firebase iOS app (plus tard) |
| 3 | `GOOGLE_CLIENT_ID_WEB / ANDROID / IOS` | `.env.prod` + `app.json` | Google Cloud Console (3 clients) |
| 4 | `RESEND_API_KEY` | `.env.prod` | Resend |
| 8 | `__SHA256_FROM_EAS_CREDENTIALS__` | `assetlinks.json` | `eas credentials -p android` après 1er build |

---

## Ordre conseillé d'exécution

1. ☐ Sentry (5 min) → 3 DSN
2. ☐ Resend (10 min, dépend de la propagation DNS) → API key
3. ☐ Firebase + FCM (15 min) → google-services.json + base64 JSON
4. ☐ DNS Cloudflare (5 min, propagation 1-5 min)
5. ☐ Coller secrets dans `.env.prod`
6. ☐ `scp .env.prod` + `./scripts/deploy-vps.sh` sur le VPS → API + web up
7. ☐ Tester signup + email de vérif (test E2E réel)
8. ☐ Google OAuth Web client → tester signup Google web
9. ☐ Régénérer les 4 assets mobile
10. ☐ `eas build --profile production --platform android` (1er build, génère keystore)
11. ☐ `eas credentials -p android` → SHA-1 + SHA-256
12. ☐ Créer Google OAuth Android client avec SHA-1
13. ☐ Mettre à jour `assetlinks.json` avec SHA-256, re-déployer web
14. ☐ Mettre à jour `app.json` `googleClientIdAndroid`, re-build Android
15. ☐ `eas submit --platform android` → Google Play internal track

**Apple/iOS** : à faire dans un 2e temps quand tu prends l'abonnement Apple Developer.
