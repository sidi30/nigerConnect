# Restaurer depuis les sauvegardes

À lire le jour où ça va mal. Rien ici ne suppose que tu te souviennes de quoi
que ce soit.

## Avant tout : la clé

Les archives sont chiffrées avec `age`. La **clé privée** est le seul moyen de
les relire :

```
C:\Users\ramzi\.secrets\vps-backup-age.key
```

**Cette clé n'existe qu'à un seul endroit.** Si ce PC meurt en même temps que le
serveur, les sauvegardes deviennent un tas d'octets inutiles. Copie-la
maintenant sur une clé USB rangée ailleurs, ou dans un gestionnaire de mots de
passe. C'est un fichier de quelques lignes.

La clé **publique** — `age1ac6v2ud6mnh452p9u77zaqlxs3yv29j8s4n50kzzp6m0vtruy48qs2wage` —
n'est pas secrète : elle ne sait que chiffrer. C'est elle qui est écrite dans
les scripts, et c'est pour ça que le serveur ne peut pas relire ce qu'il
produit.

## Où sont les sauvegardes

`C:\Backups\vps\<AAAAMMJJ-HHMMSS>\`, un dossier par passe. Environ 180 Mo.

| Fichier | Contenu |
|---|---|
| `db-<conteneur>.sql.gz.age` | Un cluster PostgreSQL entier (`pg_dumpall` : bases **et** rôles) |
| `db-cs-platform-mongo.archive.gz.age` | MongoDB (`mongodump --archive`) |
| `config-et-secrets.tar.gz.age` | `.env*`, clés JWT `.pem`, `acme*.json`, fichiers Compose, config Traefik, crons |
| `media-<volume>.tar.gz.age` | Photos et fichiers déposés par les membres |
| `SHA256SUMS`, `MANIFESTE` | Empreintes et inventaire de la passe |

Un dossier marqué `INCOMPLET` ou `ECHEC` ne doit pas servir de référence :
prends le précédent.

## Déchiffrer un fichier

```powershell
age -d -i C:\Users\ramzi\.secrets\vps-backup-age.key `
    -o C:\Temp\dump.sql.gz `
    C:\Backups\vps\20260810-113659\db-nigerconnect-postgres.sql.gz.age
```

**Efface le fichier déchiffré après usage** : il contient les messages et les
positions de vraies personnes.

## Restaurer une base

Le dump est un `pg_dumpall`, donc il recrée les bases et les rôles tout seul. Il
se rejoue dans un cluster **vide** :

```powershell
docker run -d --name restauration -e POSTGRES_PASSWORD=temporaire postgis/postgis:16-3.4-alpine
docker cp C:\Temp\dump.sql.gz restauration:/tmp/
docker exec restauration sh -c "gunzip -c /tmp/dump.sql.gz | psql -U postgres"
docker exec restauration psql -U postgres -d nigerconnect -c "select count(*) from users;"
```

Les erreurs `database "template_postgis" already exists` et `schema "tiger"
already exists` sont **normales** : l'image PostGIS crée déjà ces objets.
Toute autre erreur mérite un regard.

Pour réinjecter en production, même principe en visant le conteneur réel — mais
arrête d'abord l'API, sinon elle écrit pendant que tu restaures.

## Reconstruire tout le VPS depuis zéro

C'est le scénario qui remplace un serveur de secours. Compter environ une heure.

1. **Machine neuve** chez l'hébergeur, Docker installé.
2. **Secrets et configuration** : déchiffre `config-et-secrets.tar.gz.age` et
   remets les fichiers à leur place (`/opt/apps/<projet>/.env.prod`, les `.pem`,
   `/opt/traefik/data/`). Sans eux, les dumps ne servent à rien : tu aurais les
   données et rien pour les servir.
3. **Code** : `git clone` des dépôts. Le code n'est pas dans les sauvegardes,
   il est sur GitHub — sauf pour les projets qui n'y sont pas encore.
4. **Bases** : un conteneur Postgres par projet, puis rejouer chaque dump.
5. **Médias** : déballer les `media-*.tar.gz.age` dans les volumes
   correspondants avant de démarrer les applications.
6. **DNS** : faire pointer les enregistrements vers la nouvelle IP.
7. **Sauvegardes** : réinstaller `/opt/ops/` (voir `README.md`) et refaire une
   passe immédiatement.

## Vérifications à faire de temps en temps

- **Une restauration à blanc par trimestre.** Une sauvegarde jamais restaurée
  est une hypothèse, pas une sauvegarde. La procédure ci-dessus prend dix
  minutes et c'est le seul moyen de savoir.
- **La bannière du Bureau.** Un fichier `SAUVEGARDE-VPS-EN-RETARD.txt` apparaît
  si aucune passe n'a réussi depuis 48 h, et disparaît tout seul ensuite.
- **Le journal** : `C:\Backups\vps\backup.log`.

## Relancer une passe à la main

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\ramzi\.ops\backup-pull.ps1
```
