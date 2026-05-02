# NigerConnect — Audit sécurité & Go-to-prod

**Date** : 2026-05-01
**Auditeur** : assistant + équipe
**Périmètre** : mobile (Expo SDK 54), API (NestJS 10), DB (PostgreSQL 16 + PostGIS), MinIO, infra Docker + Traefik, CI/CD GitHub Actions.

Ce document a deux parties :

1. **Audit** — findings classés par sévérité avec leur statut (corrigé / résiduel / à votre charge).
2. **Go-to-prod** — checklist exécutable, étapes ordonnées, plan de rollback et runbooks.

---

## 1. Résumé de l'audit

### Légende sévérité

- **P0 critique** : bloque la prod ou expose un risque immédiat. Doit être corrigé avant déploiement.
- **P1 haute** : risque modéré, à corriger dans la première semaine.
- **P2 moyenne** : durcissement, à planifier.
- **P3 basse** : cosmétique / dette technique.

### Findings et statut

| # | Sévérité | Domaine | Description | Statut |
|---|---|---|---|---|
| 1 | **P0** | Backend | Email reset-password pointait vers `POST /api/auth/reset-password` → clic = HTTP 405. Personne ne pouvait réinitialiser. | ✅ Fixé (mailer pointe vers `${APP_WEB_URL}/reset-password`) |
| 2 | **P0** | Backend | Lien verify-email retournait du JSON brut au navigateur. UX brisée. | ✅ Fixé (page `/verify-email` côté web + redirection 302 si l'API est appelée en GET sans `Accept: application/json`) |
| 3 | **P1** | Backend | `cors.credentials: true` alors que l'auth est Bearer-only → expose à des attaques cross-origin si jamais un cookie est posé. | ✅ Fixé (`credentials: false`, `maxAge: 600`) |
| 4 | **P1** | Backend | `LoggingInterceptor` loggait l'URL brute → tokens en query string dans les logs. | ✅ Fixé (réutilise `scrubUrl` du filtre d'erreurs) |
| 5 | **P1** | Backend | Pas de `body-limit` explicite → défaut Express 100kB seulement, mais aucune garantie. Audit DoS. | ✅ Fixé (`json({ limit: '256kb' })`) |
| 6 | **P1** | Backend | Code mort `passport-google-oauth20` + `passport-facebook` (jamais loadés depuis qu'on est passé sur la vérification d'`idToken`). Surface d'attaque inutile. | ✅ Fixé (fichiers + deps supprimés) |
| 7 | **P1** | Mobile | `googleClientIdAndroid: ""` (chaîne vide) plantait `useIdTokenAuthRequest` avec `invalid_request`. | ✅ Fixé (helper `asClientId` qui traite `""` comme undefined) |
| 8 | **P1** | Mobile | Upload S3 via `fetch().blob()` → `Content-Length` manquant, échecs intermittents. | ✅ Fixé (`expo-file-system/legacy` `uploadAsync` en BINARY_CONTENT) |
| 9 | **P1** | Mobile | Bouton 📷 du chat n'avait aucun handler. | ✅ Fixé (pick → upload → message `image` + optimistic update) |
| 10 | **P1** | Mobile | Pas de listener `message:new` local dans `chat/[id]` → message envoyé invisible jusqu'à un refetch déclenché ailleurs. | ✅ Fixé (listener local + optimistic + déduplication) |
| 11 | **P1** | Mobile | FAB du fil utilisait offset fixe → caché derrière la tab bar Android edge-to-edge. | ✅ Fixé (`useSafeAreaInsets` + tab bar height) |
| 12 | **P1** | Backend | Pas de validation env qui exige `APP_WEB_URL` en prod → mailer fallback silencieux sur `API_URL`. | ✅ Fixé (env Zod refuse de démarrer sans `APP_WEB_URL` en prod) |
| 13 | **P1** | CI | `expo-server-sdk` (ESM) cassait 6 suites Jest → `npm test` retournait 1 même avec 0 test fail. CI actuelle : faux positif. | ✅ Fixé (mock dédié + `moduleNameMapper`). 16 suites / 75 tests verts. |
| 14 | **P1** | Backend | `CORS_ORIGINS` en prod pouvait être laissé sur le défaut localhost → policy permissive cachée. | ✅ Fixé (env Zod refuse origins localhost-only en prod) |
| 15 | **P1** | Backend | SMTP partiellement configuré (`SMTP_HOST` sans `USER/PASS`) → fallback silencieux sur transport JSON, plus aucun mail en prod. | ✅ Fixé (env Zod exige les 3 ensemble) |
| 16 | **P2** | Mobile (web build) | `tokenStore.web.ts` met les tokens dans `localStorage` (XSS-vulnérable). Acceptable si le web n'est qu'une landing, à reconsidérer si on y porte la PWA. | 🟡 Documenté (à traiter Phase 2 quand le web devient interactif) |
| 17 | **P2** | Backend | Mailer fallback console si SMTP non configuré : pratique en dev, dangereux si oublié en prod. | ✅ Atténué (env validation P1 #15) |
| 18 | **P2** | Mobile | Pas d'intégration Sentry mobile (le DSN dans `app.json` extra n'est lu par personne). | 🟡 À faire (instructions doc plus bas) |
| 19 | **P2** | DB | `passwordHash` en clair (argon2id, pas un secret en soi) — OK. `mfaSecret` chiffré AES-256 ✓. Aucune autre PII chiffrée. | 🟢 OK pour MVP |
| 20 | **P2** | DB | Cascades `onDelete: Cascade` partout → un user supprimé efface ses messages aux autres. RGPD-compliant mais peut surprendre. | 🟢 Décision conservée |
| 21 | **P3** | Mobile | iOS associated-domains (`applinks:nigerconnect.sahabiguide.com`) déclaré sans fichier `apple-app-site-association` côté web encore. Universal Links inactifs. | 🟡 À faire avant submit iOS |
| 22 | **P3** | Backend | `softwareKeyboardLayoutMode: 'pan'` peut induire chevauchement statusbar sur certains form-screens Android. | 🟢 Acceptable, peut être basculé en `resize` plus tard |

### Couches déjà bien posées (avant cet audit)

- **Auth** : RS256 + rotation `kid`, refresh tokens hashés en DB, détection de réutilisation = révocation globale, Argon2id (memoryCost 19 456), brute-force lock exponentiel (5 → 15 min → 30 min → 1 h), JWT blacklist en Redis pour le logout server-side.
- **Validation** : Zod sur 100% des DTO, `strip` par défaut, `ParseUUIDPipe` sur tous les params.
- **Helmet** : CSP `default-src 'none'` (l'API ne sert pas d'HTML), HSTS actif en prod, `frameAncestors none`, `referrerPolicy no-referrer`.
- **Rate limiting** : 3 tiers (10/s, 100/min, 1000/h) globaux + tighter sur `/auth/*`, plus rate-limit Redis-backed sur `chat:send` (30/min/user).
- **Storage** : SSE-AES256 forcé via `signableHeaders` du presign — un client ne peut pas s'en exempter. Bucket privé pour les pièces d'identité, bucket public CDN-cached pour le reste.
- **Account-takeover guard** OAuth : on refuse de lier automatiquement un provider à un compte qui a déjà un mot de passe ou un autre provider.
- **Anti-enum** sur `forgot-password` : findUnique systématique, envoi fire-and-forget, toujours 204.

### Risques résiduels assumés

- **Apple Sign-in** désactivé → premier build iOS sera rejeté tant qu'on garde Google. Deux options pour la submission iOS : retirer Google sur iOS, ou activer Apple Sign-in (Apple Developer Program 99 $/an).
- **Backups Postgres** : aucun planifié dans le repo. Voir runbook §3.5 ci-dessous — à mettre en place avant ouverture publique.
- **Universal Links** iOS / App Links Android : déclarés en config mais les fichiers `.well-known` côté web ne sont peut-être pas servis avec le bon Content-Type. Voir §3.7.
- **Web tokenStore via localStorage** (P2 #16) : OK tant que le web ne fait pas d'auth. À reconsidérer si on y construit l'app interactive.

---

## 2. État technique actuel

```
Tests :    ✅ 16 suites / 75 tests verts (API)
Typecheck: ✅ API + mobile + web + shared-types
Lint :     ✅ web (mobile/api n'ont pas de step lint dans la CI)
Build :    ✅ API build OK (Dockerfile multi-stage testé en CI)
```

À faire avant tag `v1.0.0` :

- [ ] Lancer `pnpm --filter @nigerconnect/api test:e2e` localement contre une vraie DB de test.
- [ ] Lancer un build EAS preview Android et tester manuellement chat + upload + Google sign-in.
- [ ] Vérifier qu'`apple-app-site-association` est servi par le web avec `Content-Type: application/json`.

---

## 3. Go-to-prod — checklist ordonnée

### 3.1 Pré-requis externes (à faire une seule fois)

| Action | Où | Pourquoi |
|---|---|---|
| Créer le **VPS** (≥ 2 vCPU / 4 GB RAM / 40 GB SSD) avec Docker + docker-compose plugin | Hetzner / OVH / autre | Cible de déploiement |
| Créer le réseau Docker `traefik-public` + un Traefik avec resolver `letsencrypt-dns` | VPS | Le compose attend ce réseau externe |
| Créer 3 enregistrements **DNS A** Cloudflare (proxied=ON) → IP du VPS | Cloudflare | TLS Universal SSL (1 niveau de sous-domaine) |
| Créer une **org Sentry** + 3 projets (api / web / mobile) | sentry.io | Observabilité erreurs |
| Créer un compte **Resend** (ou autre SMTP), récupérer la clé API et configurer un domaine vérifié | resend.com | Envoi de mails de prod |
| Créer le projet **Firebase** + télécharger le **service account JSON** (FCM) | Firebase Console | Push notifications |
| Créer 3 **OAuth clients Google** (Web / Android / iOS) | Google Cloud Console | Sign-in avec Google |
| (iOS) Apple Developer Program + Service ID + Key `.p8` | developer.apple.com | Sign in with Apple — **uniquement si on submit iOS** |

### 3.2 Préparer le repo / les secrets

```bash
# Sur ta machine locale
git clone … && cd nigerConnect
cp .env.prod.example .env.prod

# Générer les secrets aléatoires
openssl rand -base64 24   # → POSTGRES_PASSWORD
openssl rand -base64 24   # → REDIS_PASSWORD
openssl rand -base64 24   # → MINIO_ROOT_PASSWORD
openssl rand -base64 32   # → DATA_ENCRYPTION_KEY (32 octets)

# Coller chaque sortie dans .env.prod en remplaçant __CHANGE_ME__
$EDITOR .env.prod

# Champs obligatoires en plus :
#   APP_WEB_URL=https://nigerconnect.sahabiguide.com   ← NOUVEAU, sinon l'API refuse de démarrer
#   CORS_ORIGINS=https://nigerconnect.sahabiguide.com  (jamais localhost en prod)
#   GOOGLE_CLIENT_ID_WEB=…  (doit matcher app.json:extra.googleClientIdWeb du mobile)
#   GOOGLE_CLIENT_ID_ANDROID=…  (créé dans Google Cloud Console — type Android)
#   GOOGLE_CLIENT_ID_IOS=…  (type iOS) — si submit iOS
#   RESEND_API_KEY=…  ou SMTP_HOST/USER/PASS (les trois ensemble)
#   FCM_SERVICE_ACCOUNT_JSON=$(base64 -w0 firebase-service-account.json)
#   SENTRY_DSN=…  (projet API)
```

⚠️ `.env.prod` est gitignoré ; **transférer via SSH chiffré seulement**, jamais par mail / Slack / Drive non chiffré.

### 3.3 Configurer le mobile pour la prod

Dans `apps/mobile/app.json`, vérifier que `extra` contient :

```json
"extra": {
  "googleClientIdWeb":     "<même valeur que GOOGLE_CLIENT_ID_WEB côté API>",
  "googleClientIdAndroid": "<créé en type Android, package com.nigerconnect.app + SHA-1 EAS>",
  "googleClientIdIos":     "<créé en type iOS, bundle id com.nigerconnect.app>",
  "sentryDsn":             "<DSN du projet mobile>",
  ...
}
```

Pour récupérer le SHA-1 EAS Android :

```bash
cd apps/mobile
eas credentials --platform android
# affiche l'empreinte SHA-1 du keystore EAS — à coller dans Google Cloud Console
```

### 3.4 Premier déploiement

```bash
# Sur le VPS (cf. README pour le bootstrap initial)
cd /opt/apps/nigerConnect
git clone <repo> .
scp .env.prod root@vps:/opt/apps/nigerConnect/    # depuis ta machine
./scripts/deploy-vps.sh
```

Le script :

1. génère le keypair RS256 (4096 bits) sur le 1er run dans `secrets/`,
2. génère `DATA_ENCRYPTION_KEY` si placeholder,
3. refuse de continuer si un `__CHANGE_ME__` traîne,
4. build images, démarre `postgres` → `redis` → `minio` (+ init buckets),
5. lance `prisma migrate deploy` une fois Postgres healthy,
6. démarre `api` + `web`.

Vérifier ensuite :

```bash
curl -fsS https://api-nigerconnect.sahabiguide.com/health
# → { "status": "ok", "checks": { "db": "ok", "redis": "ok" } }

curl -I https://nigerconnect.sahabiguide.com
# → 200, headers Cloudflare, HSTS

curl -I https://cdn-nigerconnect.sahabiguide.com/nigerconnect/
# → 403 attendu (bucket public, mais listing désactivé)
```

### 3.5 Backups (à faire AVANT d'ouvrir l'app au public)

Mettre en place une cron sur le VPS qui dump Postgres tous les jours et upload sur un stockage off-host (S3 ou rclone vers Backblaze).

```bash
# /etc/cron.d/nigerconnect-pg-backup
15 3 * * * root /opt/apps/nigerConnect/scripts/backup-pg.sh >> /var/log/nigerconnect-backup.log 2>&1
```

`scripts/backup-pg.sh` (à créer) :

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec -i nigerconnect-postgres pg_dump -U nigerconnect nigerconnect \
  | gzip -9 > /var/backups/nigerconnect-${TS}.sql.gz
# upload off-host avec rclone, supprimer les locaux > 7 jours
find /var/backups -name 'nigerconnect-*.sql.gz' -mtime +7 -delete
```

Tester la **restauration** au moins une fois avant ouverture publique.

### 3.6 Monitoring & alerting

| Quoi | Comment |
|---|---|
| Erreurs serveur (5xx) | Sentry alert → email / Slack si > 1 issue/min |
| API down | UptimeRobot / Better Uptime ping `/health` toutes les 60 s |
| Disk usage VPS | `node_exporter` + Prometheus si dispo, ou cron `df` qui mail si >85% |
| Postgres slow queries | `pg_stat_statements` activé + check hebdo manuel |
| Containers restarts | `docker events` ou alert Watchtower |

### 3.7 Universal Links / App Links (avant submit Apple)

Le web doit servir :

- `https://nigerconnect.sahabiguide.com/.well-known/apple-app-site-association` (sans extension, `Content-Type: application/json`)
- `https://nigerconnect.sahabiguide.com/.well-known/assetlinks.json` (Android)

Templates déjà présents dans `apps/web/public/.well-known/` selon `GO-LIVE.md`. Vérifier le `Content-Type` :

```bash
curl -I https://nigerconnect.sahabiguide.com/.well-known/apple-app-site-association
# Doit montrer Content-Type: application/json
```

### 3.8 Builds mobile

```bash
cd apps/mobile

# Preview Android (APK testable interne)
eas build -p android --profile preview

# Production (AAB Google Play + IPA Apple)
eas build -p all --profile production

# Soumission stores
eas submit -p android --latest
eas submit -p ios --latest
```

Avant chaque release : tester sur un appareil physique :

- [ ] Login email + Google + (Apple si activé)
- [ ] Création de post + photo via galerie + via caméra
- [ ] Chat : envoi texte (vérifier qu'il apparaît immédiatement) + envoi photo
- [ ] Profil : changement d'avatar
- [ ] Navigation tab bar / chevauchement statusbar
- [ ] Push notification : recevoir un message en arrière-plan
- [ ] Reset password : recevoir le mail, cliquer le lien, mettre à jour, se reconnecter

---

## 4. Plan de rollback

### 4.1 API / web (rollback rapide ~ 1 min)

```bash
ssh vps
cd /opt/apps/nigerConnect
git log --oneline -10                         # repérer le dernier commit OK
git checkout <SHA-OK>
./scripts/deploy-vps.sh --no-build            # si l'image précédente est encore en cache
# OU
./scripts/deploy-vps.sh                       # rebuild
```

Si une **migration Prisma** a été appliquée et casse la prod :

1. Restaurer le dump Postgres pré-déploiement (`/var/backups/nigerconnect-<TS>.sql.gz`).
2. Rollback Git.
3. Re-déployer.

⚠️ Prisma `migrate deploy` n'a pas de mode "down". La seule façon de revenir en arrière est la restauration du dump.

### 4.2 Mobile (rollback impossible une fois publié)

Une version d'app dans les stores ne se rollback pas. Mitigation :

- **Always-on EAS Update channel** : si le bug est dans du JS/TS uniquement, publier une OTA :

  ```bash
  cd apps/mobile
  eas update --channel production --message "Hotfix: X"
  ```

  Seules les couches JS/Reanimated bénéficient — pas les changements natifs.

- Sinon : cut une version `1.0.1`, build, submit, attendre la review.
- En attendant, basculer un feature-flag côté serveur ou rate-limiter l'endpoint impacté.

---

## 5. Runbooks (incidents fréquents)

### 5.1 « Le mail de reset password ne marche pas »

1. Vérifier `APP_WEB_URL` dans `.env.prod` → doit pointer vers le web.
2. Vérifier les logs API : `docker logs nigerconnect-api 2>&1 | grep -i 'sendmail\|smtp'`
3. Vérifier les credentials SMTP/Resend : test avec `curl` ou Resend dashboard.
4. Vérifier que `APP_WEB_URL/reset-password` répond bien (page Next.js).
5. Si le mail arrive mais que la page web 500 : vérifier `NEXT_PUBLIC_API_URL` côté web.

### 5.2 « Les uploads photo retournent 403 / SignatureDoesNotMatch »

1. Vérifier que `S3_PUBLIC_ENDPOINT` est défini dans le compose (devrait être `https://${CDN_HOST}`).
2. Vérifier que MinIO a bien créé les buckets : `docker logs nigerconnect-minio-init`.
3. Tester manuellement un presign : `curl -X POST https://api-nigerconnect.sahabiguide.com/api/profile/me/photos/presign -H "Authorization: Bearer …" -d '{"contentType":"image/jpeg","kind":"photo"}'`.
4. Vérifier que le client envoie bien `Content-Type` ET `x-amz-server-side-encryption: AES256` (signableHeaders les rend obligatoires).

### 5.3 « Le chat n'affiche pas mes messages »

(Bug originel — corrigé dans cette release.) Si récurrence :

1. Vérifier le socket : DevTools / Flipper → onglet WebSocket. Doit montrer `message:new` après chaque envoi.
2. `getChatSocket()` doit retourner un socket connecté avant l'`emit`.
3. Vérifier qu'on est bien dans la room `conv:<id>` côté serveur (logs `Chat gateway`).

### 5.4 « JWT signing keys must be rotated » (pas urgent mais à savoir)

```bash
ssh vps
cd /opt/apps/nigerConnect
# 1. Backup l'ancien
mv secrets/jwt-public.pem secrets/jwt-public.prev.pem
mv secrets/jwt-private.pem secrets/jwt-private.bak.pem
# 2. Générer un nouveau keypair
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out secrets/jwt-private.pem
openssl rsa -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chown 1001:1001 secrets/jwt-*.pem
# 3. Pendant 16 min (TTL access + marge), accepter les deux clés
# Ajouter dans docker-compose.prod.yml service api > environment:
#   JWT_PREVIOUS_PUBLIC_KEY_PATH: /app/keys/jwt-public.prev.pem
# Remonter le compose. Les tokens en cours signés avec l'ancienne clé continuent de valider.
# 4. Au bout de ~30 min, retirer JWT_PREVIOUS_PUBLIC_KEY_PATH et supprimer secrets/jwt-public.prev.pem
```

### 5.5 « Postgres saturé en disque »

1. Vérifier `df -h` sur le VPS.
2. Identifier la table : `docker exec nigerconnect-postgres psql -U nigerconnect -c "\dt+ public.*" | sort -k4 -h | tail -20`
3. Si `messages` ou `notifications` croissent vite : prévoir un **archive job** (cron) qui bascule les rows > 90 j vers du cold storage.
4. Vacuum : `docker exec nigerconnect-postgres psql -U nigerconnect -c "VACUUM ANALYZE"`.

---

## 6. Annexes

### 6.1 Variables d'env critiques (à NE jamais perdre)

- `DATA_ENCRYPTION_KEY` — sa perte rend illisibles **toutes** les colonnes chiffrées (mfaSecret, future PII). Backup hors-site, gestionnaire de secrets.
- `secrets/jwt-private.pem` — sa fuite = compromission totale auth. Sa perte = forcé déconnexion globale (pas dramatique mais visible).
- `POSTGRES_PASSWORD` / `REDIS_PASSWORD` / `MINIO_ROOT_PASSWORD` — rotables sans perte de données.

### 6.2 Commandes utiles

```bash
# Tail tous les logs
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=200

# Re-run uniquement les migrations (sans redeploy)
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps \
  --entrypoint sh api -c "node node_modules/prisma/build/index.js migrate deploy"

# Console Postgres
docker exec -it nigerconnect-postgres psql -U nigerconnect

# Flush Redis (rate-limit reset)
docker exec -it nigerconnect-redis redis-cli -a "$REDIS_PASSWORD" FLUSHDB

# Console MinIO
ssh -L 19001:nigerconnect-minio:9001 root@vps
# puis ouvrir http://localhost:19001
```

### 6.3 Versions verrouillées au déploiement

À la date de cet audit :

- API : `node:22-alpine`, NestJS 10.4, Prisma 6.0
- DB : `postgis/postgis:16-3.4-alpine`
- Cache : `redis:7-alpine`
- Storage : `minio:latest` *(pin recommandé pour la prod : remplacer par un tag versionné, ex. `minio/minio:RELEASE.2026-04-15T03-58-23Z`)*
- Web : Next.js 16 (App Router)
- Mobile : Expo SDK 54, React 19, Reanimated 4

### 6.4 Bilan post-audit

```
Findings P0  : 2  →  2 corrigés
Findings P1  : 13 → 13 corrigés
Findings P2  : 5  →  3 corrigés / 2 documentés
Findings P3  : 2  →  0 corrigés / 2 backlog
```

État : **prêt pour mise en production sous réserve** des actions externes §3.1 et de la mise en place des backups §3.5.
