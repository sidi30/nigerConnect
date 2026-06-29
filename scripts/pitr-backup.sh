#!/usr/bin/env bash
# =============================================================================
# NigerConnect — pgBackRest backup (cron). Usage: pitr-backup.sh [full|diff|incr]
# =============================================================================
# full → new base backup (weekly). diff → changes since last full (daily).
# incr → changes since last backup (hourly-ish). WAL is archived continuously by
# Postgres between backups, so PITR can target any moment, not just a backup.
#
# Notifies BACKUP_WEBHOOK_URL (same one backup-pg.sh uses) on success/failure.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.prod}"
[[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

CONTAINER="${POSTGRES_CONTAINER:-nigerconnect-postgres}"
STANZA="${PGBACKREST_STANZA:-nigerconnect}"
TYPE="${1:-incr}"
case "$TYPE" in full|diff|incr) ;; *) echo "usage: $0 [full|diff|incr]" >&2; exit 2 ;; esac

notify() {
  local ok="$1" err="${2:-}"
  [[ -z "${BACKUP_WEBHOOK_URL:-}" ]] && return 0
  curl -fsS -X POST "$BACKUP_WEBHOOK_URL" -H 'Content-Type: application/json' \
    -d "{\"ok\":$ok,\"kind\":\"pitr-$TYPE\",\"ts\":\"$(date -u +%Y%m%dT%H%M%SZ)\",\"error\":$( [[ -n "$err" ]] && echo "\"$err\"" || echo null )}" \
    >/dev/null 2>&1 || true
}
trap 'notify false "pgbackrest $TYPE backup failed (see log)"' ERR

echo "[$(date -Iseconds)] pgBackRest $TYPE backup…"
docker exec -u postgres "$CONTAINER" pgbackrest --stanza="$STANZA" --type="$TYPE" backup
echo "[$(date -Iseconds)] done."
notify true
