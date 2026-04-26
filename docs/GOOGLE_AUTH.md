# Google Sign-In — setup guide

NigerConnect supporte la connexion et l'inscription via Google (ID-token flow). Cet flux couvre à la fois le signup et le login : si l'email n'existe pas, un compte est créé automatiquement ; s'il existe déjà, le compte est lié au provider Google.

## Vue d'ensemble

```
Mobile (Expo)  ──► Google OAuth (expo-auth-session)  ──►  id_token
               └──► POST /api/auth/google { idToken } ──►  API
                                                            │
                             google-auth-library verify ◄───┘
                                   │
                                   ▼
                   AuthService.loginWithOAuth('google', …)
                                   │
                                   ▼
                         JWT access + refresh tokens
```

L'API accepte un `id_token` signé par Google, le vérifie (audience = client IDs configurés, signature valide, non expiré), puis crée ou met à jour l'utilisateur.

## Côté backend (API)

### 1. Créer les OAuth clients Google Cloud

Console → [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) → `Create Credentials` → `OAuth client ID`. Répète pour chaque plateforme :

| Type | Champ à renseigner | Utilisation |
|---|---|---|
| **Web application** | Authorized redirect URIs : `https://auth.expo.io/@your-expo-username/nigerconnect` | Expo Go + web |
| **Android** | Package name : `com.nigerconnect.app` · SHA-1 (cf. `keytool`) | Build Android natif |
| **iOS** | Bundle ID : `com.nigerconnect.app` | Build iOS natif |

### 2. Renseigner les env vars

Dans le `.env` de l'API :

```bash
GOOGLE_CLIENT_ID_WEB=xxx-web.apps.googleusercontent.com
GOOGLE_CLIENT_ID_ANDROID=xxx-android.apps.googleusercontent.com
GOOGLE_CLIENT_ID_IOS=xxx-ios.apps.googleusercontent.com
```

Au moins un doit être défini. L'API accepte des tokens dont l'`aud` correspond à n'importe lequel de ces client IDs. Au démarrage, tu dois voir :

```
[GoogleOAuthService] Google sign-in ready (3 client IDs trusted)
```

Si rien n'est configuré : `Google sign-in disabled — set at least one of …`. L'endpoint `POST /auth/google` retournera alors `401 Google sign-in is not configured on this server`.

### 3. Endpoint

```
POST /api/auth/google
Content-Type: application/json

{ "idToken": "eyJhbGciOi...", "deviceName": "Pixel 8" }
```

Réponse (200) :

```json
{
  "user": { "id": "...", "email": "...", "emailVerified": true, ... },
  "tokens": { "accessToken": "...", "refreshToken": "..." }
}
```

Rate limit : 10/min, 60/h par IP.

## Côté mobile (Expo)

### 1. Renseigner les client IDs

**Option A — via app.json** (recommandé en build EAS) :

```json
"extra": {
  "googleClientIdWeb":     "xxx-web.apps.googleusercontent.com",
  "googleClientIdAndroid": "xxx-android.apps.googleusercontent.com",
  "googleClientIdIos":     "xxx-ios.apps.googleusercontent.com"
}
```

**Option B — via variables d'env** (`.env` à la racine du repo mobile, lu par Expo) :

```bash
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=xxx-web.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID=xxx-android.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=xxx-ios.apps.googleusercontent.com
```

### 2. Composants déjà wirés

- `apps/mobile/services/googleAuth.ts` — hook `useGoogleAuth()`
- `apps/mobile/components/ui/GoogleButton.tsx` — bouton plug-and-play
- Intégré dans `app/(auth)/login.tsx` et `app/(auth)/register.tsx` (étape 1)

Si aucun client ID n'est configuré, `GoogleButton` ne s'affiche pas — l'app reste fonctionnelle avec le login email/password.

### 3. Tester en dev

- **Expo Go** : utilise le client ID Web. Le flow passe par `auth.expo.io` (proxy Expo).
- **Build natif (EAS)** : utilise le client ID Android/iOS correspondant au device.

## Sécurité

- Le backend vérifie **la signature** de l'`id_token` contre les clés publiques Google (rafraîchies automatiquement par `google-auth-library`).
- L'`aud` doit matcher **un des** client IDs trusted — empêche un token volé d'un autre projet d'être accepté.
- `email_verified` est copié depuis le payload Google — on considère l'email vérifié si Google l'a vérifié.
- Si l'email Google correspond à un compte password existant, le compte est **lié** au provider Google (pas de duplication). Le login password reste possible ensuite.

## Troubleshooting

| Symptôme | Cause probable |
|---|---|
| `401 Google sign-in is not configured` | Aucun `GOOGLE_CLIENT_ID_*` défini côté API |
| `401 Invalid Google ID token` | Token expiré, signature invalide, ou `aud` non trusted → vérifier que le client ID du device est bien dans les env de l'API |
| Bouton Google absent | Aucun `googleClientId*` dans `app.json#extra` ni `EXPO_PUBLIC_GOOGLE_CLIENT_ID_*` |
| `redirect_uri_mismatch` sur Expo Go | Ajouter `https://auth.expo.io/@username/slug` aux redirect URIs autorisés du client Web |
