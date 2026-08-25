# Coffre d'archivage des pièces d'identité

Archivage intermédiaire (RGPD) des pièces d'identité vérifiées. Remplace la
destruction pure à 30 jours : la pièce quitte la base active, mais est scellée
chiffrée pour la durée de conservation annoncée dans la Politique de
confidentialité.

## Cycle de vie

```
dépôt → bucket privé (nigerconnect-private), base ACTIVE
  ├─ examinée (validée / rejetée)
  │    → 30 j après examen → scellée dans le coffre → retirée du bucket privé
  │       et de identity_documents
  │       ├─ validée : purge 5 ans après la SUPPRESSION DU COMPTE
  │       └─ rejetée : purge 1 an après le scellement
  └─ jamais examinée → détruite à 90 j, identityStatus remis à not_submitted
```

`users.identity_status` (le badge ✓) et la date de naissance servant au gate 18+
restent dans la base active : ouvrir le coffre n'est jamais nécessaire au
fonctionnement courant.

## Les trois barrières

| # | Barrière | Ce qu'elle arrête |
|---|----------|-------------------|
| 1 | Bucket dédié + compte de service `PutObject`/`DeleteObject` uniquement | Une API compromise ne peut pas *lire* le coffre |
| 2 | Chiffrement hybride AES-256-GCM + RSA-4096, clé privée **hors ligne** | Un root sur le VPS ne lit que du bruit |
| 3 | Object-lock GOVERNANCE jusqu'à `retain_until` | Une purge anticipée, accidentelle ou malveillante |

Mode GOVERNANCE et non COMPLIANCE : le verrou résiste au compte de service (qui
n'a pas `BypassGovernanceRetention`), mais laisse une porte de sortie avec les
identifiants d'administration MinIO — indispensable pour honorer une injonction
d'effacement.

## Format d'enveloppe `NCVAULT1`

```
magic(8) | u16 wrappedKeyLen | wrappedKey | iv(12) | tag(16) | ciphertext
ciphertext = AES-256-GCM( u32 metaLen | metaJson | octets du document )
AAD        = magic | userId
```

Les métadonnées (nom, email, date de naissance, type de pièce, décision) sont
**dans** le chiffré. `identity_archives` ne porte que des données non
identifiantes : uuid, `content_sha256`, taille, dates.

## Mise en service

1. **Générer la paire de clés** — sur ta machine, jamais sur le VPS :

   ```bash
   cd apps/api && npx ts-node scripts/vault-keygen.ts ./vault-keys
   ```

   `vault-private.pem` ne quitte JAMAIS la machine. Sauvegarde hors ligne
   obligatoire (clé USB chiffrée + copie physique). Perdre la clé privée ET sa
   sauvegarde rend le coffre définitivement illisible.

2. **Renseigner `.env.prod`** sur le VPS :

   ```
   S3_VAULT_BUCKET=nigerconnect-vault   # doit rester cette valeur :
   # infra/minio/vault-writer-policy.json nomme le bucket en dur (l'image mc
   # n'a pas sed pour substituer un placeholder).
   S3_VAULT_ACCESS_KEY=<20+ caractères aléatoires>
   S3_VAULT_SECRET_KEY=<40+ caractères aléatoires>
   IDENTITY_VAULT_PUBLIC_KEY=<sortie base64 de vault-keygen>
   ```

3. **Déployer.** `minio-init` crée le bucket `--with-lock`, coupe l'accès
   anonyme et crée le compte de service restreint. L'API log au démarrage
   `Identity vault ready: … (write-only, RSA-sealed)`.

Variables absentes ⇒ coffre désactivé : le cron retombe sur la destruction à 30
jours et le journalise. Ne jamais laisser la prod dans cet état une fois la
politique de confidentialité publiée.

## Ouvrir une pièce (break-glass)

Aucune route API, aucun écran d'administration. Depuis ta machine, avec un
tunnel vers MinIO :

```bash
ssh -L 19000:nigerconnect-minio:9000 root@46.224.193.109
# autre terminal
cd apps/api
DATABASE_URL=... S3_ENDPOINT=http://localhost:19000 \
S3_VAULT_BUCKET=nigerconnect-vault \
S3_ACCESS_KEY=<admin MinIO> S3_SECRET_KEY=<admin MinIO> \
npx ts-node scripts/vault-open.ts \
  --archive <archiveId> \
  --key ./vault-keys/vault-private.pem \
  --operator "prenom.nom@exemple.fr" \
  --reason "Réquisition judiciaire n°… du …" \
  --out ./sortie
```

Le script vérifie le sha256 contre `identity_archives.content_sha256`, écrit une
ligne dans `identity_archive_accesses` (opérateur, motif, horodatage) et pose les
fichiers en `0600`. **Supprimer la copie extraite** une fois la demande servie.

## Points de vigilance

- L'API tourne aujourd'hui avec les identifiants **root** MinIO
  (`S3_ACCESS_KEY: ${MINIO_ROOT_USER}`). Tant que c'est le cas, la barrière 1 est
  neutralisée : seul le chiffrement (barrière 2) protège le contenu. À corriger
  en donnant à l'API son propre compte de service limité aux buckets public et
  privé.
- Un objet scellé ne peut pas être raccourci : `extendRetention` n'allonge que.
- La purge est réessayée à chaque tour de cron tant que le verrou court.
