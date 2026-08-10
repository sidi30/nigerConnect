# Maintenance de l'hôte

Ces fichiers ne concernent pas NigerConnect en particulier : ils s'appliquent à
**tout le VPS**, partagé par une douzaine de projets. Ils sont versionnés ici
parce qu'il faut bien qu'ils vivent quelque part.

| Fichier | Destination sur l'hôte |
|---|---|
| `docker-maintenance.sh` | `/opt/ops/docker-maintenance.sh` |
| `cron-docker-maintenance` | `/etc/cron.d/docker-maintenance` |
| `logrotate-docker-maintenance` | `/etc/logrotate.d/docker-maintenance` |

## Installation / mise à jour

```bash
ssh root@46.224.193.109 'mkdir -p /opt/ops'
sed 's/\r$//' scripts/host/docker-maintenance.sh | ssh root@46.224.193.109 \
  'cat > /opt/ops/docker-maintenance.sh && chmod +x /opt/ops/docker-maintenance.sh'
sed 's/\r$//' scripts/host/cron-docker-maintenance | ssh root@46.224.193.109 \
  'cat > /etc/cron.d/docker-maintenance && chmod 644 /etc/cron.d/docker-maintenance'
sed 's/\r$//' scripts/host/logrotate-docker-maintenance | ssh root@46.224.193.109 \
  'cat > /etc/logrotate.d/docker-maintenance && chmod 644 /etc/logrotate.d/docker-maintenance'
```

Le `sed` retire les CRLF : les fichiers sont édités sous Windows et cron refuse
silencieusement une ligne terminée par `\r`.

## Exploitation

```bash
# voir ce qui serait fait, sans rien toucher
ssh root@46.224.193.109 '/opt/ops/docker-maintenance.sh --dry-run'

# passe immédiate
ssh root@46.224.193.109 '/opt/ops/docker-maintenance.sh'

# historique
ssh root@46.224.193.109 'tail -60 /var/log/docker-maintenance.log'
```

## Ce qui a motivé les réglages

Le poste de dépense n'était pas les images (une seule sans tag) mais le **cache
de build BuildKit** : 93 Go, remontés à ce niveau en trois jours après une
purge manuelle. D'où deux choix qui ne sont pas évidents à la lecture :

- **plafond en taille, pas en âge.** `--filter until=72h` n'évinçait rien du
  tout sur cet hôte. `--max-used-space` garde les entrées les plus récemment
  utilisées et jette le reste, donc la croissance est bornée par construction.
- **le flag veut des octets bruts.** `--max-used-space 20GB` est accepté sans
  la moindre erreur et ne libère rien. Le script calcule les octets lui-même.

Première passe : 158 Go → 92 Go (55 % → 32 %), 64 conteneurs toujours debout.
