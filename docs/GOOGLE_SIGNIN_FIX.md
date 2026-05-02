# Google Sign-In ne marche pas — diagnostic & fix

**Daté du** : 2026-05-01
**Environnement** : prod `api-nigerconnect.sahabiguide.com`

---

## TL;DR

Deux bugs distincts ont été identifiés ; le second nécessite **1 commande SSH** sur le VPS.

| # | Symptôme | Cause | Action |
|---|---|---|---|
| 1 | Login email "ne marche pas" | `apps/mobile/.env` pointe sur la prod ET le compte n'existe peut-être pas en prod (créé en dev) | Tester avec un compte créé sur la prod, ou modifier `apps/mobile/.env` pour pointer en local |
| 2 | Google Sign-In `Unauthorized` | Sur la prod, `GOOGLE_CLIENT_ID_WEB` est vide → l'API rejette tous les tokens avec `Google sign-in is not configured on this server` | Ajouter le client ID dans `.env.prod` du VPS et redémarrer l'API |

Tests effectués depuis ce poste contre `https://api-nigerconnect.sahabiguide.com` :

```
POST /api/auth/register   → 201   ✅ création compte OK
POST /api/auth/login      → 200   ✅ login OK
POST /api/auth/google     → 401   ❌ "Google sign-in is not configured on this server"
```

Donc **le backend prod marche pour email/password**, mais Google est désactivé côté serveur faute de client ID.

---

## Bug #1 — Login email "ne marche pas"

### Pourquoi

Le fichier `apps/mobile/.env` (en dev local) contient :

```
EXPO_PUBLIC_API_URL=https://api-nigerconnect.sahabiguide.com
EXPO_PUBLIC_SOCKET_URL=https://api-nigerconnect.sahabiguide.com
```

Donc même quand tu lances `expo start` en dev sur ton PC, l'app mobile tape **directement la prod**. Conséquence :

- Si tu testes avec un compte créé sur l'API locale (`localhost:3000`) → le compte n'existe pas en prod → 401 "Invalid credentials".
- Si la prod est down ou injoignable depuis ton réseau → erreur réseau.
- Pour iOS Simulator : `localhost` du PC marche → ne dépend pas de l'IP LAN.
- Pour Android emulator : même `EXPO_PUBLIC_API_URL=http://localhost:3000` ne marcherait pas — il faut `http://10.0.2.2:3000`.
- Pour device physique : il faut l'IP LAN du PC (ex `http://192.168.0.100:3000`).

### Fix immédiat (en dev)

**Option A — utiliser ton API locale** (recommandé pour dev) :

```bash
# Dans apps/mobile/.env, remplacer par :
EXPO_PUBLIC_API_URL=http://192.168.0.100:3000
EXPO_PUBLIC_SOCKET_URL=http://192.168.0.100:3000
```

(remplace `192.168.0.100` par `ipconfig` → ta carte Ethernet/Wi-Fi).

Puis assure-toi que ton API locale tourne :
```bash
cd C:/Users/ramzi/Desktop/devs/nigerConnect
docker compose up -d                                   # Postgres + Redis + MinIO
pnpm --filter @nigerconnect/api start                  # API sur :3000
```

**Option B — créer un compte directement sur la prod** :

```bash
curl -k -X POST https://api-nigerconnect.sahabiguide.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"toi@example.com","password":"ToiTest2026!","firstName":"Toi","lastName":"Test"}'
```

Puis tente le login dans l'app avec ces credentials.

### Diagnostic en live

Le code `apps/mobile/app/(auth)/welcome.tsx` affiche maintenant en dev une bannière (verte si OK, rouge si KO) avec :
- L'URL résolue (`BASE_URL`)
- La latence
- L'état DB / Redis

Si tu vois rouge avec un timeout → l'app n'arrive pas à joindre l'URL. Si tu vois "HTTP 503 redis: down" → un service backend est en panne.

Logs supplémentaires : ouvre la console Expo (`expo start` → `j` pour ouvrir le debugger). Au boot, tu verras `[api] BASE_URL = …` qui confirme l'URL utilisée.

---

## Bug #2 — Google Sign-In répond 401 "not configured"

### Pourquoi

`apps/api/src/auth/google-oauth.service.ts` lit ces variables :

```ts
this.audiences = [
  config.get('GOOGLE_CLIENT_ID'),
  config.get('GOOGLE_CLIENT_ID_WEB'),
  config.get('GOOGLE_CLIENT_ID_ANDROID'),
  config.get('GOOGLE_CLIENT_ID_IOS'),
].filter(Boolean);

if (this.audiences.length === 0) throw new UnauthorizedException(
  'Google sign-in is not configured on this server',
);
```

Sur la prod, `.env.prod` contient :
```
GOOGLE_CLIENT_ID_WEB=
GOOGLE_CLIENT_ID_ANDROID=
GOOGLE_CLIENT_ID_IOS=
```

→ `audiences = []` → toute requête `/auth/google` est rejetée 401.

Côté mobile, `apps/mobile/app.json` a la valeur correcte :
```
"googleClientIdWeb": "682162626945-mghtoue8lhutmbhbnncommncjgk0ci73.apps.googleusercontent.com"
```

Mais cette valeur n'est **pas connue du serveur** — c'est elle qui doit être collée dans `.env.prod` côté VPS.

### Fix — 3 commandes SSH sur le VPS

```bash
ssh root@46.224.193.109

cd /opt/apps/nigerConnect

# 1. Patcher .env.prod (remplace par le vrai client ID si différent)
sed -i 's|^GOOGLE_CLIENT_ID_WEB=.*$|GOOGLE_CLIENT_ID_WEB=682162626945-mghtoue8lhutmbhbnncommncjgk0ci73.apps.googleusercontent.com|' .env.prod

# 2. Vérifier
grep '^GOOGLE_CLIENT_ID_WEB=' .env.prod

# 3. Redémarrer l'API pour prendre en compte
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate api
docker logs --tail 20 nigerconnect-api | grep -i google
# Tu dois voir: "Google sign-in ready (1 client IDs trusted)"
```

### Vérifier que le fix marche

Depuis ton PC (sans SSH sur le VPS) :

```bash
curl -k -X POST https://api-nigerconnect.sahabiguide.com/api/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken":"fake.token.here"}'

# AVANT le fix : "Google sign-in is not configured on this server"
# APRÈS le fix : "Invalid Google ID token"  ← preuve que le client ID est lu
```

Le passage de `not configured` à `Invalid Google ID token` est le signal vert — l'API essaie maintenant de vérifier le token contre Google, c'est juste que `fake.token.here` n'est évidemment pas un vrai.

### Pour tester depuis l'app mobile

1. Lance l'app mobile (`expo start`).
2. Sur l'écran de login, touche **Continuer avec Google**.
3. Le navigateur s'ouvre, tu choisis ton compte Google.
4. Tu reviens dans l'app → tu es connecté.

Si le redirect Google échoue avec "redirect_uri_mismatch" :
- Va dans https://console.cloud.google.com/apis/credentials
- Édite le **Web client** (`682162626945-…`)
- Ajoute aux **Authorized redirect URIs** :
  - `https://auth.expo.io/@sidi300/nigerconnect` (pour Expo Go / proxy)
  - `nigerconnect://` (pour le scheme custom de l'app)
- Sauvegarde, attends 2 min que ça propage.

### Bonus — pour Android natif (build EAS production)

Le `app.json:extra.googleClientIdAndroid` est encore vide. Pour le natif Android (pas Expo Go), il faut un client OAuth de type Android :

1. https://console.cloud.google.com/apis/credentials → CREATE CREDENTIALS → OAuth client ID
2. Application type : **Android**
3. Package name : `com.nigerconnect.app`
4. SHA-1 : récupéré via `eas credentials --platform android` puis collé
5. Le client ID retourné → `app.json:extra.googleClientIdAndroid`
6. Le **MÊME** client ID → coller aussi dans `.env.prod` côté VPS sous `GOOGLE_CLIENT_ID_ANDROID=…` puis redémarrer l'API
7. Rebuild EAS : `eas build -p android --profile production`

Tant que ce client ID Android n'est pas créé, le **build EAS production Android** ne pourra pas faire Google Sign-In nativement (il tombera sur le proxy auth.expo.io qui marche aussi mais avec un détour visible).

---

## Récap des actions concrètes

```
[ ] 1. Sur le VPS : éditer .env.prod et coller GOOGLE_CLIENT_ID_WEB
[ ] 2. Sur le VPS : docker compose ... up -d --force-recreate api
[ ] 3. Vérifier : curl /api/auth/google avec fake.token → doit dire "Invalid Google ID token"
[ ] 4. Dans Google Cloud Console : ajouter https://auth.expo.io/@sidi300/nigerconnect aux redirect URIs
[ ] 5. Tester depuis le mobile en dev (probe banner doit être verte)
[ ] 6. (Plus tard) Créer le client OAuth Android + remplir GOOGLE_CLIENT_ID_ANDROID des deux côtés
```

Une fois (1) à (4) faits, Google sign-in marche depuis Expo Go et depuis n'importe quelle preview EAS qui utilise le webClientId via le proxy Expo.
