# OAuth Setup — Google & Apple Sign-In (NigerConnect)

Checklist complète pour activer l'authentification Google et Apple en production.

---

## Vue d'ensemble

| Flux | Token produit par | Route API | Clé vérifiée côté serveur |
|------|------------------|-----------|--------------------------|
| Google (iOS natif) | expo-auth-session / Google SDK | `POST /api/auth/google` | `GOOGLE_CLIENT_ID_IOS` |
| Google (Android natif) | expo-auth-session / Google SDK | `POST /api/auth/google` | `GOOGLE_CLIENT_ID_ANDROID` |
| Google (Web / Expo Go) | auth.expo.io proxy | `POST /api/auth/google` | `GOOGLE_CLIENT_ID_WEB` ou `GOOGLE_CLIENT_ID` |
| Apple (iOS natif) | `expo-apple-authentication` | `POST /api/auth/apple` | `APPLE_CLIENT_ID` |
| Apple (Web) | Sign In with Apple JS SDK | `POST /api/auth/apple` | `APPLE_CLIENT_ID_WEB` |

---

## 1. Google Cloud Console

### 1.1 Créer le projet / activer l'API

1. Aller sur [https://console.cloud.google.com](https://console.cloud.google.com).
2. Sélectionner ou créer le projet **NigerConnect**.
3. Menu **APIs & Services > Library** → activer **"Google Identity"** (et optionnellement **"People API"** si vous avez besoin des profils).

### 1.2 Créer les OAuth 2.0 Client IDs

Aller dans **APIs & Services > Credentials > Create Credentials > OAuth client ID**.

#### Client Web (pour Expo Go + web)

| Champ | Valeur |
|-------|--------|
| Application type | **Web application** |
| Authorised redirect URIs | `https://auth.expo.io/@sidi30/nigerconnect` |
| | `https://nigerconnect.app/auth/callback` (si web app) |

Copier le **Client ID** → variable `GOOGLE_CLIENT_ID_WEB` dans `.env` de l'API.

#### Client iOS

| Champ | Valeur |
|-------|--------|
| Application type | **iOS** |
| Bundle ID | `com.nigerconnect.app` |

Copier le **Client ID** → variable `GOOGLE_CLIENT_ID_IOS` dans `.env` de l'API.  
Ce même Client ID va aussi dans `app.json` > `extra.googleClientIdIos`.

#### Client Android

| Champ | Valeur |
|-------|--------|
| Application type | **Android** |
| Package name | `com.nigerconnect.app` |
| SHA-1 fingerprint | Obtenir via `eas credentials` ou `keytool -list -v -keystore <keystore>` |

Copier le **Client ID** → variable `GOOGLE_CLIENT_ID_ANDROID` dans `.env` de l'API.

### 1.3 Matrice des clés Google

| Variable `.env` API | Qui consomme | Pourquoi |
|--------------------|-------------|----------|
| `GOOGLE_CLIENT_ID` | API (fallback legacy) | Audiences acceptées par `google-auth-library.verifyIdToken()` |
| `GOOGLE_CLIENT_ID_WEB` | API | idem — token émis par le client web / Expo Go |
| `GOOGLE_CLIENT_ID_ANDROID` | API | idem — token émis par l'app Android native |
| `GOOGLE_CLIENT_ID_IOS` | API | idem — token émis par l'app iOS native |
| `extra.googleClientIdWeb` (app.json) | Mobile (Expo) | Paramètre `clientId` passé à `expo-auth-session` sur web |
| `extra.googleClientIdAndroid` (app.json) | Mobile (Expo) | Paramètre `clientId` passé à `expo-auth-session` sur Android |
| `extra.googleClientIdIos` (app.json) | Mobile (Expo) | Paramètre `clientId` passé à `expo-auth-session` sur iOS |

**Règle d'audience critique :** le `aud` du JWT Google DOIT correspondre à l'un des Client IDs configurés dans `GOOGLE_CLIENT_ID*`. Si le mobile utilise le Client ID Android mais que seul `GOOGLE_CLIENT_ID_IOS` est renseigné côté API, la vérification rejettera le token avec 401.

### 1.4 OAuth Consent Screen

Dans **APIs & Services > OAuth consent screen** :

- User type: **External** (ou Internal si G Workspace).
- App name: `NigerConnect`
- Authorized domains: `sahabiguide.com`
- Scopes: `openid`, `email`, `profile`
- Publish l'app pour sortir du mode "Test" (sinon seuls les testers configurés peuvent se connecter).

---

## 2. Apple Developer Portal

### 2.1 App ID — activer "Sign In with Apple"

1. Aller sur [https://developer.apple.com/account/resources/identifiers/list](https://developer.apple.com/account/resources/identifiers/list).
2. Sélectionner l'App ID `com.nigerconnect.app`.
3. Dans **Capabilities**, cocher **Sign In with Apple** → **Edit** → choisir **Enable as a primary App ID**.
4. Enregistrer.

### 2.2 Services ID (pour le flux web uniquement)

1. Cliquer **+ (Register a new identifier)** → **Services IDs**.
2. Description: `NigerConnect Web`
3. Identifier: `com.nigerconnect.app.web` (doit être différent du bundle ID).
4. Après création, cocher **Sign In with Apple** → **Configure**.
   - Primary App ID: `com.nigerconnect.app`
   - Domains: `nigerconnect.app`
   - Return URLs: `https://nigerconnect.app/auth/apple/callback`
5. Copier cet identifier → variable `APPLE_CLIENT_ID_WEB` dans `.env` (commentée par défaut).

### 2.3 Key (pour la révocation de token / passport-apple)

Nécessaire uniquement si vous utilisez `passport-apple` ou l'API de révocation Apple côté serveur.

1. **Certificates, Identifiers & Profiles > Keys > +**.
2. Cocher **Sign In with Apple** → **Configure** → Primary App ID: `com.nigerconnect.app`.
3. Télécharger la clé `.p8` — **une seule fois**, la stocker en sécurité.
4. Renseigner `.env` :
   - `APPLE_TEAM_ID` = votre Team ID (10 caractères, visible en haut à droite du portal)
   - `APPLE_KEY_ID` = l'ID de la clé (10 caractères)
   - `APPLE_PRIVATE_KEY` = contenu du fichier `.p8` (sur une ligne, `\n` littéraux)

### 2.4 Matrice des clés Apple

| Variable `.env` API | Valeur | Usage |
|--------------------|--------|-------|
| `APPLE_CLIENT_ID` | `com.nigerconnect.app` | Audience attendue dans le JWT identity token (natif iOS) |
| `APPLE_CLIENT_ID_WEB` | `com.nigerconnect.app.web` | Audience pour le flux web (optionnel) |
| `APPLE_TEAM_ID` | `XXXXXXXXXX` | Révocation token / passport-apple |
| `APPLE_KEY_ID` | `XXXXXXXXXX` | Révocation token / passport-apple |
| `APPLE_PRIVATE_KEY` | Contenu `.p8` | Révocation token / passport-apple |

**Règle d'audience critique :** `identityToken.aud === APPLE_CLIENT_ID`. Sur iOS natif, Apple émet toujours le bundle ID (`com.nigerconnect.app`) comme audience. Ne pas confondre avec le Services ID web.

---

## 3. EAS / Xcode — capability "Sign In with Apple"

### 3.1 app.json (déjà configuré)

`app.json` contient déjà :
```json
"ios": {
  "usesAppleSignIn": true
}
```
et le plugin `"expo-apple-authentication"`.

EAS injecte automatiquement la capability `com.apple.developer.applesignin` dans le profil de provisioning lors du build si `usesAppleSignIn: true` est présent.

### 3.2 Build EAS

```bash
# Preview (device physique ad-hoc)
eas build --profile preview --platform ios

# Production (App Store)
eas build --profile production --platform ios
```

Le profil de provisioning doit avoir `com.apple.developer.applesignin = ["Default"]` dans l'entitlement. EAS le gère automatiquement si le compte EAS est lié au bon Apple Developer account.

### 3.3 Xcode (si build local)

1. Ouvrir le workspace `.xcworkspace` généré par `expo prebuild`.
2. Aller dans **Target > Signing & Capabilities > + Capability > Sign In with Apple**.
3. S'assurer que le provisioning profile inclut la capability.

---

## 4. Variables d'environnement — récapitulatif complet

### API (apps/api/.env)

```env
# Google — au moins 1 des 4 doit être renseigné
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_ID_WEB=682162626945-mghtoue8lhutmbhbnncommncjgk0ci73.apps.googleusercontent.com
GOOGLE_CLIENT_ID_ANDROID=682162626945-opkbbi8ikl552tb7sk52fk7a80svfkmk.apps.googleusercontent.com
GOOGLE_CLIENT_ID_IOS=          # à créer dans Google Cloud Console

# Apple
APPLE_CLIENT_ID=com.nigerconnect.app
# APPLE_CLIENT_ID_WEB=com.nigerconnect.app.web  # uniquement pour flux web
# APPLE_TEAM_ID=
# APPLE_KEY_ID=
# APPLE_PRIVATE_KEY=
```

### Mobile (apps/mobile/app.json > extra)

```json
"extra": {
  "googleClientIdWeb": "<WEB_CLIENT_ID>",
  "googleClientIdAndroid": "<ANDROID_CLIENT_ID>",
  "googleClientIdIos": "<IOS_CLIENT_ID>",
  "appleSignInEnabled": true
}
```

---

## 5. Tester sans production

### 5.1 Google — vérifier les redirect URIs (Expo Go)

1. Lancer `npx expo start` et ouvrir dans Expo Go.
2. Observer les logs : Expo affiche l'URL de redirect utilisée (`https://auth.expo.io/@sidi30/nigerconnect`).
3. Vérifier que cette URL est bien listée dans **Authorised redirect URIs** du Client ID Web.
4. Tenter la connexion Google : si l'écran Google s'ouvre et revient sans erreur, le Client ID est correct.

### 5.2 Apple — simulateur iOS

Le simulateur iOS (Xcode 13+) supporte "Sign In with Apple" avec un Apple ID de test configuré dans **Settings > Sign In with Apple**. Étapes :

1. `npx expo run:ios` (build local, pas Expo Go — nécessite la capability).
2. Dans le simulateur : **Settings > [votre Apple ID]** → activer.
3. Tenter la connexion Apple dans l'app — un sheet Apple s'affiche.
4. Le `identityToken` généré est valide et peut être vérifié contre Apple JWKS.

### 5.3 Vérifier le rejet côté API (sans device)

Utiliser le script `scripts/test-oauth-endpoints.mjs` (voir section dédiée) qui envoie des tokens invalides et vérifie les codes HTTP de rejet.

### 5.4 Logs API utiles

```bash
# Démarrer l'API en watch
cd apps/api && npm run dev

# Observer les logs d'initialisation (confirme les Client IDs chargés)
# Attendu : "Google sign-in ready (N client IDs trusted)"
# Attendu : pas de warning "APPLE_CLIENT_ID is empty"
```

---

## 6. Checklist de mise en service

- [ ] Google Cloud Console : Client ID iOS créé, SHA-1 Android configuré
- [ ] `GOOGLE_CLIENT_ID_IOS` renseigné dans `.env` API
- [ ] `extra.googleClientIdIos` renseigné dans `app.json`
- [ ] OAuth Consent Screen publié (pas en mode Test)
- [ ] Apple Developer : capability "Sign In with Apple" activée sur `com.nigerconnect.app`
- [ ] `APPLE_CLIENT_ID=com.nigerconnect.app` dans `.env` API
- [ ] Build EAS avec `usesAppleSignIn: true` dans `app.json` (déjà présent)
- [ ] Test rejet 401 token invalide : `npm run test:oauth` (voir scripts/)
- [ ] Test connexion réelle sur device physique (Google + Apple)
- [ ] Vérifier logs au démarrage : "Google sign-in ready", pas de warning Apple
