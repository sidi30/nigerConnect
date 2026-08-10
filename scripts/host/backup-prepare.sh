#!/usr/bin/env bash
#
# backup-prepare.sh — prépare une sauvegarde chiffrée de TOUT le VPS.
#
# Ce script ne décide de rien et n'envoie rien : il fabrique des archives
# chiffrées dans /opt/backups/outbox/<horodatage>/ et affiche le chemin. C'est
# le PC qui vient les CHERCHER (voir backup-pull.ps1), puis qui les efface ici.
#
# Pourquoi ce sens-là. Si le serveur poussait vers le PC, il détiendrait de quoi
# écrire chez toi : quiconque compromet le serveur effacerait aussi les copies,
# et tiendrait un pied dans ta machine personnelle. En tirant, le serveur ignore
# jusqu'à l'existence de ces copies.
#
# De même, le chiffrement n'utilise que la clé PUBLIQUE age : le serveur peut
# fabriquer les archives, il est incapable de les relire. La clé privée ne
# quitte jamais le PC.
#
# Ce qui est sauvegardé :
#   - toutes les bases PostgreSQL (pg_dumpall : données ET rôles)
#   - MongoDB (mongodump --archive --gzip)
#   - les secrets et fichiers de configuration : .env*, *.pem, acme*.json,
#     docker-compose*.yml, la config dynamique Traefik, /etc/cron.d, /opt/ops
#   - les médias : volumes MinIO et uploads
#
# Ce qui ne l'est PAS, volontairement : données Prometheus (6,7 Go, série
# temporelle reconstructible), modèles d'IA (6 Go, re-téléchargeables), caches.
# Une sauvegarde qui embarque du reconstructible finit par ne plus être faite.
#
# Usage : backup-prepare.sh <clé_publique_age>
#
set -uo pipefail

RECIPIENT="${1:-}"
if [ -z "$RECIPIENT" ]; then
  echo "ERREUR : clé publique age attendue en argument" >&2
  exit 2
fi

OUTBOX_ROOT="/opt/backups/outbox"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUTBOX_ROOT/$STAMP"
# Une archive chiffrée vide fait ~200 octets d'en-tête age. En dessous de ce
# seuil, le contenu était vide : on refuse de faire passer ça pour une
# sauvegarde.
MIN_BYTES=512
# Garde-fou médias : au-delà, c'est qu'un volume a changé de nature (modèles,
# index) et n'a rien à faire dans une sauvegarde quotidienne.
MEDIA_MAX_MB=2048

failures=0
log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
fail() { log "ECHEC : $*"; failures=$((failures + 1)); }

mkdir -p "$OUT"
chmod 700 "$OUTBOX_ROOT" "$OUT"

# Chiffre stdin vers $OUT/$1, puis vérifie que le résultat n'est pas creux.
# `pipefail` est indispensable ici : sans lui, un pg_dumpall qui échoue produit
# un flux vide qu'age chiffrerait sans broncher — une sauvegarde valide en
# apparence, inutile le jour venu.
encrypt_to() {
  local name="$1" dest="$OUT/$1"
  if ! age -r "$RECIPIENT" -o "$dest" ; then
    fail "chiffrement de $name"
    rm -f "$dest"
    return 1
  fi
  local size
  size="$(stat -c %s "$dest" 2>/dev/null || echo 0)"
  if [ "$size" -lt "$MIN_BYTES" ]; then
    fail "$name est vide ou tronqué (${size} octets)"
    rm -f "$dest"
    return 1
  fi
  chmod 600 "$dest"
  log "OK  $name ($(numfmt --to=iec "$size"))"
}

log "=== Sauvegarde $STAMP ==="

# ------------------------------------------------------------ PostgreSQL
# Sélection par IMAGE et non par nom : postgis et pgvector sont des Postgres,
# et un nom de conteneur ne garantit rien. Les exporters de métriques portent
# « postgres » dans leur image sans héberger la moindre base.
while IFS=$'\t' read -r name image; do
  case "$image" in
    *postgres*|*postgis*|*pgvector*) ;;
    *) continue ;;
  esac
  case "$name" in *exporter*) continue ;; esac

  # Le nom de l'image ne suffit pas : « umami:postgresql-latest » est une
  # APPLICATION qui parle à Postgres, pas un serveur Postgres. On exige la
  # présence conjointe de pg_dumpall et de POSTGRES_USER, qui ne coexistent
  # que dans un vrai conteneur de base.
  if ! docker exec "$name" sh -c 'command -v pg_dumpall >/dev/null && [ -n "${POSTGRES_USER:-}" ]' 2>/dev/null; then
    log "IGNORE $name : image trompeuse, ce n'est pas un serveur Postgres"
    continue
  fi

  # Le mot de passe et l'utilisateur restent DANS le conteneur : on n'expose
  # aucun secret sur notre ligne de commande, donc rien dans `ps` ni dans les
  # logs. pg_dumpall capture toutes les bases du cluster et les rôles.
  if docker exec "$name" sh -c 'pg_dumpall -U "$POSTGRES_USER"' 2>/dev/null \
      | gzip -9 \
      | encrypt_to "db-${name}.sql.gz.age"; then :; else
    fail "dump de $name"
  fi
done < <(docker ps --format '{{.Names}}\t{{.Image}}')

# --------------------------------------------------------------- MongoDB
while IFS=$'\t' read -r name image; do
  case "$image" in *mongo*) ;; *) continue ;; esac
  case "$name" in *express*|*exporter*) continue ;; esac

  if docker exec "$name" sh -c \
      'mongodump --archive --gzip -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' \
      2>/dev/null | encrypt_to "db-${name}.archive.gz.age"; then :; else
    fail "dump de $name"
  fi
done < <(docker ps --format '{{.Names}}\t{{.Image}}')

# ------------------------------------------------ secrets & configuration
# Le piège classique est de sauvegarder les bases en oubliant ceci : un dump
# sans .env.prod ni clés JWT ne permet PAS de remonter le service. On a les
# données et rien pour les servir.
#
# `-maxdepth 3` évite d'aspirer les node_modules et les .env d'exemple enfouis
# dans les dépendances, qui n'ont aucune valeur et pèsent des gigaoctets.
{
  find /opt/apps -maxdepth 3 \( -name '.env*' -o -name '*.pem' -o -name 'acme*.json' \
       -o -name 'docker-compose*.yml' -o -name '*service-account*.json' \) \
       -not -path '*/node_modules/*' -type f -print0 2>/dev/null
  find /opt/traefik/data -maxdepth 2 \( -name 'acme*.json' -o -name '*.yml' -o -name '*.yaml' \) -type f -print0 2>/dev/null
  find /etc/cron.d /opt/ops -maxdepth 1 -type f -print0 2>/dev/null
} | tar --null -czf - --files-from=- 2>/dev/null | encrypt_to "config-et-secrets.tar.gz.age" \
  || fail "archive des secrets"

# ---------------------------------------------------------------- médias
# Les photos publiées par les membres : contrairement au code, elles n'existent
# nulle part ailleurs. Elles sont assez petites (moins de 200 Mo au total) pour
# une passe quotidienne complète — pas besoin d'incrémental.
for vol in $(docker volume ls --format '{{.Name}}' | grep -iE 'minio|upload'); do
  dir="/var/lib/docker/volumes/${vol}/_data"
  [ -d "$dir" ] || continue
  # Un volume vide n'est pas un échec : il n'a simplement rien à sauvegarder.
  # Sans ce test, l'archive d'un dossier vide tomberait sous le seuil « creux »
  # et serait comptée comme une panne à chaque passe.
  if [ -z "$(find "$dir" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    log "IGNORE $vol : volume vide"
    continue
  fi
  size_mb=$(du -sm "$dir" 2>/dev/null | cut -f1)
  if [ "${size_mb:-0}" -gt "$MEDIA_MAX_MB" ]; then
    log "IGNORE $vol : ${size_mb} Mo, au-dessus du plafond ${MEDIA_MAX_MB} Mo"
    continue
  fi
  tar -czf - -C "$dir" . 2>/dev/null | encrypt_to "media-${vol}.tar.gz.age" \
    || fail "archive du volume $vol"
done

# -------------------------------------------------------------- manifeste
# Les empreintes servent au PC à prouver que le transfert est intact avant
# d'effacer quoi que ce soit ici.
( cd "$OUT" && sha256sum ./*.age > SHA256SUMS 2>/dev/null )
{
  echo "horodatage=$STAMP"
  echo "hote=$(hostname)"
  echo "destinataire_age=$RECIPIENT"
  echo "echecs=$failures"
  echo "fichiers=$(find "$OUT" -name '*.age' | wc -l)"
  echo "octets=$(du -sb "$OUT" | cut -f1)"
} > "$OUT/MANIFESTE"
chmod 600 "$OUT/SHA256SUMS" "$OUT/MANIFESTE"

# Rétention locale courte : ces archives sont un point de passage, pas un
# stockage. Deux jours laissent de quoi retenter un transfert raté.
find "$OUTBOX_ROOT" -maxdepth 1 -type d -name '20*' -mtime +2 -exec rm -rf {} + 2>/dev/null

log "=== $failures échec(s) — $(du -sh "$OUT" | cut -f1) dans $OUT ==="
# Le chemin sur stdout : c'est la seule sortie que le PC lit.
echo "$OUT"
[ "$failures" -eq 0 ]
