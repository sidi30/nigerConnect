# Spec — Parrainage & inscription sur invitation

> Statut : **à implémenter**. Auteur : Claude (review Ramzi). Cible : NigerConnect (apps/api, apps/mobile, apps/web).
> Défauts validés : code email-agnostique single-use **partagé par le parrain** (aucun email de tiers stocké), quota 3 actif **après email vérifié**, slot remboursé si expiré/révoqué, expiration 30 j, pas de cascade de ban (flag parrain seulement), lancement en mode pilotable depuis l'admin.

---

## 1. Objectif

Permettre une inscription **sur invitation** : sans invitation valide, pas de compte. La fonctionnalité est **pilotable en direct depuis l'admin** (`tenant.nigerconnect.app`) sans redéploiement, avec trois modes :

| Mode | Effet |
|------|-------|
| `open` | Inscription libre. Code d'invitation **ignoré** s'il est fourni. (État historique.) |
| `invite_only` | Code d'invitation **obligatoire** sur les trois portes (email, Google, Apple). |
| `closed` | Aucune inscription possible (maintenance / kill-switch anti-abus). Login des comptes existants inchangé. |

Le parrainage construit un **graphe** « qui a invité qui », exploité pour l'anti-fraude et les métriques de croissance (intérêt légitime, RGPD).

### Principe anti-RGPD-risque (décision #4)

Le parrain **génère un code/lien et le partage lui-même** (WhatsApp, SMS, etc.) via la *Share Sheet* native. La plateforme **ne collecte ni ne stocke aucun email de tiers** non-inscrit. On ne stocke que le graphe entre comptes **déjà créés**. Cela élimine le seul point sensible RGPD du parrainage par email.

---

## 2. Modèle de données (Prisma)

### 2.1 Nouvel enum + modèle `Invitation`

```prisma
enum InvitationStatus {
  pending
  accepted
  revoked
  expired
}

model Invitation {
  id           String           @id @default(uuid()) @db.Uuid
  // Code haute entropie partagé par le parrain. base62, 10+ chars (~59 bits).
  code         String           @unique @db.VarChar(16)
  // null = invitation racine générée par l'admin (bootstrap / seeding waitlist).
  inviterId    String?          @map("inviter_id") @db.Uuid
  inviter      User?            @relation("UserInvitesSent", fields: [inviterId], references: [id], onDelete: Cascade)
  status       InvitationStatus @default(pending)
  // Compte créé en consommant ce code. SetNull si ce compte est supprimé,
  // pour garder l'historique de l'invitation.
  acceptedById String?          @map("accepted_by_id") @db.Uuid
  acceptedBy   User?            @relation("UserInviteAccepted", fields: [acceptedById], references: [id], onDelete: SetNull)
  expiresAt    DateTime?        @map("expires_at") @db.Timestamptz
  acceptedAt   DateTime?        @map("accepted_at") @db.Timestamptz
  revokedAt    DateTime?        @map("revoked_at") @db.Timestamptz
  createdAt    DateTime         @default(now()) @map("created_at") @db.Timestamptz

  @@index([inviterId, status])
  @@index([status, expiresAt])
  @@map("invitations")
}
```

### 2.2 Champs ajoutés à `User`

```prisma
model User {
  // … existant …

  // ── Parrainage ──────────────────────────────────────────────
  // Parrain direct (arbre). SetNull si le parrain supprime son compte —
  // on ne casse pas le filleul, on perd juste le lien de parenté.
  invitedById        String? @map("invited_by_id") @db.Uuid
  invitedBy          User?   @relation("UserInvitedBy", fields: [invitedById], references: [id], onDelete: SetNull)
  invitees           User[]  @relation("UserInvitedBy")
  // Nombre max d'invitations actives (pending + accepted). Surchargeable par
  // l'admin pour un influenceur. Défaut piloté par AppSetting au moment du create.
  inviteQuota        Int     @default(3)
  // Compteur d'abus : +1 quand un filleul est banni. ≥ seuil → quota gelé.
  inviteAbuseFlags   Int     @default(0) @map("invite_abuse_flags")

  invitesSent        Invitation[] @relation("UserInvitesSent")
  invitesAccepted    Invitation[] @relation("UserInviteAccepted")

  @@index([invitedById])
  // … @@map existant …
}
```

> **Note migration** : `inviteQuota @default(3)` couvre automatiquement le backfill des users existants. `invitedById` reste `null` pour eux (grand-fathered → deviennent parrains-graines quand le mode passe à `invite_only`).

### 2.3 Table de réglages runtime `AppSetting`

Réutilisable pour tout futur feature-flag.

```prisma
model AppSetting {
  key         String   @id @db.VarChar(60)        // 'registration_mode', 'default_invite_quota', 'invite_expiry_days'
  value       String   @db.VarChar(100)
  updatedById String?  @map("updated_by") @db.Uuid
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz
  @@map("app_settings")
}
```

Clés gérées au lancement :

| key | valeur initiale (seed) | type |
|-----|------------------------|------|
| `registration_mode` | `open` *(voir §9 rollout — on flippe à `invite_only` depuis l'admin une fois les invites racines générées)* | `open\|invite_only\|closed` |
| `default_invite_quota` | `3` | int |
| `invite_expiry_days` | `30` | int |

---

## 3. Comptabilité du quota (décision #1) — règle exacte

```
slotsUtilisés(parrain) = count(Invitation
                           WHERE inviterId = parrain
                           AND ( status = 'accepted'
                                 OR (status = 'pending'
                                     AND (expiresAt IS NULL OR expiresAt > now())) ))

quotaDisponible(parrain) = max(0, inviteQuota - slotsUtilisés)
```

- **Révoquée** ou **expirée** → exclue du compte → **slot remboursé** automatiquement.
- `pending` non-expirée **consomme** un slot (empêche le spam de pending).
- `accepted` consomme un slot **à vie** (l'invitation a servi).

Pas de compteur figé à maintenir : tout est dérivé par `count`, donc jamais désynchronisé.

### Quota actif après vérification (décision #2 — anti-farming)

Créer une invitation exige `inviter.emailVerified === true`. Un compte non vérifié a un quota effectif de **0** → ferme le farming exponentiel par comptes jetables.

### Gel anti-abus

Si `inviteAbuseFlags >= 3` → quota effectif **0** (parrain gelé), même si `inviteQuota` > 0. L'admin peut remettre à zéro le compteur.

---

## 4. Flux d'inscription (les 3 portes)

Toutes lisent `registration_mode` via `SettingsService.getRegistrationMode()` (cache Redis, §6).

### 4.1 `register()` (email) — `apps/api/src/auth/auth.service.ts`

```
1. enforceRegisterRateLimit(ip)                 // existant
2. mode = settings.getRegistrationMode()
3. switch (mode):
     'closed'      → throw ForbiddenException('Inscriptions fermées')
     'invite_only' → inviteCode requis ; pré-valider (existe, pending, non-expirée)
     'open'        → inviteCode ignoré
4. vérifier unicité email/phone (existant)
5. hash password (existant) ; résoudre coords (existant)
6. $transaction:
     a. user = user.create({ …, invitedById: invitation?.inviterId ?? null })
     b. si invite_only:
          res = invitation.updateMany({
                  where: { code, status: 'pending',
                           OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                  data:  { status: 'accepted', acceptedById: user.id, acceptedAt: now } })
          si res.count === 0 → throw BadRequest('Invitation invalide ou déjà utilisée') // rollback du create
     c. (post-commit) notifier le parrain : Notification invite_accepted
7. sendVerificationEmail(user.id)  (existant, fire&forget)
8. issueTokens (existant)
```

L'`updateMany` conditionnel rend la **consommation atomique** : deux inscriptions concurrentes sur le même code → une seule passe (`count===1`), l'autre `count===0` → rollback. Pas de race, pas de double-usage.

### 4.2 `loginWithOAuth()` (Google + Apple) — **le point délicat**

Google/Apple = login **et** signup fusionnés. Le gating doit s'appliquer **uniquement sur la branche création** (`createdNow`), jamais sur le login d'un compte existant.

```
… recherche user par (provider, providerId) puis auto-link email (existant) …

if (!user) {                       // ← création d'un NOUVEAU compte
    mode = settings.getRegistrationMode()
    if (mode === 'closed')      throw ForbiddenException('Inscriptions fermées')
    if (mode === 'invite_only') {
        if (!inviteCode) throw ForbiddenException('Invitation requise pour créer un compte')
        // pré-valider ; la consommation se fait dans le même flux que la création
    }
    // create user { …, invitedById: invitation?.inviterId ?? null }
    // si invite_only : updateMany conditionnel (idem 4.1.6.b) ; count===0 → throw
    // notifier parrain
}
// user existant → login normal, inviteCode ignoré
```

> ⚠️ Sans ce gating OAuth, n'importe qui contourne l'invitation via « S'inscrire avec Google ». C'est l'erreur classique à ne pas faire.

Le code email-agnostique (décision #3) règle l'incompatibilité **Apple Hide-My-Email** : le code seul autorise, aucun match d'email requis.

### 4.3 Mode `closed`

Bloque les 3 portes de création. Les comptes existants se connectent normalement (login/refresh non gatés).

---

## 5. Endpoints API

### 5.1 Auth (modifiés) — `apps/api/src/auth`

| Méthode | Route | Auth | Change |
|---------|-------|------|--------|
| `POST` | `/auth/register` | public | body `+inviteCode?: string` |
| `POST` | `/auth/google` | public | body `+inviteCode?: string` |
| `POST` | `/auth/apple` | public | body `+inviteCode?: string` |
| `GET` | `/auth/registration-mode` | **public** | retourne `{ mode }` pour que le client sache quoi afficher |

DTO Zod (ajouts) :

```ts
// register.dto.ts
inviteCode: z.string().trim().min(6).max(16).optional(),

// login.dto.ts — oauthSchema ET appleSchema
inviteCode: z.string().trim().min(6).max(16).optional(),
```

`GET /auth/registration-mode` → `@Public()`, `@Throttle` léger, `{ mode: 'open'|'invite_only'|'closed' }`.

### 5.2 Module `invitations` (nouveau) — `apps/api/src/invitations`

| Méthode | Route | Auth | Effet |
|---------|-------|------|-------|
| `POST` | `/invitations` | user **vérifié** | Génère une invitation. Vérifie quota dispo + email vérifié + pas gelé. Retour `{ id, code, url, expiresAt }`. `url = https://nigerconnect.app/invite/{code}`. |
| `GET` | `/invitations` | user | Liste mes invitations + résumé quota : `{ quota, used, available, invites: [{ id, code, status, acceptedBy?, createdAt, expiresAt }] }`. |
| `POST` | `/invitations/:id/revoke` | user (owner) | Révoque une `pending` m'appartenant → `status='revoked'`, `revokedAt=now` → **rembourse le slot**. 404 si pas à moi, 409 si déjà acceptée. |
| `GET` | `/invitations/check?code=` | **public**, `@Throttle` fort | Pré-valide un code sans le consommer : `{ valid: boolean, inviterName?: string }`. Affiche « Aïcha t'invite » sur l'écran d'inscription. |

Génération du code : `crypto.randomBytes` → base62, 10 chars (~59 bits). Collision improbable ; retry sur P2002.

### 5.3 Admin (étendu/nouveau) — `apps/api/src/admin`

| Méthode | Route | Rôle | Effet |
|---------|-------|------|-------|
| `GET` | `/admin/settings` | admin + mod | `{ registrationMode, defaultInviteQuota, inviteExpiryDays }` |
| `PATCH` | `/admin/settings` | **admin seul** | Modifie mode / quota défaut / expiry. Écrit DB + invalide cache Redis. `updatedById = reviewer`. |
| `POST` | `/admin/invitations/root` | **admin seul** | Génère `N` invitations racines (`inviterId=null`). Retour liste de codes/URLs. Bootstrap + seeding waitlist. Body `{ count: 1..200, expiresInDays? }`. |
| `GET` | `/admin/invitations/metrics` | admin + mod | Funnel : envoyées / acceptées / en attente / expirées, taux conversion, K-factor, top 10 parrains. |
| `POST` | `/admin/newsletter/:id/invite` *(optionnel)* | admin | Convertit un abonné waitlist → invitation racine + email d'invite (« ta place est prête »). Pont waitlist→invite. |

`PATCH /admin/settings` réservé `admin` (pas `moderator`) car sensible. Le `RolesGuard` existant gère ça.

---

## 6. `SettingsService` (nouveau) — cache Redis

`apps/api/src/common/settings/settings.service.ts`. Lu sur le chemin chaud (chaque signup) → cache Redis pour éviter un hit DB par inscription.

```ts
const KEY = 'setting:registration_mode'; // + setting:default_invite_quota, setting:invite_expiry_days

async getRegistrationMode(): Promise<RegistrationMode> {
  const cached = await this.redis.get(KEY);
  if (cached) return cached as RegistrationMode;
  const row = await this.prisma.appSetting.findUnique({ where: { key: 'registration_mode' } });
  const val = (row?.value as RegistrationMode) ?? 'open';   // fallback sûr
  await this.redis.set(KEY, val, 300);                       // TTL 5 min, filet
  return val;
}

async setSetting(key, value, adminId): Promise<void> {
  await this.prisma.appSetting.upsert({ where:{key}, create:{key,value,updatedById:adminId}, update:{value,updatedById:adminId} });
  await this.redis.set(`setting:${key}`, value, 300);        // invalidation immédiate (write-through)
}
```

Write-through : l'écriture admin met à jour Redis dans la foulée → effet **immédiat**, pas d'attente du TTL.

---

## 7. Notifications & boucle virale

### 7.1 Nouvel enum

```prisma
enum NotificationType {
  // … existant …
  invite_accepted
}
```

À la consommation d'une invitation (§4.1.6.c), créer une `Notification` pour le parrain : type `invite_accepted`, `actorId = nouveau filleul`, titre « {Prénom} a rejoint grâce à toi 🎉 ». Cliquable → profil du filleul. (Le système de notifs cliquables existe déjà.)

### 7.2 Onboarding viral (mobile)

Après inscription réussie → écran/CTA « Invite tes proches » (voir §8.3). C'est le moteur de croissance ; sans lui le parrainage ne se propage pas.

---

## 8. Mobile (Expo) — `apps/mobile`

### 8.1 `authStore`

`register`, `signInWithGoogle`, `signInWithApple` acceptent un `inviteCode?: string` optionnel et le transmettent à l'API.

### 8.2 `app/(auth)/register.tsx` + `welcome.tsx`

- Au montage de la zone auth : `GET /auth/registration-mode`.
- `mode === 'closed'` → écran « Inscriptions momentanément fermées » (CTA waitlist).
- `mode === 'invite_only'` → **étape 0** : champ « Code d'invitation » (ou pré-rempli par deep-link). Bouton « Valider » → `GET /invitations/check` → affiche « {Parrain} t'invite ✓ » puis débloque le wizard existant. Les boutons Apple/Google portent aussi le code.
- `mode === 'open'` → wizard actuel inchangé.

### 8.3 Écran « Inviter des amis » (nouveau) — `app/(tabs)/.../invite.tsx`

- Affiche quota : « Il te reste 2 invitations sur 3 ».
- Bouton « Générer un lien » → `POST /invitations` → `Share.share({ url })` (Share Sheet native : WhatsApp/SMS/…). **Aucun email de tiers saisi/stocké.**
- Liste de mes invitations (statut, qui a rejoint), bouton révoquer une `pending`.

### 8.4 Deep-link `app/invite/[code].tsx` (nouveau)

`https://nigerconnect.app/invite/CODE` (associatedDomains déjà = `nigerconnect.app`) → préremplit le code et route vers `register`. App **non installée** → page web (§10) garde le code + CTA store ; après install, l'utilisateur colle le code (fallback simple, pas de deferred deep-link en v1).

### 8.5 Notif `invite_accepted`

Mapper le nouveau type dans le rendu des notifications (icône + libellé + navigation profil).

> Aucun module natif ajouté → **livrable en OTA** (`eas update`), pas de rebuild, **sauf** si on ajoute un nouveau scheme natif (on n'en ajoute pas).

---

## 9. Web (Next.js) — `apps/web`

### 9.1 `/invite/[code]` (nouveau)

Page publique : appelle `/invitations/check`, affiche « {Parrain} t'invite sur NigerConnect », CTA « Ouvrir l'app » (deep-link) / « Télécharger » (stores). Conserve le code pour le fallback.

### 9.2 Admin (`tenant.nigerconnect.app`)

- **Toggle mode** : segmented control Ouvert / Sur invitation / Fermé → `PATCH /admin/settings`. Effet immédiat.
- Inputs quota défaut + expiration (jours).
- **Générateur d'invitations racines** : `POST /admin/invitations/root` → liste de liens copiables (bootstrap + seeding waitlist).
- **Section métriques invite** : funnel + K-factor + top parrains (réutilise les charts existants du dashboard).
- *(optionnel)* bouton « Inviter » sur chaque abonné waitlist.

### 9.3 RGPD — clause à ajouter

Dans `apps/web/lib/legal-content.ts` (PRIVACY_SECTIONS) **et** `apps/mobile/app/legal/privacy.tsx`, ajouter une section **« Parrainage »** :

> « NigerConnect propose un système de parrainage. Lorsque tu invites une personne, **tu partages toi-même** un lien d'invitation via tes propres moyens de communication ; **nous ne collectons ni ne conservons l'adresse email ou le numéro des personnes non-inscrites**. Lorsqu'un filleul crée un compte, nous conservons le lien de parrainage entre vos comptes sur la base de notre intérêt légitime (prévention de la fraude, mesure de la croissance). Cette information est agrégée pour nos statistiques. »

Ce modèle (lien partagé par le parrain, zéro email de tiers stocké) est **le plus protecteur** et n'ajoute aucune obligation de désinscription/relance.

---

## 10. Migration & bootstrap

### 10.1 Migration Prisma

1. `enum InvitationStatus`, `enum NotificationType += invite_accepted`.
2. `model Invitation`, `model AppSetting`.
3. `User` : `invitedById`, relations, `inviteQuota @default(3)`, `inviteAbuseFlags @default(0)`, index.
4. Seed `app_settings` : `registration_mode='open'`, `default_invite_quota='3'`, `invite_expiry_days='30'`.

`pnpm prisma:migrate` (dev) → `prisma:deploy` (prod via `deploy-vps.sh`).

### 10.2 Backfill

- Users existants : `inviteQuota` couvert par le défaut. `invitedById=null` (grand-fathered).
- **Important** : seed `registration_mode='open'` pour que le **déploiement ne verrouille personne**. Une fois les invites racines générées depuis l'admin, **flipper manuellement à `invite_only`** depuis le toggle. Sinon, jour 1 en `invite_only` sans invite racine = personne (toi compris) ne peut s'inscrire.

### 10.3 Cron d'expiration

Réutiliser le pattern de `identity-cleanup.cron.ts` : passer les `pending` dont `expiresAt < now` à `expired` (propreté + métriques). Le calcul de quota (§3) exclut déjà les expirées par date, donc le cron n'est pas critique pour la correction — seulement pour la propreté.

---

## 11. Anti-abus (récap)

| Risque | Parade |
|--------|--------|
| Énumération de codes | Code ~59 bits aléatoire (non séquentiel) + `@Throttle` fort sur `/invitations/check`. |
| Farming exponentiel | Quota actif **après email vérifié** uniquement. |
| Spam de pending | `pending` non-expirées consomment le quota (§3). |
| Contournement OAuth | Gating sur la branche `createdNow` des 3 portes (§4.2). |
| Filleuls toxiques | `inviteAbuseFlags++` au ban d'un filleul ; ≥3 → quota gelé. Pas de cascade de suppression (décision #5). |
| Attaque de masse | Mode `closed` = kill-switch inscription immédiat depuis l'admin. |
| Anneaux de Sybil | Hors v1 : le graphe est loggé pour analyse ultérieure. |

---

## 12. Plan de test

**Unit (Jest, apps/api)**
- Quota : calcul `available` avec mix pending/accepted/expired/revoked ; remboursement sur révocation/expiration.
- Gate « email vérifié » : non-vérifié → quota 0 → 403 au create.
- Consommation atomique : 2 consommations concurrentes du même code → 1 succès, 1 échec.
- Gating des 3 modes sur les 3 portes (email + Google + Apple, branche création vs login existant).
- `closed` bloque création, autorise login/refresh.
- Cache `SettingsService` : write-through invalide bien Redis.

**E2E (Playwright, e2e/tests/api)**
- `invite_only` : register sans code → 403 ; avec code valide → 201 ; code réutilisé → 400.
- OAuth en `invite_only` sans code (nouveau compte) → 403 ; compte existant → login OK.
- `closed` → toutes portes 403.
- Flux complet : admin génère root → register filleul → parrain reçoit notif → quota décrémenté.

**Sécurité** : `gwani-pentest` sur le diff (OWASP/IDOR/brute-force codes) → verdict `OK_TO_DEPLOY`.

---

## 13. Découpage de livraison

1. **Backend cœur** : schema + migration + `SettingsService` + invitations module + gating des 3 portes + tests unit. *(gwani-backend)*
2. **Admin** : `/admin/settings` + toggle UI + générateur root + métriques. *(gwani-frontend web)*
3. **Mobile** : gate register + écran « Inviter » + deep-link + notif. *(gwani-frontend mobile)*
4. **Légal** : clause Parrainage (web + mobile).
5. **QA + pentest** : e2e + audit. *(gwani-qa-tester → gwani-pentest)*
6. **Rollout** : déployer en `open`, générer invites racines, flipper `invite_only`. Bump version mobile, OTA.

---

## 14. Décisions figées (rappel)

| # | Décision |
|---|----------|
| Mode invite | Code **email-agnostique**, single-use, **partagé par le parrain** (aucun email de tiers stocké). |
| Quota | **3** par membre, **actif après email vérifié**, slot **remboursé** si expiré/révoqué. |
| Expiration | **30 jours**. |
| Cascade ban | **Non** — flag parrain (`inviteAbuseFlags`), gel du quota à 3 flags. |
| Waitlist | Conservée → **source d'invitations racines** depuis l'admin. |
| Mode au lancement | Déploiement en `open`, **flip `invite_only`** depuis l'admin une fois les racines générées. |
| Runtime toggle | 3 modes via `AppSetting` + cache Redis, pilotable sans redéploiement. |
