#!/usr/bin/env bash
# =============================================================================
# NigerConnect — VPS deployment (idempotent)
# =============================================================================
# Run on the VPS, in the project root:
#   cd /opt/apps/nigerConnect
#   ./scripts/deploy-vps.sh           # full deploy
#   ./scripts/deploy-vps.sh --pull    # rebuild from latest git
#   ./scripts/deploy-vps.sh --logs    # follow logs after deploy
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
COMPOSE_FILE="docker-compose.prod.yml"
SECRETS_DIR="$PROJECT_ROOT/secrets"

PULL=0; FOLLOW=0; SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=1 ;;
    --logs) FOLLOW=1 ;;
    --no-build) SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) die "Unknown flag: $arg" ;;
  esac
done

# -----------------------------------------------------------------------------
# 1. Sanity checks
# -----------------------------------------------------------------------------
log "Checking prerequisites…"
command -v docker >/dev/null   || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

if ! docker network inspect traefik-public >/dev/null 2>&1; then
  die "External network 'traefik-public' missing. This deploy expects an existing Traefik on the host."
fi

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found. Copy .env.prod.example and fill it in."
[[ -f "$COMPOSE_FILE" ]] || die "$COMPOSE_FILE not found"

# -----------------------------------------------------------------------------
# 2. Generate JWT keypair on first run (RS256, 4096 bits)
# -----------------------------------------------------------------------------
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if [[ ! -f "$SECRETS_DIR/jwt-private.pem" || ! -f "$SECRETS_DIR/jwt-public.pem" ]]; then
  log "Generating RS256 keypair (first run)…"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
    -out "$SECRETS_DIR/jwt-private.pem" 2>/dev/null
  openssl rsa -in "$SECRETS_DIR/jwt-private.pem" -pubout \
    -out "$SECRETS_DIR/jwt-public.pem" 2>/dev/null
  log "Keypair written to $SECRETS_DIR/"
else
  log "JWT keypair present, skipping generation."
fi

# Ownership: the API container runs as uid 1001 (nodejs user). Mount targets
# must be readable by that uid — keep mode 600 on the private key but assign
# ownership to 1001 on the host. Re-applied every run so a manually-restored
# backup doesn't lock the container out.
chown 1001:1001 "$SECRETS_DIR/jwt-private.pem" "$SECRETS_DIR/jwt-public.pem" 2>/dev/null || true
chmod 600 "$SECRETS_DIR/jwt-private.pem"
chmod 640 "$SECRETS_DIR/jwt-public.pem"

# -----------------------------------------------------------------------------
# 3. Generate DATA_ENCRYPTION_KEY if still placeholder
# -----------------------------------------------------------------------------
if grep -q '^DATA_ENCRYPTION_KEY=__CHANGE_ME__' "$ENV_FILE"; then
  log "Generating DATA_ENCRYPTION_KEY…"
  KEY=$(openssl rand -base64 32)
  # Portable in-place edit (works on GNU + BSD sed)
  sed -i.bak "s|^DATA_ENCRYPTION_KEY=__CHANGE_ME__|DATA_ENCRYPTION_KEY=${KEY}|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
  log "Key written. Back it up — losing it makes encrypted columns unreadable."
fi

# -----------------------------------------------------------------------------
# 4. Refuse to deploy with placeholder secrets
# -----------------------------------------------------------------------------
if grep -E '^(POSTGRES_PASSWORD|REDIS_PASSWORD|MINIO_ROOT_PASSWORD)=__CHANGE_ME__' "$ENV_FILE" >/dev/null; then
  warn "Placeholder secrets still in $ENV_FILE:"
  grep -E '^(POSTGRES_PASSWORD|REDIS_PASSWORD|MINIO_ROOT_PASSWORD)=__CHANGE_ME__' "$ENV_FILE" | sed 's/^/   /'
  die "Run: openssl rand -base64 24 → paste into the matching line, then re-run."
fi

# -----------------------------------------------------------------------------
# 5. Optional git pull
# -----------------------------------------------------------------------------
if [[ "$PULL" == "1" ]]; then
  log "Pulling latest commits…"
  git pull --ff-only
fi

# -----------------------------------------------------------------------------
# 6. Build images (skip if --no-build for fast restarts)
# -----------------------------------------------------------------------------
COMPOSE="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"

if [[ "$SKIP_BUILD" == "0" ]]; then
  log "Building images…"
  $COMPOSE build --pull
fi

# -----------------------------------------------------------------------------
# 7. Apply Prisma migrations BEFORE starting the API.
#    Done in a one-shot container so a failing migration aborts the deploy.
# -----------------------------------------------------------------------------
log "Starting database…"
$COMPOSE up -d postgres redis minio
$COMPOSE up minio-init  # idempotent, exits 0

# Wait until postgres is healthy (compose's healthcheck loop)
log "Waiting for postgres to be healthy…"
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' nigerconnect-postgres 2>/dev/null || echo "starting")
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
[[ "$status" == "healthy" ]] || die "Postgres did not become healthy in time"

log "Running prisma migrations…"
# Use the prisma binary baked into the API image (now a regular dependency,
# not a devDep) — avoids fetching a different major version via `npx prisma`.
$COMPOSE run --rm --no-deps --entrypoint sh api -c "node node_modules/prisma/build/index.js migrate deploy"

# -----------------------------------------------------------------------------
# 8. Bring up everything else
# -----------------------------------------------------------------------------
log "Starting api + web…"
$COMPOSE up -d api web

# -----------------------------------------------------------------------------
# 9. Status summary
# -----------------------------------------------------------------------------
echo
log "Deployment complete. Containers:"
$COMPOSE ps
echo
WEB_HOST=$(grep -E '^WEB_HOST=' "$ENV_FILE" | cut -d= -f2-)
API_HOST=$(grep -E '^API_HOST=' "$ENV_FILE" | cut -d= -f2-)
log "Public endpoints:"
echo "   ${C_DIM}web →${C_RST} https://${WEB_HOST}"
echo "   ${C_DIM}api →${C_RST} https://${API_HOST}"
echo "   ${C_DIM}health →${C_RST} https://${API_HOST}/health"
echo
log "Tail logs with: ${C_DIM}$COMPOSE logs -f --tail=100${C_RST}"

if [[ "$FOLLOW" == "1" ]]; then
  $COMPOSE logs -f --tail=100
fi
