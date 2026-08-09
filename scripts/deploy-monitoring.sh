#!/usr/bin/env bash
# =============================================================================
# NigerConnect — Observability stack deployment (idempotent)
# =============================================================================
# Deliberately SEPARATE from deploy-vps.sh: this stack must be startable,
# restartable and removable without ever touching api / web / postgres / redis /
# minio. It runs as its own compose project (`nigerconnect-monitoring`) and only
# ATTACHES to the app's existing private network — it never creates it.
#
# Run on the VPS, in the project root:
#   cd /opt/apps/nigerConnect
#   ./scripts/deploy-monitoring.sh              # prometheus, loki, promtail, cadvisor, node-exporter
#   ./scripts/deploy-monitoring.sh --grafana    # + Grafana behind Traefik
#   ./scripts/deploy-monitoring.sh --status     # what's running + memory used
#   ./scripts/deploy-monitoring.sh --down       # stop the stack (data volumes kept)
#   ./scripts/deploy-monitoring.sh --logs       # follow logs
#
# Memory budget is the binding constraint on this host (swap already ~7 GB of
# 8 GB): default ceiling is 736 MB, +128 MB with Grafana. See the limits in
# docker-compose.monitoring.yml and docs/OBSERVABILITE.md.
# =============================================================================

set -euo pipefail

# Colors (fall back to no-op if not a tty)
if [[ -t 1 ]]; then
  C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else
  C_OK=; C_WARN=; C_ERR=; C_DIM=; C_RST=
fi
log()  { echo "${C_OK}▶${C_RST} $*"; }
warn() { echo "${C_WARN}!${C_RST} $*"; }
die()  { echo "${C_ERR}✗${C_RST} $*" >&2; exit 1; }

# -----------------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE=".env.prod"
COMPOSE_FILE="docker-compose.monitoring.yml"
# Must match the `name:` of the `app` network in docker-compose.monitoring.yml,
# which is itself the `name:` of the `internal` network in docker-compose.prod.yml.
APP_NETWORK="nigerconnect-internal"

GRAFANA=0; FOLLOW=0; DOWN=0; STATUS=0
for arg in "$@"; do
  case "$arg" in
    --grafana) GRAFANA=1 ;;
    --logs)    FOLLOW=1 ;;
    --down)    DOWN=1 ;;
    --status)  STATUS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "Unknown flag: $arg" ;;
  esac
done

# -----------------------------------------------------------------------------
# 1. Sanity checks
# -----------------------------------------------------------------------------
command -v docker >/dev/null || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"
[[ -f "$COMPOSE_FILE" ]] || die "$COMPOSE_FILE not found"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found. Copy .env.prod.example and fill it in."

COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"
[[ "$GRAFANA" == "1" ]] && COMPOSE="$COMPOSE --profile grafana"

# --status / --down / --logs are pure operations: run and exit.
if [[ "$STATUS" == "1" ]]; then
  $COMPOSE ps
  echo
  log "Memory in use by the monitoring stack:"
  docker stats --no-stream --format '   {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' \
    $(docker ps --filter "label=com.docker.compose.project=nigerconnect-monitoring" --format '{{.Names}}') \
    2>/dev/null || warn "No monitoring container running."
  exit 0
fi

if [[ "$DOWN" == "1" ]]; then
  # No `-v`: metrics and logs survive a restart. Wiping data must stay a
  # deliberate, manual `docker volume rm`.
  log "Stopping the monitoring stack (data volumes kept)…"
  $COMPOSE --profile grafana down
  log "Done. The app containers were not touched."
  exit 0
fi

# The app stack owns this network. Its absence means the app isn't deployed —
# creating it here would produce a second, disconnected network with the same
# name semantics and Prometheus would silently scrape nothing.
if ! docker network inspect "$APP_NETWORK" >/dev/null 2>&1; then
  die "Network '$APP_NETWORK' missing. Deploy the app first (./scripts/deploy-vps.sh) — this script attaches to it, it never creates it."
fi

if ! docker network inspect traefik-public >/dev/null 2>&1; then
  die "External network 'traefik-public' missing. This host is expected to already run Traefik."
fi

if [[ "$GRAFANA" == "1" ]]; then
  GRAFANA_PASSWORD=$(grep -E '^GRAFANA_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || true)
  if [[ -z "$GRAFANA_PASSWORD" || "$GRAFANA_PASSWORD" == "__CHANGE_ME__" ]]; then
    die "GRAFANA_ADMIN_PASSWORD is empty or still the placeholder in $ENV_FILE. Run: openssl rand -base64 24"
  fi
fi

# -----------------------------------------------------------------------------
# 2. Memory pre-flight — this host runs ~59 containers and is already swapping.
#    A warning, not a hard stop: the operator decides.
# -----------------------------------------------------------------------------
if command -v free >/dev/null 2>&1; then
  AVAILABLE_MB=$(free -m | awk '/^Mem:/ {print $7}')
  SWAP_USED_MB=$(free -m | awk '/^Swap:/ {print $3}')
  SWAP_TOTAL_MB=$(free -m | awk '/^Swap:/ {print $2}')
  NEEDED_MB=$([[ "$GRAFANA" == "1" ]] && echo 864 || echo 736)
  log "Host memory: ${AVAILABLE_MB} MB available, swap ${SWAP_USED_MB}/${SWAP_TOTAL_MB} MB used."
  if [[ "$AVAILABLE_MB" -lt "$NEEDED_MB" ]]; then
    warn "Less available RAM than the stack's ${NEEDED_MB} MB ceiling. Limits are ceilings, not"
    warn "reservations (expected steady state ≈ 350–450 MB) — but watch 'free -m' after startup."
  fi
fi

# -----------------------------------------------------------------------------
# 3. Config sanity — a typo here fails at runtime, minutes later, in a log file.
# -----------------------------------------------------------------------------
log "Validating the compose file…"
$COMPOSE config --quiet || die "Invalid compose configuration."

for f in monitoring/prometheus/prometheus.yml \
         monitoring/loki/loki-config.yml \
         monitoring/promtail/promtail-config.yml; do
  [[ -f "$f" ]] || die "$f not found"
done

# -----------------------------------------------------------------------------
# 4. Pull + start. `up -d` is idempotent: unchanged services are left alone.
# -----------------------------------------------------------------------------
log "Pulling images…"
$COMPOSE pull --quiet

log "Starting the monitoring stack…"
$COMPOSE up -d

# -----------------------------------------------------------------------------
# 5. Verify the two things that actually matter
# -----------------------------------------------------------------------------
log "Waiting for Prometheus and Loki…"
PROM_OK=0; LOKI_OK=0
for _ in $(seq 1 30); do
  [[ "$PROM_OK" == "0" ]] && docker exec nigerconnect-prometheus \
    wget -qO- http://127.0.0.1:9090/-/ready >/dev/null 2>&1 && PROM_OK=1
  [[ "$LOKI_OK" == "0" ]] && docker exec nigerconnect-loki \
    wget -qO- http://127.0.0.1:3100/ready 2>/dev/null | grep -q ready && LOKI_OK=1
  [[ "$PROM_OK" == "1" && "$LOKI_OK" == "1" ]] && break
  sleep 2
done
[[ "$PROM_OK" == "1" ]] || warn "Prometheus not ready yet — check: docker logs nigerconnect-prometheus"
[[ "$LOKI_OK" == "1" ]] || warn "Loki not ready yet — check: docker logs nigerconnect-loki"

# The API target only comes up once the instrumented image is deployed (phase 2
# of the rollout). Before that, a DOWN target here is EXPECTED, not a failure.
if [[ "$PROM_OK" == "1" ]]; then
  if docker exec nigerconnect-prometheus \
      wget -qO- 'http://127.0.0.1:9090/api/v1/query?query=up{job="nigerconnect-api"}' 2>/dev/null \
      | grep -q '"value"'; then
    log "API /metrics target is being scraped."
  else
    warn "API /metrics target not up yet — normal until the instrumented API image is deployed."
  fi
fi

echo
$COMPOSE ps
echo
log "Endpoints (internal only — nothing is published on the host):"
echo "   ${C_DIM}prometheus →${C_RST} http://nigerconnect-prometheus:9090  (private network)"
echo "   ${C_DIM}loki       →${C_RST} http://nigerconnect-loki:3100        (private network)"
if [[ "$GRAFANA" == "1" ]]; then
  GRAFANA_HOST=$(grep -E '^GRAFANA_HOST=' "$ENV_FILE" | cut -d= -f2-)
  echo "   ${C_DIM}grafana    →${C_RST} https://${GRAFANA_HOST:-grafana.nigerconnect.app}"
fi
echo "   ${C_DIM}console    →${C_RST} admin console → onglet Observabilité"
echo
log "Memory used: ${C_DIM}./scripts/deploy-monitoring.sh --status${C_RST}"

if [[ "$FOLLOW" == "1" ]]; then
  $COMPOSE logs -f --tail=100
fi
