#!/usr/bin/env bash
#
# backup-mark-success.sh — date la dernière sauvegarde hors site VÉRIFIÉE.
#
# Appelé par le PC (backup-pull.ps1) une fois les empreintes SHA-256 contrôlées,
# jamais par le serveur lui-même. La nuance est le cœur de l'alerte : si le
# serveur datait la métrique en fabriquant les archives, un transfert qui échoue
# en boucle laisserait un indicateur parfaitement vert et personne ne serait
# prévenu.
#
# node-exporter publie ce fichier, Prometheus évalue `SauvegardeEnRetard` et
# Alertmanager envoie un email au-delà de 48 h.
#
# Ce script existe pour une raison prosaïque : la même chose écrite en une ligne
# depuis PowerShell traversait deux niveaux de guillemets et finissait en
# « syntax error: unexpected end of file ». Une ligne de commande qui doit être
# échappée deux fois est une ligne de commande à mettre dans un fichier.
#
set -euo pipefail

DIR="${TEXTFILE_DIR:-/var/lib/node-exporter/textfile}"
METRIC="nigerconnect_backup_last_success_timestamp_seconds"

mkdir -p "$DIR"

# Écriture puis renommage : node-exporter lit ce dossier en continu et ne doit
# jamais tomber sur un fichier à moitié écrit.
TMP="$DIR/.$$.tmp"
{
  echo "# HELP $METRIC Horodatage de la derniere sauvegarde hors site verifiee."
  echo "# TYPE $METRIC gauge"
  echo "$METRIC $(date +%s)"
} > "$TMP"
mv -f "$TMP" "$DIR/backup.prom"
chmod 644 "$DIR/backup.prom"

echo "ok $(date -u +%Y-%m-%dT%H:%M:%SZ)"
