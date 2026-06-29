# Disaster Recovery — NigerConnect Postgres

Two independent layers protect the database:

1. **Logical daily dump** (`scripts/backup-pg.sh`) — `pg_dump` → gzip → off-host
   via rclone. Simple, portable, RPO ≈ 24 h. Good for "give me yesterday's data".
2. **PITR (pgBackRest)** — continuous WAL archiving + periodic physical base
   backups to an off-site S3 bucket. **RPO ≈ 1 minute**, restore to *any point in
   time*. This is the "near-fresh recovery" layer.

Keep both. They fail differently (a logical dump survives a corrupt WAL chain; a
physical PITR survives a bad migration mid-day).

---

## Architecture

```
 Postgres (Docker, prod VPS)
   │  archive_command = pgbackrest archive-push     (every WAL segment, ≤60s)
   ▼
 pgBackRest ──► S3-compatible repo (Backblaze B2 / Cloudflare R2 / AWS S3)
                 • base backups (full weekly, diff daily, incr ~4h)
                 • WAL archive (continuous)
                 • AES-256 encrypted, zstd compressed, retention-managed
```

- **Off-site is mandatory.** The repo is an EXTERNAL provider, never the VPS's
  own MinIO — a backup on the same machine dies with the machine.
- The repo is **encrypted at rest** with `PGBACKREST_CIPHER_PASS`. Store that
  passphrase somewhere off-machine (password manager). Lose it → backups are junk.
- Postgres keeps WAL until it's archived; if the repo is unreachable for a long
  time, WAL accumulates on the data volume. Monitor (see below).

---

## One-time setup

1. **Create the off-site bucket** on B2 / R2 / S3 (e.g. `nigerconnect-pgbackup`),
   plus an application key scoped to it. Note endpoint, region, key, secret.
2. **Fill `.env.prod`** (see `.env.prod.example` → PITR block):
   `PGBACKREST_S3_ENDPOINT/BUCKET/REGION/KEY/KEY_SECRET`, `PGBACKREST_S3_URI_STYLE`
   (`path` for B2/R2/MinIO, `host` for AWS), and a generated
   `PGBACKREST_CIPHER_PASS` (`openssl rand -base64 48`).
3. **Run the setup** on the VPS (repo root):
   ```bash
   ./scripts/pitr-setup.sh
   ```
   It builds the pgBackRest image, verifies the repo is reachable, enables
   archiving (`ALTER SYSTEM` + one restart), creates the stanza, checks it, and
   takes the first full backup.

> ⚠️ One brief Postgres restart happens in step 4 of the script (to apply
> `archive_mode`). Schedule it in a quiet window.

To make the pgBackRest image the permanent prod image, always bring the stack up
with both compose files, e.g. add `-f docker-compose.pitr.yml` to the
`docker compose ... up` in `scripts/deploy-vps.sh` (or keep it as an explicit
overlay you apply after each deploy).

---

## Ongoing backups (cron)

`/etc/cron.d/nigerconnect-pitr`:
```cron
0  2 * * 0   root  cd /opt/apps/nigerConnect && ./scripts/pitr-backup.sh full >> /var/log/nigerconnect-pitr.log 2>&1
0  2 * * 1-6 root  cd /opt/apps/nigerConnect && ./scripts/pitr-backup.sh diff >> /var/log/nigerconnect-pitr.log 2>&1
0  */4 * * * root  cd /opt/apps/nigerConnect && ./scripts/pitr-backup.sh incr >> /var/log/nigerconnect-pitr.log 2>&1
```
WAL is archived continuously between backups, so PITR isn't limited to backup
times — these just bound how much WAL must be replayed on restore.

---

## Monitoring

```bash
# Backup + WAL archive status (last backups, WAL min/max, repo size):
docker exec -u postgres nigerconnect-postgres pgbackrest --stanza=nigerconnect info

# Is archiving healthy? (failed count should stay 0; last_archived_time recent)
docker exec -i nigerconnect-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT last_archived_wal, last_archived_time, failed_count, last_failed_time FROM pg_stat_archiver;"
```
Alert if `failed_count` climbs or `last_archived_time` falls behind — that means
WAL is piling up on disk. The `BACKUP_WEBHOOK_URL` already fires on backup
failures.

---

## Restore — recover to a point in time

**Do this on a SCRATCH host/container first to test — never overwrite the live
data volume until you've validated a restore at least once.**

Restore brings back the latest base backup and replays WAL up to a target time.

```bash
# On a box with the pgBackRest image + the SAME PGBACKREST_* env (repo creds +
# cipher pass), pointed at an EMPTY pgdata:

# 1. Restore the base + WAL to a chosen instant (UTC). Omit --target for "latest".
pgbackrest --stanza=nigerconnect \
  --type=time --target="2026-06-29 14:30:00+00" \
  --delta restore

# 2. Start Postgres. It replays WAL to the target, then opens for reads/writes.
#    (pgBackRest writes recovery settings; `--type=time` sets recovery_target_time.)
```

Operationally, to restore the LIVE prod DB:
```bash
cd /opt/apps/nigerConnect
docker compose -f docker-compose.prod.yml -f docker-compose.pitr.yml --env-file .env.prod stop postgres api web
# Wipe the current data dir (you are about to replace it — be sure):
docker run --rm -v nigerconnect-postgres-data:/pg alpine sh -c 'rm -rf /pg/pgdata/*'
# Restore into the volume using the pgBackRest image:
docker run --rm -v nigerconnect-postgres-data:/var/lib/postgresql/data \
  --env-file .env.prod -e PGBACKREST_PG1_PATH=/var/lib/postgresql/data/pgdata \
  nigerconnect-postgres:16-pgbackrest \
  pgbackrest --stanza=nigerconnect --type=time --target="<UTC time>" --delta restore
# Bring it back up:
docker compose -f docker-compose.prod.yml -f docker-compose.pitr.yml --env-file .env.prod up -d
```
After a successful PITR restore, take a fresh `full` backup (`./scripts/pitr-backup.sh full`).

> If you only need yesterday's snapshot and not a precise moment, the logical
> dump is faster: `gunzip -c <dump>.sql.gz | docker exec -i nigerconnect-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`.

---

## Quarterly drill (do not skip)

A backup you've never restored is not a backup. Every ~3 months: spin a throwaway
container, restore the latest backup into it, run a couple of `SELECT count(*)`
sanity checks against known tables, then tear it down. Record the date + result.

---

## Out-of-band: things NOT in the database

These are needed to actually run the app after a restore and live outside Postgres
— back them up separately (they're already gitignored / VPS-only):
- `.env.prod` (all secrets/creds)
- JWT keys `*.pem`
- `acme*.json` (TLS certs — Traefik regenerates them, but handy)
- MinIO object data (user media) — has its own bucket; mirror it off-site too.

---

## Roadmap (next layer)

PITR covers *data loss*. For *availability* (the VPS itself dies), the next step
is a **hot standby**: a second Postgres on another VPS/region via streaming
replication (`max_wal_senders` is already provisioned), with manual promote — or
Patroni for auto-failover. See the architecture discussion; PITR is the
prerequisite and is done first on purpose.
