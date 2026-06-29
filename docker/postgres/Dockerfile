# Postgres 16 + PostGIS + pgBackRest — for off-site Point-In-Time Recovery.
#
# Same base as the stock prod DB (postgis/postgis:16-3.4-alpine) so the data
# directory format is identical; we only add the pgBackRest binary so Postgres'
# archive_command can stream WAL to an S3-compatible repo (Backblaze B2 /
# Cloudflare R2 / AWS S3), and so backup/restore commands are available via
# `docker exec`. All pgBackRest config is provided at runtime via PGBACKREST_*
# environment variables (see docker-compose.pitr.yml + .env.prod) — no secrets
# baked into the image.
FROM postgis/postgis:16-3.4-alpine

RUN apk add --no-cache pgbackrest \
    && mkdir -p /var/log/pgbackrest /var/lib/pgbackrest \
    && chown -R postgres:postgres /var/log/pgbackrest /var/lib/pgbackrest
