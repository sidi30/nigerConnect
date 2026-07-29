#!/usr/bin/env bash
# =============================================================================
# NigerConnect — daily Postgres backup
# =============================================================================
# Run from the host (cron, systemd timer, or `./scripts/backup-pg.sh`):
#
#   /etc/cron.d/nigerconnect-pg-backup:
#     15 3 * * * root /opt/apps/nigerConnect/scripts/backup-pg.sh \
#                  >> /var/log/nigerconnect-backup.log 2>&1
#
# Behavior:
#   - pg_dump → gzip → /var/backups/nigerconnect/<TS>.sql.gz
#   - Retention: keep last 14 daily dumps locally, plus 1 per Sunday for 8 weeks
#   - If RCLONE_REMOTE is set, mirrors the dump off-host immediately
#   - Notifies a webhook (BACKUP_WEBHOOK_URL) on success and on failure
#
# Required environment (loaded from .env.prod by default):
#   POSTGRES_USER, POSTGRES_DB
# Optional:
#   BACKUP_DIR     (default /var/backups/nigerconnect)
#   RCLONE_REMOTE  (e.g. "b2:nigerconnect-backups")
#   BACKUP_WEBHOOK_URL  (POSTed: { ok: bool, ts, sizeMB, error? })
# =============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env.prod}"

# Read one key out of the env file WITHOUT executing it. `source` cannot be used
# here: .env.prod holds unquoted values with shell metacharacters (MAIL_FROM is
# `NigerConnect <contact@…>`, whose `<` bash reads as a redirect), so sourcing
# errors out mid-file and every key declared after that line comes back unset.
# Docker Compose reads the same file literally, so it never saw the problem.
read_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n1 |
    sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# Real environment wins over the file, so a cron line or an operator can override
# any of these without touching .env.prod.
CONTAINER="${POSTGRES_CONTAINER:-$(read_env POSTGRES_CONTAINER)}"
CONTAINER="${CONTAINER:-nigerconnect-postgres}"
USER="${POSTGRES_USER:-$(read_env POSTGRES_USER)}"
DB="${POSTGRES_DB:-$(read_env POSTGRES_DB)}"
: "${USER:?POSTGRES_USER required (env or $ENV_FILE)}"
: "${DB:?POSTGRES_DB required (env or $ENV_FILE)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-$(read_env RCLONE_REMOTE)}"
BACKUP_WEBHOOK_URL="${BACKUP_WEBHOOK_URL:-$(read_env BACKUP_WEBHOOK_URL)}"
BACKUP_DIR="${BACKUP_DIR:-$(read_env BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/nigerconnect}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/${TS}.sql.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

notify() {
  local ok="$1" size_mb="${2:-0}" err="${3:-}"
  if [[ -n "${BACKUP_WEBHOOK_URL:-}" ]]; then
    curl -fsS -X POST "$BACKUP_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"ok\":$ok,\"ts\":\"$TS\",\"sizeMB\":$size_mb,\"error\":$( [[ -n "$err" ]] && echo "\"$err\"" || echo null )}" \
      >/dev/null 2>&1 || true
  fi
}

trap 'notify false 0 "pg_dump failed (see log)"' ERR

echo "[$(date -Iseconds)] Starting backup → $OUT"

# Stream dump from the container; --clean adds DROP statements so a restore
# wipes existing objects first. -Fc would compress harder but plain SQL keeps
# us portable across PG versions.
docker exec -i "$CONTAINER" pg_dump \
  --clean --if-exists --no-owner --no-privileges \
  -U "$USER" "$DB" \
  | gzip -9 > "$OUT"

SIZE_BYTES=$(stat -c%s "$OUT")
SIZE_MB=$(( SIZE_BYTES / 1024 / 1024 ))
echo "[$(date -Iseconds)] Local dump OK ($SIZE_MB MB)"

# Off-host mirror (best-effort)
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  echo "[$(date -Iseconds)] rclone copy → $RCLONE_REMOTE"
  rclone copy "$OUT" "$RCLONE_REMOTE/" --no-traverse --quiet || {
    echo "rclone copy failed — local copy is intact" >&2
    notify false "$SIZE_MB" "rclone copy failed"
    exit 1
  }
fi

# Retention: keep last 14 daily dumps + Sundays for 56 days
find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -mtime +14 \
  ! -newer "$BACKUP_DIR" \
  | while read -r f; do
      day_of_week=$(date -r "$f" +%u 2>/dev/null || stat -c %y "$f" | xargs -I{} date -d {} +%u)
      file_age_days=$(( ( $(date +%s) - $(stat -c%Y "$f") ) / 86400 ))
      if [[ "$day_of_week" == "7" && "$file_age_days" -le 56 ]]; then
        continue   # keep Sunday dumps for 8 weeks
      fi
      rm -f "$f"
    done

echo "[$(date -Iseconds)] Done."
notify true "$SIZE_MB"
