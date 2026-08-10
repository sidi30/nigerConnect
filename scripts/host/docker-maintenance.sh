#!/usr/bin/env bash
#
# docker-maintenance.sh — ménage disque périodique de l'hôte Docker.
#
# L'hôte est PARTAGÉ entre une douzaine de projets sans rapport. Ce script ne
# supprime donc que ce qui est reconstructible sans perte :
#
#   1. le cache de build BuildKit    (se régénère au prochain build)
#   2. les images « dangling »       (sans tag, plus référencées)
#   3. les tags de rollback périmés  (rollback-*/backup-*, hors service)
#   4. les journaux systemd en trop  (vacuum, pas de changement de config)
#   5. le cache apt                  (re-téléchargeable)
#
# Ce qu'il ne supprime JAMAIS, et pourquoi :
#
#   - `docker image prune -a` : sur cet hôte les images applicatives sont
#     construites localement et ne vivent dans AUCUN registre. Une image dont
#     le conteneur est simplement arrêté serait détruite définitivement et le
#     projet ne redémarrerait plus. On se limite aux images sans tag.
#   - `docker volume prune` : des volumes non montés contiennent des données
#     bien réelles (vus sur cet hôte : postgres NounouTime, vaultwarden…).
#     Les volumes inutilisés sont SIGNALÉS, jamais supprimés.
#   - les conteneurs arrêtés : signalés aussi. Certains sont arrêtés exprès.
#
# Usage :
#   docker-maintenance.sh [--dry-run]
#
# Réglages (variables d'environnement) :
#   BUILD_CACHE_MAX_GB   plafond du cache de build en Go       (défaut 20)
#   AGGRESSIVE_MAX_GB    plafond si le disque est sous tension (défaut 8)
#   TAG_MAX_AGE_DAYS     âge des tags rollback-* à purger      (défaut 7)
#   JOURNAL_MAX          plafond des journaux systemd          (défaut 300M)
#   DISK_HIGH_PCT        seuil de passage en mode agressif     (défaut 80)
#
set -uo pipefail

BUILD_CACHE_MAX_GB="${BUILD_CACHE_MAX_GB:-20}"
AGGRESSIVE_MAX_GB="${AGGRESSIVE_MAX_GB:-8}"
TAG_MAX_AGE_DAYS="${TAG_MAX_AGE_DAYS:-7}"
JOURNAL_MAX="${JOURNAL_MAX:-300M}"
DISK_HIGH_PCT="${DISK_HIGH_PCT:-80}"
LOCK_FILE="${LOCK_FILE:-/var/lock/docker-maintenance.lock}"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
run() {
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY-RUN  $*"
  else
    "$@"
  fi
}

disk_pct() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
disk_used() { df -h --output=used / | tail -1 | tr -d ' '; }

# Un déploiement en cours build peut-être ; le prune BuildKit épargne de toute
# façon les enregistrements actifs. Le verrou n'existe que pour éviter deux
# passes concurrentes (cron + lancement manuel).
exec 9>"$LOCK_FILE" 2>/dev/null || true
if ! flock -n 9; then
  log "ABANDON : une autre passe est déjà en cours"
  exit 0
fi

log "=========================================================="
log "Ménage Docker — début$([ "$DRY_RUN" = 1 ] && echo ' (DRY-RUN)')"
before_pct="$(disk_pct)"
log "Disque avant : $(disk_used) utilisés — ${before_pct}%"
docker system df 2>/dev/null | sed 's/^/    /'

# ---------------------------------------------------------------- 1. cache
# On borne le cache par TAILLE, pas par âge : `--filter until=72h` n'évince
# rien ici (BuildKit sous containerd rafraîchit les dates d'usage), alors que
# le cache regrossit de plusieurs dizaines de Go par semaine. `--max-used-space`
# garde les entrées les plus récemment utilisées et jette le reste, ce qui
# plafonne la croissance au lieu de courir après.
# Le flag veut des OCTETS BRUTS : « 20GB » est accepté sans erreur et ne fait
# rien du tout. Ne pas « simplifier » en remettant un suffixe.
max_gb="$BUILD_CACHE_MAX_GB"
if [ "$before_pct" -ge "$DISK_HIGH_PCT" ]; then
  max_gb="$AGGRESSIVE_MAX_GB"
  log "ALERTE : disque à ${before_pct}% (seuil ${DISK_HIGH_PCT}%) — plafond abaissé à ${max_gb} Go"
fi
log "-- Cache de build : plafond ${max_gb} Go"
run docker builder prune -f --max-used-space "$((max_gb * 1000000000))" 2>&1 | tail -1 | sed 's/^/    /'

# ------------------------------------------------------- 2. images dangling
log "-- Images sans tag"
run docker image prune -f 2>&1 | sed 's/^/    /'

# ------------------------------------------------- 3. tags rollback périmés
# Les déploiements taguent l'image sortante (rollback-xxx) pour pouvoir revenir
# en arrière. Passé une semaine, ce filet ne sert plus à rien.
log "-- Tags de rollback de plus de ${TAG_MAX_AGE_DAYS} jours"
cutoff=$(( $(date +%s) - TAG_MAX_AGE_DAYS * 86400 ))
in_use="$(docker ps -aq | xargs -r docker inspect -f '{{.Image}}' 2>/dev/null | sort -u)"
freed_tags=0
while read -r ref; do
  [ -n "$ref" ] || continue
  case "$ref" in
    *:rollback-*|*:backup-*|*:pre-*) ;;
    *) continue ;;
  esac
  id="$(docker inspect -f '{{.Id}}' "$ref" 2>/dev/null)" || continue
  # Une image encore montée par un conteneur ne se touche pas, quel que soit
  # son âge : le tag est peut-être vieux, le service tourne quand même.
  if printf '%s\n' "$in_use" | grep -qxF "$id"; then
    log "    gardé (en service) : $ref"
    continue
  fi
  created="$(docker inspect -f '{{.Created}}' "$ref" 2>/dev/null)"
  created_epoch="$(date -d "$created" +%s 2>/dev/null)" || continue
  if [ "$created_epoch" -lt "$cutoff" ]; then
    log "    suppression : $ref"
    run docker rmi "$ref" >/dev/null 2>&1
    freed_tags=$((freed_tags + 1))
  fi
done < <(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -v '<none>')
log "    ${freed_tags} tag(s) retiré(s)"

# ------------------------------------------------------------- 4. journaux
log "-- Journaux systemd (plafond ${JOURNAL_MAX})"
run journalctl --vacuum-size="$JOURNAL_MAX" 2>&1 | tail -2 | sed 's/^/    /'

# ----------------------------------------------------------- 5. cache apt
log "-- Cache apt"
run apt-get clean 2>&1 | sed 's/^/    /'

# --------------------------------------------------- 6. signalements seuls
unused_vol="$(docker volume ls -qf dangling=true 2>/dev/null | wc -l)"
if [ "$unused_vol" -gt 0 ]; then
  log "-- $unused_vol volume(s) non monté(s) — NON supprimés (données possibles) :"
  docker volume ls -qf dangling=true | sed 's/^/       /'
fi
stopped="$(docker ps -aq -f status=exited 2>/dev/null | wc -l)"
[ "$stopped" -gt 0 ] && log "-- $stopped conteneur(s) arrêté(s) — NON supprimés"

# ------------------------------------------------------------------ bilan
after_pct="$(disk_pct)"
log "Disque après : $(disk_used) utilisés — ${after_pct}% (avant ${before_pct}%)"
docker system df 2>/dev/null | sed 's/^/    /'
if [ "$after_pct" -ge "$DISK_HIGH_PCT" ]; then
  log "ATTENTION : le disque reste à ${after_pct}% après ménage — inspection manuelle nécessaire"
fi
log "Ménage Docker — fin"
