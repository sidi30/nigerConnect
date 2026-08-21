# ADR-002 — Médias portés par une association

**Statut :** `ACCEPTED` (2026-08-21)
**Date :** 2026-08-21
**Backlog :** Sprint 2 « L'association publie depuis un ordinateur », item **B2**. Bloque `B3` (publications) et `B5` (quota).
**Périmètre :** `apps/api` (stockage, association, feed). Aucune décision mobile. Aucun code de production produit par cet ADR.

---

## 1. Le problème, tel qu'il est écrit dans le code

Toute la sécurité des médias tient aujourd'hui à une convention de nommage qui
**s'auto-autorise** : la clé d'un objet public commence par `users/{userId}/`, et
`assertOwnedPublicImage` (`apps/api/src/common/storage/s3.service.ts:243`) refuse tout ce qui
ne vit pas sous le préfixe de l'appelant :

```ts
if (ownerId && !key.startsWith(`users/${ownerId}/`)) {
  throw new BadRequestException('Media does not belong to you');
}
```

Aucune autorisation n'est nécessaire au moment de la signature de l'upload : personne d'autre
que vous ne peut être sous votre préfixe, donc le préfixe **est** la preuve.

Une association casse cette propriété. Son logo, sa bannière, les images de ses publications
n'appartiennent à personne en particulier : ils appartiennent à l'entité, et **plusieurs
dirigeants** doivent pouvoir les déposer. Le préfixe cesse d'être auto-autorisant.

C'est déjà visible : `association.service.ts:116` lie le logo à l'utilisateur qui crée
l'association. Le fichier vit donc sous `users/{fondateur}/`. Si ce fondateur quitte
l'association — ou supprime son compte, ce que A2 rend maintenant possible sans détruire
l'association — le logo de l'association reste rangé dans l'espace personnel de quelqu'un qui
n'en fait plus partie. Et un second dirigeant ne peut pas remplacer ce logo par un fichier
qu'il aurait, lui, déposé.

## 2. Ce qu'on décide

**Les médias d'une association vivent sous `associations/{associationId}/`, et
l'autorisation se déplace du préfixe vers le rôle — vérifié DEUX fois : à la signature
de l'upload, et au moment de l'attache.**

### 2.1 Ne pas contourner la garde, la paramétrer

Le socle existe déjà et n'a pas besoin d'être écrit :
`assertOwnedPublicMedia(url, expectedMediaType, requiredPrefix)`
(`s3.service.ts:291`) généralise l'appartenance à un préfixe arbitraire, confronte le
type déclaré par le client au vrai `Content-Type` de l'objet, et sa variante
`assertOwnedPublicMediaDetailed` rend la taille en octets — ce dont B5 a besoin pour compter.

Les chemins association appellent donc cette fonction avec
`requiredPrefix = 'associations/' + associationId + '/'`. **Aucune** dérogation à
`assertOwnedPublicImage`, aucun chemin qui persiste une URL client sans passer par une garde.

### 2.2 L'autorisation à la signature, pas seulement à l'attache

Puisque le préfixe ne prouve plus rien, l'endpoint qui signe l'upload doit vérifier le rôle
**avant** de délivrer l'URL : `assertRole(associationId, userId, ['admin', 'owner'])`, la même
garde que les autres mutations d'association. C'est la pratique déjà en vigueur pour la vidéo,
où `posts.service.ts:195-208` refuse l'URL signée à un utilisateur qui a épuisé son quota,
plutôt que de le laisser téléverser pour rien.

Sans cette vérification, n'importe quel inscrit obtiendrait une URL signée sur le préfixe
d'une association dont il n'est pas dirigeant, et pourrait y déposer ce qu'il veut : un
fichier orphelin, jamais attaché, mais stocké sur notre disque et servi par le CDN.

### 2.3 Conséquences assumées

- **Un objet déposé reste attachable par les dirigeants suivants.** Le fichier appartient à
  l'association, pas à celui qui l'a déposé. Un dirigeant rétrogradé ne peut plus rien déposer
  ni attacher, mais ce qu'il avait déposé reste utilisable par le bureau. C'est le
  comportement voulu : sinon un départ effacerait la bannière de l'association.
- **Le cloisonnement entre associations reste strict.** Le préfixe porte l'identifiant de
  l'association : attacher le média de l'association A à l'association B échoue, comme
  attacher le média d'un autre utilisateur échoue aujourd'hui.
- **La suppression doit purger.** A2 introduit `deletedAt` sur `associations`. La purge des
  objets sous `associations/{id}/` suit la suppression définitive, pas le soft-delete — le
  chat le fait déjà à la suppression d'un message.

## 3. Ce qu'on ne fait pas, et pourquoi

- **Pas de bucket par association.** MinIO en supporterait beaucoup, mais chaque bucket est un
  objet d'administration (politique, cycle de vie, sauvegarde) pour un gain nul : le préfixe
  suffit à cloisonner puisque l'API est seule à signer les accès.
- **Pas de table de propriété des objets.** Le préfixe EST la propriété. Une table en doublon
  divergerait le jour où un objet est déposé sans être attaché.
- **Pas de recomptage par listage S3 pour le quota (B5).** Lister le préfixe d'une association
  coûte un appel par tranche de 1000 objets à chaque vérification. Le compteur d'octets est
  tenu en base au moment de l'attache — `assertOwnedPublicMediaDetailed` rend déjà la taille —
  et décrémenté à la suppression. C'est le modèle déjà retenu pour la vidéo.

## 4. Effets sur le reste du sprint

- **B3** peut être écrit : les publications d'association attachent leurs médias par
  `assertOwnedPublicMedia(url, kind, 'associations/{id}/')`.
- **B5** a sa source de vérité : les octets comptés à l'attache, par association.
- La **vidéo** d'association reste inerte tant que le kill-switch `video_enabled` est OFF.
  Cet ADR ne le touche pas.

## 5. Migration de l'existant

Une seule association existe en production, et son logo est vide. Il n'y a donc **rien à
déplacer**. La bascule est un changement de code, pas une migration de données : les
nouveaux dépôts vont sous `associations/{id}/`, les rares objets historiques sous
`users/{id}/` restent lisibles (l'URL persistée reste valide) et seront remplacés au premier
changement de logo.
