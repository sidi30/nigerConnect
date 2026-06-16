# SPEC Parrainage v2 — Réseau (révision 2026-06-16)

Révision majeure du système d'invitation. **Remplace** les décisions v1 sur quota/expiration.
Décidé avec le proprio (3 confirmations) : lien-masse réservé aux droits accordés, parrain
public sur le profil, anti-abus = throttle + flag parrain (pas de quota dur).

## Changements vs v1

| Sujet | v1 | v2 (cette spec) |
|---|---|---|
| Quota d'invitations | 3 max (dérivé par count) | **Illimité** — chacun invite qui il veut |
| Expiration | 30 j (réglable) | **Aucune** — les invitations n'expirent jamais |
| Type de code | single-use uniquement | **2 types** : `single_use` (email/code) + `reusable` (lien de masse) |
| Lien réutilisable | — | **Droit accordé only** : `User.canBulkInvite` (admin) ; 1 lien → N inscriptions |
| Parrain visible | non | **Public sur le profil** (`invitedBy`) + arbre sur dashboard admin |
| Anti-abus | quota + flag | **throttle (anti-mailbomb) + flag parrain** (ban d'un filleul → +1 flag) |

Le **gel** reste : `inviteAbuseFlags >= 3` → l'utilisateur ne peut plus créer d'invitation
(ni email ni lien). Seul garde-fou « dur » restant, justifié par l'abus avéré (filleuls bannis).

## Modèle de données

- `enum InvitationKind { single_use, reusable }`
- `Invitation.kind InvitationKind @default(single_use)`
  - `single_use` : un code/email, **une** acceptation (status pending→accepted, `acceptedById` posé).
  - `reusable` : lien partageable, **N** inscriptions, **jamais** consommé (status reste `pending` = actif).
    Révocable (pending→revoked) → le lien cesse de valider.
- `User.canBulkInvite Boolean @default(false)` — droit accordé par l'admin de créer des liens `reusable`.
- `User.invitedViaId String?` → `Invitation` (SetNull) — **par quelle invitation** ce compte s'est inscrit.
  Permet de compter les inscriptions par lien réutilisable (analytics réseau). Distinct de `invitedById`
  (le parrain = arbre), qui reste la source de vérité de la parenté.
- `inviteQuota` / `expiresAt` : **colonnes conservées** (pas de drop destructif) mais **plus lues/posées**
  (toujours `null` pour `expiresAt`). Dépréciées.

## Contrat API (REST)

### POST /invitations  (auth + email-verified ; throttle 10/min, 40/jour par IP)
Body : `{ "email"?: string, "kind"?: "single_use" | "reusable" }` (Zod strict).
- `kind` défaut `single_use`. `email` ignoré si `reusable`.
- `reusable` exige `canBulkInvite` → sinon **403 `BULK_INVITE_NOT_ALLOWED`**.
- `inviteAbuseFlags >= 3` → **403 `INVITE_QUOTA_FROZEN`**.
- email non vérifié → **403 `EMAIL_NOT_VERIFIED`**.
- Plus de quota, plus d'expiration.
- Réponse : `{ id, code, url, kind }`.

### GET /invitations  (auth)
Réponse : `{ canBulkInvite: boolean, invites: Invite[] }` (**plus** de `quota/used/available`).
`Invite` : `{ id, code, url, kind, status, acceptedBy: {id,displayName,avatarUrl}|null, signupsCount, createdAt }`.
`signupsCount` : pour `reusable` = nb de comptes inscrits via ce lien ; pour `single_use` = 0 ou 1.

### POST /invitations/:id/revoke  (auth, owner) — inchangé (marche pour les 2 kinds).

### GET /invitations/check?code=…  (public ; throttle fort) — inchangé, accepte aussi les `reusable`.
Réponse : `{ valid, inviterName?, kind? }`.

### Inscription (register + OAuth) — gating `invite_only`
- Le code fourni peut être `single_use` **ou** `reusable`. `resolveCodeForRegistration(code)` →
  `{ inviterId, invitationId, kind }`. `single_use` déjà accepté → **400 `INVITE_CODE_CONSUMED`**.
- Email-match (fallback) : inchangé, `single_use` uniquement (le `reusable` n'a pas de `targetEmail`).
- Consommation post-create dans la transaction :
  - `single_use` : `atomicallyConsumeSingleUse(code,userId)` (updateMany pending→accepted) ; count 0 → rollback.
  - `reusable` : **rien à consommer** ; on pose juste `user.invitedById` + `user.invitedViaId`.
- `user.invitedViaId = invitationId` dans tous les cas (email-match inclus).
- `notifyInviter` : se déclenche dès que `invitedById` est posé (le parrain veut savoir, lien ou code).

### Profil (réseau public)
- `GET /profile/:id` et `getMe` exposent :
  - `invitedBy: { id, displayName, avatarUrl } | null` — **public** (assumé « réseau »).
  - `inviteesCount: number` — nb de filleuls (comptes avec `invitedById = ce user`).
- Respecte le blocage/`private` existant : si la cible est `private`/bloquée, on 404 déjà avant.
  `invitedBy` d'un parrain `private` → renvoyer `null` (ne pas fuiter un profil privé via le lien parrain).

## Dashboard admin
- Section parrainage : liste « qui a invité qui » (arbre / au moins parrain→filleuls), recherche.
- Accorder / révoquer `canBulkInvite` à un utilisateur.
- Lister les liens `reusable` actifs + `signupsCount`.

## Mobile
- `invite.tsx` : retirer tout l'UI de quota. Email illimité. Si `canBulkInvite`, bouton
  « Générer un lien d'invitation » (reusable, partage en masse). Liste « Mes filleuls » (signups).
- Profil : afficher « Invité par <X> » (tap → profil de X) quand `invitedBy != null`.
- Bump `app.json` version 1.4.0 → **1.5.0** (gros changement).

## Anti-abus (rappel)
- Throttle POST /invitations conservé (anti-mailbomb / réputation DKIM).
- Throttle GET /check conservé (anti-énumération).
- Ban d'un filleul → `inviteAbuseFlags += 1` du parrain (moderation.service, inchangé, idempotent).
- Gel à `>= 3` flags.
