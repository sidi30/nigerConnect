# Réalisations — mettre en avant ce que les Nigériens ont bâti

> Spécification de conception. Rédigée le 20/08/2026, **avant** implémentation.
> La construction est volontairement différée : cette fonctionnalité touche les
> pages d'association et la carte, exactement le périmètre du chantier « espace
> association » en cours. Deux chantiers sur les mêmes écrans = une fusion
> douloureuse et du travail jeté.

## Le besoin

Rendre visibles les entreprises, projets et festivals créés par des Nigériens,
là où ils existent dans le monde. Exemple donné par le propriétaire :
*Lingeserein* — logo, lien du site, description, fondateur, et les villes et
pays où l'entreprise est présente.

Ce n'est pas un annuaire administratif. C'est une vitrine : un membre à Niamey
doit pouvoir découvrir ce que des compatriotes ont bâti à Istanbul, et en tirer
de la fierté ou une idée.

## Une entité, pas trois

Entreprise, projet et festival ont la même forme : un nom, un logo, une
description, un fondateur, un lien, un ou plusieurs lieux. Trois tables
tripleraient le travail, découperaient la carte en trois couches et
obligeraient à réécrire trois fois la modération.

Une seule table, avec un `kind` qui ne pilote que la couleur du marqueur et le
libellé affiché.

```prisma
enum RealisationKind {
  entreprise
  projet
  festival
  oeuvre      // livre, film, musique, artisanat
  autre
}

enum RealisationStatus {
  pending     // soumise, invisible
  published   // validée, visible partout
  rejected    // refusée, motif conservé
  archived    // n'existe plus (entreprise fermée, festival passé)
}

model Realisation {
  id          String            @id @default(uuid()) @db.Uuid
  kind        RealisationKind
  status      RealisationStatus @default(pending)
  name        String            @db.VarChar(200)
  description String            @db.Text
  logoUrl     String?           @map("logo_url") @db.VarChar(500)
  website     String?           @db.VarChar(300)

  /// Fondateur en TEXTE : la plupart des personnes citées ne sont pas encore
  /// membres. C'est la valeur affichée par défaut.
  founderName String            @map("founder_name") @db.VarChar(200)
  /// Lien vers un compte, UNIQUEMENT après acceptation de la personne
  /// concernée (voir « Le fondateur »). Null tant qu'elle n'a rien accepté.
  founderUserId String?         @map("founder_user_id") @db.Uuid
  founderUser   User?           @relation(fields: [founderUserId], references: [id], onDelete: SetNull)

  /// Qui a proposé la fiche. Sert à prévenir en cas de refus, et à repérer
  /// quelqu'un qui inonderait la file de modération.
  submittedById String          @map("submitted_by") @db.Uuid
  submittedBy   User            @relation("RealisationSubmitter", fields: [submittedById], references: [id])

  reviewedById  String?         @map("reviewed_by") @db.Uuid
  reviewedAt    DateTime?       @map("reviewed_at") @db.Timestamptz
  rejectionReason String?       @map("rejection_reason") @db.VarChar(500)

  createdAt   DateTime          @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime          @updatedAt @map("updated_at") @db.Timestamptz
  deletedAt   DateTime?         @map("deleted_at") @db.Timestamptz

  locations   RealisationLocation[]

  @@index([status, kind])
  @@map("realisations")
}

model RealisationLocation {
  id            String      @id @default(uuid()) @db.Uuid
  realisationId String      @map("realisation_id") @db.Uuid
  realisation   Realisation @relation(fields: [realisationId], references: [id], onDelete: Cascade)
  city          String      @db.VarChar(100)
  countryCode   String      @map("country_code") @db.Char(2)
  lat           Float
  lon           Float
  /// Le siège, par opposition à une antenne. Sert à choisir UNE position quand
  /// il n'en faut qu'une (résultat de recherche, aperçu sur une page).
  isPrimary     Boolean     @default(false) @map("is_primary")

  @@unique([realisationId, city, countryCode])
  @@index([countryCode, city])
  @@map("realisation_locations")
}
```

## Le piège du multi-lieu

Une entreprise présente à Niamey, Paris et Istanbul vaut **trois épingles pour
une entité**. C'est voulu au zoom fin — on veut la voir dans chaque ville.

Mais au dézoom, `getMarkers` agrège en clusters pays puis ville. Compter
naïvement les lignes de `realisation_locations` ferait apparaître Lingeserein
trois fois dans « 12 réalisations en Europe ». Le compteur mentirait, et c'est
précisément le chiffre que les gens lisent.

**Règle : au niveau cluster, on compte des `realisationId` DISTINCTS, pas des
lignes de lieux.** À écrire dans le test avant le code.

## Insertion dans la carte existante

La carte sait déjà faire des couches : `boundsSchema` accepte
`type: 'all' | 'people' | 'associations'` (`apps/api/src/geo/dto/`), et
`getMarkers` branche sur `dto.zoom` (< 4 → pays, < 7 → villes, sinon
individuel), avec cache Redis.

Ajouter `realisations` à cet `enum` et une branche dans `getMarkers` suit le
moule en place. Le type `MapMarker` (`apps/mobile/services/geoApi.ts`) est une
union discriminée par `kind` — on y ajoute une variante :

```ts
| {
    kind: 'realisation';
    realisationId: string;
    name: string;
    realisationKind: 'entreprise' | 'projet' | 'festival' | 'oeuvre' | 'autre';
    logoUrl: string | null;
    city: string;
    countryCode: string;
    lat: number;
    lon: number;
    /** Plusieurs implantations : le marqueur le dit, sinon on croit à un doublon. */
    locationCount: number;
  }
```

Côté mobile, Android rend la carte dans une WebView Leaflet et iOS en natif
(`USE_NATIVE_MAP = Platform.OS === 'ios'`) : **les deux chemins doivent être
traités**, sinon la couche n'existe que sur un des deux systèmes. C'est une
erreur facile à commettre et invisible en revue de code.

## Le fondateur

Le champ affiché est `founderName`, du texte libre. La plupart des personnes
citées ne sont pas membres de NigerConnect, et attendre qu'elles s'inscrivent
viderait l'annuaire.

Le lien vers un compte (`founderUserId`) est un **bonus qui exige un
consentement explicite**. On ne rattache jamais le compte de quelqu'un à une
fiche publique sans son accord : les comptes peuvent être `private`, et la
règle de confidentialité du projet interdit qu'un compte privé fuite par une
autre surface. Le parcours est donc : la fiche cite un nom → la personne
concernée reçoit une demande de rattachement → elle accepte ou refuse.

Tant qu'elle n'a rien accepté, la fiche n'affiche aucun lien cliquable vers un
profil.

## Modération : soumission libre, publication après validation

Décision du propriétaire, 20/08/2026.

N'importe quel membre peut proposer une fiche — la sienne ou celle d'un
compatriote qu'il veut mettre en avant. Elle reste en `pending`, **invisible
partout** (carte, recherche, pages d'association), tant qu'un administrateur ou
un dirigeant d'association du pays concerné ne l'a pas validée.

Les deux échecs qu'on évite, et ils sont opposés :

- **trop ouvert** → faux commerces, attributions mensongères, spam ; sur un
  réseau communautaire la crédibilité ne se récupère pas ;
- **trop fermé** → annuaire vide, fonctionnalité morte en trois semaines.

Ce que ça réutilise, plutôt que de le réinventer : la file de modération et les
rôles d'association construits par les deux chantiers en cours. Ne pas démarrer
avant qu'ils aient atterri.

Un refus doit porter un motif et être notifié à celui qui a proposé — sinon il
recommence, et la file se remplit deux fois.

## Où ça s'affiche

Une seule source de données, trois surfaces :

1. **La carte**, couche filtrable, à côté des personnes et des associations.
2. **Les pages d'association**, section « Les réalisations de nos compatriotes
   ici » — filtrée sur le pays, et la ville de l'association.
3. **Le site public généré** par une association (chantier en cours) peut la
   reprendre : c'est le contenu le plus partageable de la plateforme.

## Points ouverts, à trancher au moment de construire

1. **Qui met à jour une fiche dans le temps ?** Une entreprise déménage, un
   festival change de date. Sans propriétaire de la fiche, l'annuaire pourrit
   en un an. Piste : le fondateur rattaché devient éditeur de sa fiche.
2. **Que devient une fiche dont l'entreprise ferme ?** D'où `archived` —
   mais qui le déclare ?
3. **Faut-il une preuve pour le lien du site ?** Un lien vers un site qui n'a
   rien à voir est le premier abus qui viendra.
4. **Le logo passe par quelle clé S3 ?** La convention actuelle est
   `users/{userId}/…` et `assertOwnedPublicImage` s'appuie dessus. Une
   réalisation n'appartient à aucun utilisateur : même question que pour les
   médias d'association, à trancher une fois pour les deux.
