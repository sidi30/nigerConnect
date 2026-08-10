# Maintenance de l'hôte

Ces fichiers ne concernent pas NigerConnect en particulier : ils s'appliquent à
**tout le VPS**, partagé par une douzaine de projets. Ils sont versionnés ici
parce qu'il faut bien qu'ils vivent quelque part.

| Fichier | Destination |
|---|---|
| `docker-maintenance.sh` | VPS : `/opt/ops/docker-maintenance.sh` |
| `cron-docker-maintenance` | VPS : `/etc/cron.d/docker-maintenance` |
| `logrotate-docker-maintenance` | VPS : `/etc/logrotate.d/docker-maintenance` |
| `backup-prepare.sh` | VPS : `/opt/ops/backup-prepare.sh` |
| `backup-pull.ps1` | PC : `C:\Users\ramzi\.ops\backup-pull.ps1` |
| `RESTAURATION.md` | à lire le jour où ça va mal |

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

# Sauvegarde hors site vers le PC

Une copie chiffrée de tout le VPS atterrit chaque jour sur le poste de travail.
Jusqu'ici les sauvegardes dormaient sur le disque qu'elles protégeaient.

**C'est le PC qui tire, jamais le serveur qui pousse.** Si le serveur poussait,
il détiendrait de quoi écrire sur le poste : quiconque le compromet effacerait
aussi les copies et prendrait pied sur la machine personnelle. En tirant, le
serveur ignore jusqu'à l'existence de ces copies.

Le chiffrement suit la même logique : le VPS ne connaît que la clé **publique**
`age`. Il fabrique des archives qu'il est lui-même incapable de relire.

Contenu d'une passe (~180 Mo) : 8 clusters PostgreSQL (`pg_dumpall`, données et
rôles), MongoDB, les secrets et fichiers Compose, les médias MinIO. Sont
volontairement exclus les 6,7 Go de données Prometheus et les 6 Go de modèles
d'IA — reconstructibles, et une sauvegarde qui embarque du reconstructible finit
par ne plus être faite.

Détection par **image** et non par nom de conteneur : `postgis` et `pgvector`
sont des Postgres. Avec un double garde-fou, parce que `umami:postgresql-latest`
est une application et non un serveur de base — on exige `pg_dumpall` **et**
`POSTGRES_USER`.

Le PC vérifie chaque empreinte SHA-256 avant d'effacer la copie distante, seul
moment où les deux existent. Rétention grand-père/père/fils : 14 jours, puis une
par semaine sur 8 semaines, puis une par mois sur 12 mois.

Tâche planifiée quotidienne à 12h30, rattrapée si le PC était éteint. Une
bannière apparaît sur le Bureau si aucune passe n'a réussi depuis 48 h.

Installation côté PC :

```powershell
Copy-Item scripts\host\backup-pull.ps1 C:\Users\ramzi\.ops\ -Force
```

**Restauration : voir `RESTAURATION.md`.** La clé privée
(`C:\Users\ramzi\.secrets\vps-backup-age.key`) n'existe qu'à un seul endroit —
en garder une copie hors de ce PC, sinon les archives sont illisibles.
