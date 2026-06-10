# DEPLOY PLAYBOOK — pour Claude

> **But de ce fichier.** Tu (Claude) es dans un projet mobile/back à déployer. Ce document te dit **sur quels comptes** déployer (Apple, Expo/EAS, Play, VPS) et **comment** (commandes exactes, conventions, pièges). Les comptes ci-dessous sont ceux du propriétaire — réutilise-les pour ses nouvelles apps. Demande confirmation avant toute action **sortante** (build, submit store, deploy prod). Ne committe jamais de secret.

---

## 0. Environnement machine (Windows)

- Shell par défaut : PowerShell. Bash dispo aussi.
- **Norton MITM le TLS** → AVANT tout `npm`/`eas`/`node` qui sort sur le réseau, exporter le CA :
  - PowerShell : `$env:NODE_EXTRA_CA_CERTS="C:\Users\ramzi\.certs\norton-root.pem"`
  - bash : `export NODE_EXTRA_CA_CERTS="/c/Users/ramzi/.certs/norton-root.pem"`
  - Sinon : erreurs `SELF_SIGNED_CERT_IN_CHAIN` / `UNABLE_TO_GET_ISSUER_CERT`.

---

## 1. Comptes à utiliser (partagés entre apps du proprio)

### Apple (per-compte, réutilisable)
- **Team ID** : `4SRJRX4N45` (Ramzi SIDI IBRAHIM — Individual)
- **Apple ID (submit / App Store Connect)** : `rsidiibrahim@gmail.com`
- **ASC API Key** : déjà uploadée côté EAS, Key ID `D7QVR3G93J` (« [Expo] EAS Submit »). Réutilisable pour toute nouvelle app du même compte → submit non-interactif OK.
- Certs/Provisioning : **laisser EAS gérer** (`eas credentials`).

### Expo / EAS (per-compte)
- **Compte Expo** : `sidi30` (login historique : `autressir@gmail.com`).
- `eas whoami` doit renvoyer `sidi30`. Sinon `eas login`.

### Google Play (per-compte)
- Service account JSON Play Console → fichier `play-service-account.json` à la racine du dossier mobile. Track de submit par défaut : `internal`.

### VPS / backend (per-infra)
- **IP** : `46.224.193.109`, accès `ssh -o BatchMode=yes root@46.224.193.109`.
- Stack : Docker Compose derrière **Traefik** (TLS auto). Postgres/PostGIS + Redis + MinIO en conteneurs.
- Apps sous `/opt/apps/<NomApp>/`. Script de deploy : `scripts/deploy-vps.sh` (fait `prisma migrate deploy` + recreate api/web).
- **API non publiée sur l'hôte** (uniquement via Traefik). Pour tester en interne :
  `ssh root@46.224.193.109 'docker exec <app>-api wget -qO- http://localhost:3000/health'`
- Prefix global API = `/api` (sauf `/health`).

---

## 2. À DÉFINIR pour CHAQUE nouvelle app (per-app — change ça)

Dans `app.json` (Expo) :
- `name`, `slug`, `scheme`
- `ios.bundleIdentifier`, `android.package`  (ex. `com.<proprio>.<app>`)
- `owner` = `sidi30`
- `extra.eas.projectId`  → généré par `eas init`
- `updates.url` = `https://u.expo.dev/<projectId>`
- `runtimeVersion.policy` = `"appVersion"` (convention ici, voir §5)
- `ios.associatedDomains`, et les Google OAuth client IDs si Google Sign-In (per-app, créés dans Google Cloud Console)

Dans `eas.json` :
- `submit.production.ios` → `appleId: rsidiibrahim@gmail.com`, `appleTeamId: 4SRJRX4N45`, `ascAppId: <ID de l'app dans App Store Connect>`
- `submit.production.android.serviceAccountKeyPath` → `./play-service-account.json`, `track: internal`
- `build.*.env` → `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_SOCKET_URL` (l'API de CETTE app)

Fichiers à fournir (per-app) : `google-services.json` (Android), ASC app créée dans App Store Connect (pour obtenir `ascAppId`).

Profils `eas.json` attendus : `preview` (interne/OTA, Android APK), `production` (store, `autoIncrement: true`, `appVersionSource: remote`).

---

## 3. Bootstrap d'une nouvelle app (séquence)

```bash
# CA Norton exporté d'abord (cf. §0)
npm i -g eas-cli

# Bon compte Expo
npx eas-cli whoami            # doit = sidi30, sinon: eas login

# Renseigner owner+slug dans app.json PUIS :
npx eas-cli init              # crée/associe extra.eas.projectId

# Credentials iOS (EAS gère cert + provisioning)
npx eas-cli credentials -p ios
#   - générer Distribution Certificate + Provisioning Profile
#   - vérifier que l'ASC API Key (D7QVR3G93J) est bien rattachée (sinon l'ajouter)

# Credentials Android (keystore géré par EAS)
npx eas-cli credentials -p android
#   placer play-service-account.json à la racine mobile
```

---

## 4. Builds & distribution

```bash
# Test interne rapide (APK Android + ad-hoc iOS) — canal preview
npx eas-cli build --profile preview --platform all --non-interactive --no-wait

# TestFlight (App Store distribution + envoi auto) — canal production
npx eas-cli build --platform ios --profile production --auto-submit --non-interactive --no-wait
#   puis App Store Connect : "Processing" → apparaît dans TestFlight (~5-15 min)
#   1er build d'une app : répondre à l'Export Compliance (chiffrement standard → "Non")

# Google Play (track internal)
npx eas-cli build --platform android --profile production --auto-submit --non-interactive --no-wait
```

> `--no-wait` : le build tourne sur le cloud EAS. Tu ne seras pas notifié de la fin par le harness (externe) → suivre l'URL renvoyée, ou re-checker plus tard. Ne pas poller en boucle.

---

## 5. OTA vs rebuild (règle critique)

- `runtimeVersion.policy = "appVersion"` ⇒ **runtimeVersion = `app.json version`**.
- **OTA** (`eas update`) ne touche QUE les builds existants au **même runtimeVersion**, et seulement du **JS/assets** :
  ```bash
  npx eas-cli update --channel preview --platform all -m "message"
  ```
- **Module NATIF ajouté/changé** (ex. `expo-media-library`, `expo-location`…) ⇒ **rebuild obligatoire**, l'OTA ne suffit pas (sinon crash natif).
- **Gros changement** ⇒ bump `app.json` `version` (ex. 1.0.1 → 1.1.0). `appVersionSource: "remote"` ⇒ EAS gère `buildNumber`/`versionCode` (les valeurs app.json sont ignorées) ; seul `version` (= runtimeVersion) compte.

---

## 6. Backend / VPS deploy

```bash
# Déploie le DERNIER COMMIT (git archive HEAD), pas le working tree.
git archive HEAD | ssh -o BatchMode=yes root@46.224.193.109 \
  'cd /opt/apps/<NomApp> && tar xf - \
   && find . -name "*.sh" -exec sed -i "s/\r$//" {} + \
   && chmod +x scripts/*.sh \
   && ./scripts/deploy-vps.sh'

# Vérifs (API joignable seulement en interne)
ssh root@46.224.193.109 'docker exec <app>-api wget -qO- http://localhost:3000/health'
ssh root@46.224.193.109 'docker ps --format "{{.Names}} {{.Status}}"'
```
Notes :
- Le script applique les migrations Prisma. En local, `prisma generate` peut échouer en EPERM (dll lock) → `npx prisma generate --no-engine` régénère juste les types.
- CRLF : toujours `sed -i 's/\r$//'` les `.sh` après extraction (fichiers édités sous Windows).

---

## 7. Sécurité avant deploy (recommandé)

- Agent **gwani-pentest** dispo (`~/.claude/agents/gwani-pentest.md`) : audit OWASP/SAST/DAST du diff poussé, corrige + teste, verdict `BLOCK_DEPLOY`/`OK_TO_DEPLOY`.
- Hook `pre-push` possible (lance l'agent en read-only, bloque si critical/high ; bypass `SKIP_PENTEST=1 git push`).
- Vérifier qu'aucun secret n'est tracké :
  ```bash
  git ls-files | grep -E "\.p8$|\.pem$|\.keystore$|service-account.*\.json$|google-services\.json$|\.env"
  # doit ne RIEN renvoyer
  ```

---

## 8. SECRETS — où ils vivent, ne JAMAIS committer ni afficher

- ASC API key `.p8` + Issuer ID, certs iOS, keystore Android → **gérés par EAS** (ne pas stocker en repo).
- `play-service-account.json`, `google-services.json` → racine mobile, **gitignored**.
- VPS : clé SSH root, `/opt/apps/<app>/.env.prod`, clés JWT `*.pem`, `acme*.json` Traefik → **sur le serveur uniquement**.
- CA Norton : local machine, pas un secret partagé.

---

## 9. Récap valeurs réutilisables (copier-coller)

```
Apple Team ID      : 4SRJRX4N45
Apple ID (submit)  : rsidiibrahim@gmail.com
ASC API Key ID     : D7QVR3G93J   (EAS-managed, réutilisable)
Expo account       : sidi30
VPS                 : root@46.224.193.109   (/opt/apps/<App>, scripts/deploy-vps.sh)
Norton CA          : C:\Users\ramzi\.certs\norton-root.pem
Convention         : runtimeVersion=appVersion ; natif=rebuild ; JS=OTA ; deploy=git archive HEAD
```
Per-app à créer : ASC app (→ ascAppId), bundleId/package, Expo projectId (`eas init`), OAuth client IDs, google-services.json.
