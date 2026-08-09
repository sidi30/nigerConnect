# Observabilité — métriques, logs, rétention 30 jours

Stack 100 % open-source, auto-hébergée sur le VPS, zéro service payant.
Objectif : **voir venir** une panne (CPU/RAM/disque, latence, taux d'erreur) et
**débugger après coup** (logs filtrables par erreur HTTP, par utilisateur, par
conteneur) sans quitter la console admin.

```
                        ┌──────────────┐
  API NestJS  /metrics ─┤  Prometheus  │──┐   30 j de métriques (2 Go max)
  cAdvisor             ─┤   (scrape)   │  │
  node-exporter        ─┘              │  │
                        └──────────────┘  ├──▶ API /api/admin/observability/*
  conteneurs Docker ──▶ Promtail ──▶ Loki─┘        (proxy admin-only)
       (nigerconnect-* uniquement)   30 j de logs        │
                                                         ▼
                            Grafana (optionnel)   Console admin → Observabilité
```

Deux règles non négociables :

- **Prometheus et Loki ne sont jamais exposés publiquement.** Ils répondent à
  n'importe quelle requête, sans authentification, à qui peut les joindre. Seul
  Grafana passe par Traefik, avec son propre mot de passe.
- **La mémoire est la contrainte qui commande tout le dimensionnement.** Le VPS
  affiche 15,6 Go dont 6,4 utilisés, mais **7,2 Go de swap sur 8 sont déjà
  consommés** : l'hôte est sur-engagé. Chaque conteneur porte donc un plafond
  mémoire explicite, et **Grafana ne démarre pas par défaut** (profile compose).
  La page admin ne dépend pas de lui — elle proxifie Loki/Prometheus elle-même.

---

## 1. Ce que ça mesure

| Source | Donne |
|---|---|
| API NestJS (`prom-client`) | `http_requests_total{method,route,status}`, `http_request_duration_seconds` (histogramme), `http_errors_total{class}`, plus les métriques Node (heap, event-loop, GC) |
| cAdvisor | CPU / mémoire par conteneur |
| node-exporter | CPU / RAM / disque de l'hôte |
| Promtail → Loki | toutes les lignes de log des conteneurs `nigerconnect-*` |

Les logs de l'API sont du **JSON structuré** (`LOG_FORMAT=json`, défaut en prod) :

```json
{"ts":"2026-08-09T12:00:00.000Z","level":"warn","context":"HTTP",
 "msg":"GET /api/geo/nearby 403","requestId":"3f0c…","method":"GET",
 "url":"/api/geo/nearby","route":"/api/geo/nearby","status":403,
 "durationMs":12,"userId":"8f2c…","ip":"1.2.3.4"}
```

C'est ce qui rend possible le filtrage par code HTTP et par `userId` dans
l'explorateur. Les 5xx ajoutent `error` + `stack`.

**Jamais loggé** : mots de passe, tokens, corps de requête, en-têtes. Les
paramètres sensibles de l'URL (`token`, `code`, `email`, …) sont expurgés par
`scrubUrl` avant écriture — la même liste que celle du filtre d'exceptions.

---

## 2. Lancer la stack

### En local (dev)

Une seule fois, créer les deux réseaux externes attendus :

```bash
docker network create nigerconnect-internal
docker network create traefik-public
```

Puis :

```bash
docker compose -f docker-compose.monitoring.yml \
               -f docker-compose.monitoring.dev.yml --env-file .env up -d

# Grafana est derrière un profile (éteint par défaut, comme en prod) :
docker compose -f docker-compose.monitoring.yml \
               -f docker-compose.monitoring.dev.yml --env-file .env \
               --profile grafana up -d
```

- Prometheus → <http://localhost:9090>, Loki → <http://localhost:3100>
  (loopback uniquement)
- Grafana (si profile activé) → <http://localhost:3002>
  (`admin` / `GRAFANA_ADMIN_PASSWORD`)

L'overlay dev mappe le nom `nigerconnect-api` sur le *host gateway* : Prometheus
scrape donc l'API lancée par `pnpm dev` sur le port 3000, avec **le même
`prometheus.yml` qu'en prod**.

Deux limites en local, assumées :
- Promtail ne voit que les conteneurs Docker (`nigerconnect-postgres`, `-redis`,
  `-minio`). L'API tournant sur l'hôte, ses logs ne partent pas dans Loki — pour
  tester la chaîne complète, lancer l'API en conteneur ou valider en prod.
- La page admin « Observabilité » a besoin de `PROMETHEUS_URL` / `LOKI_URL` dans
  le `.env` de l'API (valeurs `http://localhost:*` déjà dans `.env.example`).

Arrêt : `docker compose -f docker-compose.monitoring.yml -f docker-compose.monitoring.dev.yml down`
(ajouter `-v` pour repartir de zéro).

### En production (VPS) — déploiement en 2 phases

Les deux phases sont **indépendantes** et se déploient séparément, parce qu'elles
n'ont pas le même risque : la phase 1 n'a aucun impact sur l'application, la
phase 2 redémarre l'API.

#### Phase 1 — la stack seule (impact nul sur l'app)

```bash
cd /opt/apps/nigerConnect
# Rien d'obligatoire dans .env.prod pour cette phase (LOG_FORMAT et GRAFANA_*
# ne servent qu'aux phases suivantes).
./scripts/deploy-monitoring.sh
```

Le script est idempotent et **ne touche jamais** api / web / postgres / redis /
minio : la stack tourne dans son propre projet compose
(`nigerconnect-monitoring`) et se contente de **s'attacher** au réseau
`nigerconnect-internal` que l'application a créé — il refuse de démarrer si ce
réseau n'existe pas plutôt que de le recréer.

Avant de démarrer, il vérifie : docker + plugin compose, présence des deux
réseaux externes, validité du compose, présence des trois fichiers de conf, et
il affiche la RAM disponible + l'état du swap (avertissement, pas blocage).

À ce stade la cible `nigerconnect-api` est **DOWN dans Prometheus, et c'est
normal** : l'API n'expose pas encore `/metrics`. Le script le dit explicitement.
Les métriques hôte/conteneurs et les logs de tous les conteneurs remontent déjà.

Contrôles :

```bash
./scripts/deploy-monitoring.sh --status   # conteneurs + RAM réellement consommée
free -m                                   # vérifier que le swap n'a pas empiré
```

#### Phase 2 — l'API instrumentée (redémarre l'API)

```bash
cd /opt/apps/nigerConnect
# 1. Filet de sécurité : étiqueter l'image actuellement en production
docker tag nigerconnect-api:latest nigerconnect-api:pre-observability
# 2. Renseigner LOG_FORMAT=json dans .env.prod
# 3. Déployer normalement (build + migrations + recreate api/web)
./scripts/deploy-vps.sh
```

Puis vérifier, dans l'ordre :

```bash
docker exec nigerconnect-api wget -qO- http://127.0.0.1:3000/health          # doit répondre ok
docker exec nigerconnect-api wget -qO- http://127.0.0.1:3000/metrics | head  # doit sortir du texte Prometheus
docker logs --tail 5 nigerconnect-api                                        # doit sortir du JSON une ligne = un objet
curl -sI https://api.nigerconnect.app/metrics | head -1                      # doit être 403 (deny Traefik)
```

#### Rollback phase 2

Trois niveaux, du moins au plus radical.

1. **Revenir au format de log texte sans redéployer de code** — si un outil
   externe tombe sur les logs JSON :
   ```bash
   sed -i 's/^LOG_FORMAT=json/LOG_FORMAT=text/' .env.prod
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps --force-recreate api
   ```
   `/metrics` reste actif ; seul le format des lignes redevient l'ancien.

2. **Revenir à l'image d'avant** (annule /metrics + logs JSON, ~30 s) :
   ```bash
   docker tag nigerconnect-api:pre-observability nigerconnect-api:latest
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps --force-recreate api
   docker exec nigerconnect-api wget -qO- http://127.0.0.1:3000/health
   ```
   `up -d` ne reconstruit pas tant que l'image existe : c'est bien l'ancienne
   qui redémarre. Aucune migration Prisma n'est associée à ce changement, donc
   rien à annuler côté base.

3. **Revenir au code d'avant** (si l'étiquette n'a pas été posée) :
   ```bash
   git -C /opt/apps/nigerConnect log --oneline -5     # repérer le commit d'avant
   git archive <commit-avant> | ssh root@46.224.193.109 \
     'cd /opt/apps/nigerConnect && tar xf - && ./scripts/deploy-vps.sh'
   ```

La stack monitoring, elle, n'a pas besoin d'être touchée pendant un rollback
d'API : elle constatera juste que la cible `/metrics` est repassée DOWN.

Pour retirer complètement la stack : `./scripts/deploy-monitoring.sh --down`
(les volumes de données sont conservés ; les supprimer reste un
`docker volume rm` manuel et délibéré).

#### Phase 3 (optionnelle) — Grafana

```bash
# 1. DNS Cloudflare grafana.nigerconnect.app → 46.224.193.109 (proxied ON)
# 2. GRAFANA_ADMIN_PASSWORD + GRAFANA_HOST dans .env.prod
./scripts/deploy-monitoring.sh --grafana
```

À ne faire que s'il reste de la marge mémoire (+128 Mo de plafond). La console
admin couvre l'usage quotidien sans lui.

---

## 3. Utiliser la page admin

`tenant.nigerconnect.app` → onglet **Observabilité** (rôle `admin` uniquement :
les logs contiennent des `userId`, des IP et des stack traces).

- **Bandeau KPI site** : requêtes/s, latence p95, taux d'erreur 5xx (ambre
  au-delà de 1 %, rouge au-delà de 5 %), nombre de conteneurs.
- **Bandeau KPI hôte** : CPU / RAM / disque du VPS — *tous projets confondus*,
  c'est une machine mutualisée.
- **Courbe du taux d'erreur** avec la ligne de seuil critique à 5 %.
- **Tableau par conteneur** : CPU et mémoire de travail.
- **Explorateur de logs** : période, conteneur, niveau, classe HTTP (4xx/5xx),
  code exact, `userId`, recherche texte. Cliquer une ligne déplie le JSON brut
  (`requestId`, stack…). La requête LogQL construite est affichée en bas à
  droite pour pouvoir la rejouer dans Grafana.

Si la stack n'est pas déployée, la page affiche « Supervision indisponible » —
l'API fonctionne normalement sans elle.

### Débugger une erreur signalée par un membre

1. Explorateur → **Niveau : Erreur**, période couvrant l'incident.
2. Coller l'UUID du membre dans **Utilisateur** → on ne voit plus que ses lignes.
3. Déplier la ligne fautive, récupérer le `requestId`.
4. Rechercher ce `requestId` en texte libre (filtres remis à zéro) : on obtient
   la ligne d'accès **et** la stack trace du 5xx, corrélées.

---

## 4. Ajouter une métrique

`MetricsService` est fourni par un module `@Global()` — l'injecter suffit :

```ts
// apps/api/src/feed/posts.service.ts
constructor(private readonly metrics: MetricsService) {}
```

Pour un compteur métier, déclarer la métrique dans
`apps/api/src/common/metrics/metrics.service.ts` (à côté des trois existantes) et
exposer une méthode d'observation — jamais un `Counter` public :

```ts
private readonly postsCreated = new Counter({
  name: 'posts_created_total',
  help: 'Publications créées',
  labelNames: ['visibility'],
  registers: [this.registry],
});

recordPostCreated(visibility: string): void {
  this.postsCreated.inc({ visibility });
}
```

**Règle de cardinalité** : un label ne doit jamais contenir un identifiant
(userId, postId, URL concrète). Chaque valeur distincte = une série stockée
30 jours. `route` utilise le *template* Express (`/api/users/:id`), pas l'URL.

Le HTTP est déjà couvert par `HttpObservabilityMiddleware`, qui est un
**middleware** et non un intercepteur : les intercepteurs Nest s'exécutent après
les guards, donc un 401/403 rejeté par `JwtAuthGuard`/`RolesGuard` n'aurait été
ni compté ni loggé — or ce sont justement les pics intéressants.

---

## 5. Rétention et empreinte

| Service | Rétention | Plafond mémoire | Plafond CPU |
|---|---|---|---|
| Prometheus | 30 j **ou** 4 Go de TSDB (le premier atteint) | 256 Mo | 0,50 |
| Loki | 720 h (compactor, `retention_enabled: true`) | 256 Mo | 0,50 |
| cAdvisor | — | 128 Mo | 0,50 |
| Promtail | — | 64 Mo | 0,25 |
| node-exporter | — | 32 Mo | 0,15 |
| **Stack par défaut** | | **736 Mo** | **1,9 cœur** |
| Grafana (profile, éteint par défaut) | — | 128 Mo | 0,50 |
| **Avec Grafana** | | **864 Mo** | **2,4 cœurs** |

Deux précisions qui comptent sur cet hôte :

- Ce sont des **plafonds, pas des réservations**. Docker ne pré-alloue rien : un
  conteneur limité à 256 Mo qui en utilise 60 n'en consomme que 60. La
  consommation réelle attendue au repos pour la stack par défaut est de
  **350 à 450 Mo**, l'essentiel étant Prometheus et Loki.
- Les plafonds existent pour que, en cas de dérive (explosion de cardinalité,
  burst de logs), l'OOM-killer frappe **le conteneur fautif** et pas Postgres ou
  l'API — ni un des ~12 autres projets de l'hôte.

Disque : 103 Go libres au moment de l'écriture, pour 4 Go de TSDB Prometheus
plafonnés + les chunks Loki purgés à 30 jours. Pas un sujet.

Pour descendre encore : laisser Grafana éteint (défaut) et, si nécessaire,
baisser `--storage.tsdb.retention.time` à 15 j — c'est Prometheus qui grossit
le plus vite.

---

## 6. Cloisonnement sur un hôte mutualisé

Le VPS héberge ~12 projets / ~58 conteneurs sans rapport. Trois garde-fous :

1. **Logs** — Promtail filtre côté API Docker (`filters: name=nigerconnect-`)
   *et* jette tout ce qui n'obtient pas de label `container` au relabel. Les
   logs des voisins ne sont jamais ni lus ni stockés.
2. **Métriques** — cAdvisor voit tout l'hôte ; le `metric_relabel_configs` de
   `prometheus.yml` ne garde que les séries `container_*` des conteneurs
   `nigerconnect-*`, plus **un** `container_last_seen` par conteneur voisin (une
   série, pour le comptage de charge de l'hôte). Le reste est jeté avant écriture.
3. **Réseau** — aucun port publié sur l'hôte en prod. Grafana seul passe par le
   Traefik existant, derrière le middleware `cloudflare-only@file`. Le réseau
   privé de l'application (`nigerconnect-internal`, déclaré `internal` dans
   `docker-compose.prod.yml`) est référencé en `external: true` : la stack s'y
   **attache**, elle ne le crée pas et ne le modifie pas.
4. **Cycle de vie** — projet compose distinct (`nigerconnect-monitoring`).
   `up`, `down`, `restart` de la supervision n'ont aucun effet sur les
   conteneurs de l'application, et réciproquement.
5. **Mémoire** — plafonds explicites sur chaque service (§5), Grafana éteint par
   défaut. En cas de dérive, l'OOM-killer frappe le conteneur de supervision,
   pas la production.

Rien n'est modifié dans la configuration globale de l'hôte : ni Traefik, ni le
démon Docker, ni les autres stacks.

---

## 7. Protection de `/metrics`

Deux couches :

1. **Traefik** — un routeur de priorité 100 capte
   `Host(api.nigerconnect.app) && PathPrefix(/metrics)` et lui applique une
   allowlist IP réduite à `127.0.0.1/32`. Depuis Internet, c'est 403. Prometheus,
   lui, passe par le réseau Docker privé sans toucher à Traefik.
2. **Jeton facultatif** — si `METRICS_TOKEN` est défini dans `.env.prod`, l'API
   exige `Authorization: Bearer <token>` (comparaison à temps constant) et
   répond **404** sinon. Pour que Prometheus continue à scraper :

   ```bash
   printf '%s' "$METRICS_TOKEN" > monitoring/prometheus/metrics_token   # gitignoré
   # puis décommenter le bloc `authorization:` dans monitoring/prometheus/prometheus.yml
   ```

Par défaut `METRICS_TOKEN` est vide : la couche 1 suffit.

---

## 8. Dépannage

| Symptôme | Piste |
|---|---|
| Page admin « Supervision indisponible » | `docker ps \| grep nigerconnect-prometheus` ; vérifier `PROMETHEUS_URL`/`LOKI_URL` dans `.env.prod` ; l'API doit être sur `nigerconnect-internal` |
| Cible `nigerconnect-api` DOWN dans Prometheus | `docker exec nigerconnect-prometheus wget -qO- http://nigerconnect-api:3000/metrics \| head` — si 404, `METRICS_TOKEN` est défini sans `credentials_file` côté Prometheus |
| Aucun log dans l'explorateur | `docker logs nigerconnect-promtail` ; le socket Docker est-il monté ? Loki est-il `ready` (`docker exec nigerconnect-loki wget -qO- http://127.0.0.1:3100/ready`) ? |
| Filtre par niveau/statut vide alors que des lignes existent | `LOG_FORMAT` n'est pas à `json` : sans JSON, `\| json` ne trouve aucun champ |
| cAdvisor redémarre en boucle | certains noyaux exigent `privileged: true` — l'ajouter au service `cadvisor` |
| `permission denied` sur `/prometheus` ou `/loki` au démarrage | volume nommé créé root alors que les conteneurs tournent en 65534 / 10001 : `docker run --rm -v nigerconnect-monitoring_nigerconnect-loki-data:/d alpine chown -R 10001:10001 /d` (idem 65534 pour prometheus) |
| Disque qui monte | `docker system df -v \| grep nigerconnect-loki` ; baisser `retention_period` dans `monitoring/loki/loki-config.yml` ou `--storage.tsdb.retention.size` |

---

## 9. Fichiers

```
docker-compose.monitoring.yml        stack (prod-shaped, aucun port publié)
docker-compose.monitoring.dev.yml    overlay dev (loopback + host-gateway)
scripts/deploy-monitoring.sh         déploiement idempotent, n'effleure pas l'app
monitoring/prometheus/prometheus.yml scrape + filtrage des séries voisines
monitoring/loki/loki-config.yml      single binary, filesystem, purge 30 j
monitoring/promtail/promtail-config.yml  découverte Docker, nigerconnect-* only
monitoring/grafana/provisioning/     datasources + provider de dashboards
monitoring/grafana/dashboards/       dashboard « Vue d'ensemble »

apps/api/src/common/metrics/         registry, /metrics, middleware HTTP
apps/api/src/common/logger/          logger JSON structuré
apps/api/src/observability/          proxy admin Prometheus + Loki (Zod, LogQL)
apps/web/components/admin/ObservabilitySection.tsx   page admin
```
