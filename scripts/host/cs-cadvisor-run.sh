#!/usr/bin/env bash
#
# cs-cadvisor-run.sh — recrée le cAdvisor de CyberSensei tel qu'il doit tourner.
#
# Ce conteneur appartient à un AUTRE projet que NigerConnect, et il a été créé
# à la main (`docker run`, pas de fichier Compose). Ce script existe pour que la
# configuration ci-dessous ne se perde pas : sans lui, un `docker run` d'origine
# relancé un jour ramènerait le problème.
#
# Le problème, mesuré : 38,3 % d'un cœur en permanence et 1,14 Go de mémoire
# sans aucune limite, pour surveiller un projet. Après correction : 5,6 % et
# 46 Mo. La charge de la machine est passée de 2,5 à 1,4.
#
# La cause n'était ni la cadence ni le nombre de métriques — j'ai essayé les
# deux, et la seconde tentative a même AGGRAVÉ les choses. C'était
# `--store_container_labels`, actif par défaut : cAdvisor recopie sur CHAQUE
# série l'union des étiquettes Docker de TOUS les conteneurs de l'hôte. Avec 61
# conteneurs dont beaucoup portent des règles Traefik, cela faisait environ 200
# étiquettes — presque toutes vides — collées à 7 000 séries, à reconstruire et
# à sérialiser à chaque scrape.
#
# Les deux étiquettes réellement porteuses de sens sont conservées via
# --whitelisted_container_labels ; `name` et `image` ne sont pas concernés par
# ce réglage et restent présents.
#
set -euo pipefail

docker rm -f cs-cadvisor >/dev/null 2>&1 || true

docker run -d \
  --name cs-cadvisor \
  --restart unless-stopped \
  --network cs-monitoring \
  --memory 1536m --memory-swap 1536m --cpus 1 \
  -v /:/rootfs:ro \
  -v /sys:/sys:ro \
  -v /var/lib/docker:/var/lib/docker:ro \
  -v /var/run:/var/run:ro \
  gcr.io/cadvisor/cadvisor:latest \
  -logtostderr \
  --housekeeping_interval=10s \
  --store_container_labels=false \
  --whitelisted_container_labels=com.docker.compose.project,com.docker.compose.service \
  --disable_metrics=percpu,sched,tcp,udp,advtcp,process,hugetlb,referenced_memory,cpu_topology,resctrl,memory_numa

echo "cs-cadvisor recréé. Vérifier la cible dans les 30 s :"
echo "  docker exec cs-prometheus wget -qO- 'http://localhost:9090/api/v1/query?query=up{job=\"cadvisor\"}'"
