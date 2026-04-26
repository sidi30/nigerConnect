# Déploiement production — NigerConnect

Cible : **VPS `46.224.193.109` (rag-prod-1, Ubuntu 24.04)** où tournent déjà
les stacks `sahabi-*` et `cs-*` derrière un Traefik v3.6 partagé.

Le déploiement est conçu pour **zéro conflit de port** avec les apps voisines :
aucun service NigerConnect n'expose de port host. Le trafic public arrive par
Traefik et le reste vit dans un network privé Docker.

**Domaine** : `sahabiguide.com` (déjà géré par Cloudflare). Contrainte
Universal SSL = un seul niveau de sous-domaine, donc on utilise des hôtes
hyphénés au lieu d'aller deux niveaux profond.

---

## TL;DR

```bash
# Sur le VPS :
ssh root@46.224.193.109
git clone <ton repo> /opt/apps/nigerConnect
cd /opt/apps/nigerConnect

cp .env.prod.example .env.prod
$EDITOR .env.prod                            # remplis les __CHANGE_ME__

./scripts/deploy-vps.sh
```

Endpoints publics après déploiement :
- Web    : <https://nigerconnect.sahabiguide.com>
- API    : <https://api-nigerconnect.sahabiguide.com>
- Health : <https://api-nigerconnect.sahabiguide.com/health>
- CDN    : <https://cdn-nigerconnect.sahabiguide.com/nigerconnect/...>
  (route Traefik dédiée vers MinIO bucket public)

---

## 1. Prérequis VPS

Tout est déjà présent sur `rag-prod-1` :

| Élément | Présent | Détail |
|---|---|---|
| Docker + Compose v2 | ✅ | Compose v5.0.2 |
| Traefik v3.6 | ✅ | `/opt/traefik`, network `traefik-public` |
| Cert resolver Let's Encrypt | ✅ | `letsencrypt-dns` (Cloudflare DNS challenge) |
| Middleware `cloudflare-only@file` | ✅ | Ne laisse passer que les IPs Cloudflare |
| UFW + Fail2Ban | ✅ | Seul port 22 ouvert ; le reste passe par Traefik |

**Pas besoin de `nginx`, `certbot`, `pnpm` ou `node` côté host** — tout vit en
containers.

---

## 2. DNS Cloudflare

**Trois** enregistrements `A` à créer dans la zone `sahabiguide.com`, pointant
sur `46.224.193.109`, **proxied = ON** (orange cloud) — sinon le middleware
`cloudflare-only` bloquera les requêtes :

| Sous-domaine | Type | Cible | Proxied | Sert |
|---|---|---|---|---|
| `nigerconnect.sahabiguide.com` | A | `46.224.193.109` | ✅ ON | Web (Next.js) |
| `api-nigerconnect.sahabiguide.com` | A | `46.224.193.109` | ✅ ON | API NestJS + Socket.io |
| `cdn-nigerconnect.sahabiguide.com` | A | `46.224.193.109` | ✅ ON | MinIO (médias publics) |

Format identique à tes apps existantes (`auth.sahabiguide.com`, `cs-app.X`,
`cs-api.X`, `cs-monitoring.X`). Single-level partout, donc Universal SSL
gratuit Cloudflare suffit.

Le cert Let's Encrypt est émis par Traefik via le **DNS challenge** —
aucune ouverture du port 80, le proxy Cloudflare peut rester actif en
permanence (pas besoin de "désactiver le proxy pour la 1ère émission").

---

## 3. Configuration des secrets

```bash
cd /opt/apps/nigerConnect
cp .env.prod.example .env.prod
```

Variables à renseigner manuellement :

```bash
POSTGRES_PASSWORD=$(openssl rand -base64 24)
REDIS_PASSWORD=$(openssl rand -base64 24)
MINIO_ROOT_PASSWORD=$(openssl rand -base64 24)
# DATA_ENCRYPTION_KEY est généré automatiquement par deploy-vps.sh si laissé à __CHANGE_ME__
```

Optionnel selon les fonctionnalités :
- `RESEND_API_KEY` — emails (sinon les liens reset password sont juste loggués)
- `GOOGLE_CLIENT_ID_*` / `APPLE_*` — Sign-in social
- `FCM_SERVICE_ACCOUNT_JSON` (en base64) — push notifs
- `SENTRY_DSN` — observabilité

---

## 4. Premier déploiement

```bash
./scripts/deploy-vps.sh
```

Le script enchaîne dans l'ordre :

1. **Vérifs** : Docker, network `traefik-public`, fichiers `.env.prod` et compose.
2. **Génère le keypair JWT RS256 4096 bits** dans `secrets/` (mode 600) si absent.
3. **Génère `DATA_ENCRYPTION_KEY`** (32 bytes base64) si encore à `__CHANGE_ME__`.
4. **Refuse de continuer** si d'autres `__CHANGE_ME__` traînent.
5. **Build** des images (API NestJS multi-stage, web Next.js standalone).
6. **Démarre Postgres / Redis / MinIO** ; attend que Postgres soit `healthy`.
7. **Init MinIO** : crée les buckets `nigerconnect` (download anonyme = CDN
   public) et `nigerconnect-private` (pas d'accès anonyme — docs d'identité).
8. **`prisma migrate deploy`** dans un container one-shot.
9. **Démarre `api` + `web`**. Traefik détecte les labels et émet les certs.

Idempotent. Options :

```bash
./scripts/deploy-vps.sh --pull         # git pull avant build
./scripts/deploy-vps.sh --no-build     # restart rapide sans rebuild
./scripts/deploy-vps.sh --logs         # tail -f en fin de déploiement
```

---

## 5. Vérifications post-déploiement

```bash
# Containers tous healthy
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

# API health
curl -f https://api-nigerconnect.sahabiguide.com/health
# → {"status":"ok","service":"nigerconnect-api",…}

# Web 200
curl -fI https://nigerconnect.sahabiguide.com/

# CDN (le bucket public renvoie 404 sur la racine — c'est attendu, pas 403)
curl -I https://cdn-nigerconnect.sahabiguide.com/nigerconnect/

# Cert Let's Encrypt valide
echo | openssl s_client -servername api-nigerconnect.sahabiguide.com \
  -connect api-nigerconnect.sahabiguide.com:443 2>/dev/null | \
  openssl x509 -noout -dates
```

Si le cert n'apparaît pas dans les ~60 s qui suivent le `up`, regarde les logs
Traefik : `docker logs --tail 50 traefik | grep -iE 'acme|nigerconnect'`.

---

## 6. Accès debug (DB, Redis, MinIO console)

Aucun service interne n'est mappé sur le host. Pour les inspecter, tunnel SSH :

```bash
# Postgres
ssh -L 15432:nigerconnect-postgres:5432 root@46.224.193.109
# psql -h localhost -p 15432 -U nigerconnect nigerconnect

# Redis
ssh -L 16379:nigerconnect-redis:6379 root@46.224.193.109
# redis-cli -p 16379 -a "$REDIS_PASSWORD"

# MinIO console
ssh -L 19001:nigerconnect-minio:9001 root@46.224.193.109
# http://localhost:19001
```

Connexions éphémères, aucune ouverture host permanente.

---

## 7. Rotation des clés JWT (zero downtime)

```bash
# 1. Sauvegarde l'ancien jeu
cp secrets/jwt-public.pem  secrets/jwt-public.previous.pem
cp secrets/jwt-private.pem secrets/jwt-private.previous.pem

# 2. Génère le nouveau
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out secrets/jwt-private.pem
openssl rsa -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem

# 3. Mount aussi l'ancienne pubkey pour la fenêtre de rotation
# Ajouter dans docker-compose.prod.yml (sous api.volumes) :
#    - ./secrets/jwt-public.previous.pem:/app/keys/jwt-previous.pem:ro
# Et dans .env.prod : JWT_PREVIOUS_PUBLIC_KEY_PATH=/app/keys/jwt-previous.pem

./scripts/deploy-vps.sh --no-build
# → les access tokens en cours valident encore via la previous (15 min max)
# → les nouveaux sont signés par la new key

# 4. 30 min plus tard, retire previous-key + redeploy
```

---

## 8. Backups

```bash
# Snapshot Postgres
docker exec -t nigerconnect-postgres pg_dump -U nigerconnect nigerconnect | \
  gzip > backups/db-$(date +%F-%H%M).sql.gz

# Snapshot des médias privés
docker run --rm \
  --network nigerconnect-internal \
  -v $PWD/backups:/backup \
  --env MINIO_ROOT_USER --env MINIO_ROOT_PASSWORD \
  minio/mc:latest sh -c "
    mc alias set local http://nigerconnect-minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD &&
    mc mirror local/nigerconnect-private /backup/private-$(date +%F)
  "
```

Pense à **backup `secrets/` + `.env.prod`** dans un coffre séparé. Sans
`DATA_ENCRYPTION_KEY`, les MFA secrets en base sont irrécupérables.

---

## 9. Mise à jour mobile

Une fois la prod live, change l'URL de l'API dans `apps/mobile/eas.json`
(profil `production`) :

```json
"production": {
  "env": {
    "EXPO_PUBLIC_API_URL": "https://api-nigerconnect.sahabiguide.com",
    "EXPO_PUBLIC_SOCKET_URL": "https://api-nigerconnect.sahabiguide.com"
  }
}
```

Puis `eas build --profile production` côté Expo.
