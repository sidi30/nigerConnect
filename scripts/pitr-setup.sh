#!/usr/bin/env bash
# =============================================================================
# NigerConnect — one-time PITR (pgBackRest) setup on the prod VPS.
# =============================================================================
# Enables WAL archiving to the off-site S3 repo, creates the stanza, verifies
# it, and takes the first full backup. Idempotent-ish: safe to re-run (it skips
# already-applied settings; stanza-create is a no-op if it exists).
#
# Prereqs (in .env.prod): PGBACKREST_S3_ENDPOINT/BUCKET/REGION/KEY/KEY_SECRET,
# PGBACKREST_S3_URI_STYLE, PGBACKREST_CIPHER_PASS. The repo bucket must be an
# EXTERNAL provider (B2/R2/S3) — NOT the local MinIO.
#
# Run from the repo root on the VPS:
#   ./scripts/pitr-setup.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-$ROOT/.env.prod}"
COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.pitr.yml --env-file "$ENV_FILE")
CONTAINER="${POSTGRES_CONTAINER:-nigerconnect-postgres}"
STANZA="${PGBACKREST_STANZA:-nigerconnect}"

[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

# --- 0. sanity: required repo config present --------------------------------
missing=()
for v in PGBACKREST_S3_ENDPOINT PGBACKREST_S3_BUCKET PGBACKREST_S3_KEY \
         PGBACKREST_S3_KEY_SECRET PGBACKREST_CIPHER_PASS; do
  [[ -z "${!v:-}" ]] && missing+=("$v")
done
if (( ${#missing[@]} )); then
  echo "ERROR: missing in $ENV_FILE: ${missing[*]}" >&2
  echo "Set the off-site S3 repo creds + cipher pass first (see docs/DISASTER_RECOVERY.md)." >&2
  exit 1
fi

psql() { docker exec -i "$CONTAINER" psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc "$1"; }
pgbr() { docker exec -u postgres "$CONTAINER" pgbackrest --stanza="$STANZA" "$@"; }
wait_healthy() {
  echo "  waiting for postgres to be healthy…"
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "ERROR: postgres did not become ready" >&2; exit 1
}

echo "▶ 1/6 Building + recreating postgres with the pgBackRest image…"
"${COMPOSE[@]}" build postgres
"${COMPOSE[@]}" up -d postgres
wait_healthy

echo "▶ 2/6 Verifying the repo is reachable (pgbackrest info)…"
# If the repo/creds are wrong this fails loudly BEFORE we enable archiving.
pgbr --log-level-console=warn info >/dev/null || {
  echo "ERROR: pgBackRest cannot reach the repo — check PGBACKREST_S3_* creds/endpoint/bucket." >&2
  exit 1
}

echo "▶ 3/6 Enabling WAL archiving (ALTER SYSTEM)…"
psql "ALTER SYSTEM SET wal_level = 'replica';"
psql "ALTER SYSTEM SET archive_mode = 'on';"
psql "ALTER SYSTEM SET archive_command = 'pgbackrest --stanza=${STANZA} archive-push %p';"
psql "ALTER SYSTEM SET archive_timeout = '60';"     # force a WAL switch ≥ every 60s → RPO ≤ ~60s even when idle
psql "ALTER SYSTEM SET max_wal_senders = '3';"      # headroom for a future standby

echo "▶ 4/6 Restarting postgres to apply archive_mode…"
"${COMPOSE[@]}" up -d --force-recreate postgres
wait_healthy

echo "▶ 5/6 Creating + checking the stanza…"
pgbr stanza-create || true   # no-op if it already exists
pgbr check

echo "▶ 6/6 Taking the first FULL backup…"
pgbr --type=full backup
pgbr info

cat <<DONE

✅ PITR is live. Off-site WAL archiving + base backups are running.

Next:
  • Schedule ongoing backups (cron), e.g. /etc/cron.d/nigerconnect-pitr:
      0  2 * * 0  root  cd $ROOT && ./scripts/pitr-backup.sh full  >> /var/log/nigerconnect-pitr.log 2>&1
      0  2 * * 1-6 root cd $ROOT && ./scripts/pitr-backup.sh diff  >> /var/log/nigerconnect-pitr.log 2>&1
      0  */4 * * * root cd $ROOT && ./scripts/pitr-backup.sh incr  >> /var/log/nigerconnect-pitr.log 2>&1
  • TEST a restore on a scratch box — see docs/DISASTER_RECOVERY.md §Restore.
DONE
