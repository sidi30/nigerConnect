# NigerConnect

**Le réseau social de la diaspora nigérienne.**

Une application mobile qui permet aux Nigériens vivant à l'étranger de se retrouver, de s'entraider et de rester connectés à leur communauté — où qu'ils soient dans le monde.

| | |
|---|---|
| 🌍 Site web | [nigerconnect.app](https://nigerconnect.app) |
| 🔌 API | [api.nigerconnect.app](https://api.nigerconnect.app/health) |
| 📱 Mobile | iOS (EAS / TestFlight) + Android — Expo SDK 54 |
| 📦 Repo | [github.com/sidi30/nigerConnect](https://github.com/sidi30/nigerConnect) |

---

## Le projet

### Le problème

Plus de **62 000 Nigériens** vivent à l'étranger, répartis dans plus de 15 pays (France, Belgique, Canada, USA, Maroc, Sénégal, Émirats...). Cette diaspora est dispersée et les gens ont du mal à :

- **retrouver des compatriotes** près de chez eux,
- **s'entraider au quotidien** : logement, démarches administratives, services, conseils,
- **rester en lien** avec leur communauté, leur culture et les associations qui les représentent.

Les réseaux sociaux classiques (Facebook, WhatsApp, Instagram) ne sont pas pensés pour ça : ils mélangent tout le monde, ne mettent pas la communauté en valeur et ne permettent pas de se localiser entre membres.

### La solution

Une seule app, **simple et mobile-first**, qui réunit tout ce dont la diaspora a besoin.

## Ce que fait l'app

### 👤 Compte & identité
- Inscription par email avec **activation obligatoire** (lien de vérification envoyé par email)
- Connexion **Google** et **Apple** (Sign in with Apple)
- Sélection de sa ville avec **autocomplete** (205 villes, drapeaux, pays auto-détecté)
- Vérification d'identité optionnelle (badge vérifié) avec chiffrement des documents
- Profil : photos, bio, localisation, niveau de confidentialité (public / amis / privé)

### 🗺️ Carte communautaire (style Snap Map)
- Voir les membres de la diaspora **autour de soi** et dans le monde entier
- Clustering par pays et par ville, zoom progressif jusqu'aux profils individuels
- **Ajouter en ami directement depuis la carte**
- Toggle de visibilité : apparaître sur la carte ou rester anonyme (compté dans les chiffres, jamais localisé individuellement)
- Alertes de proximité opt-in (un compatriote est près de toi)

### 👥 Social
- Demandes d'amis, suggestions, amis en commun
- Blocage et confidentialité respectés partout (feed, carte, recherche, chat)

### 📰 Feed
- Publications avec photos, likes, commentaires et réponses
- Stories 24 h
- Visibilité par publication : tout le monde / amis seulement
- Posts d'associations filtrés par adhésion

### 💬 Chat temps réel
- Conversations privées et de groupe (Socket.io)
- Présence en ligne, accusés de lecture, indicateur de frappe
- Envoi de photos

### 🤝 Marketplace d'entraide
- Proposer ou demander un service entre membres (aide au déménagement, traduction, logement temporaire...)
- Réponses et notation des services rendus

### 🏛️ Associations
- Annuaire des associations de la diaspora avec pages détail (membres, événements)
- Rejoindre / quitter, rôles (admin, membre), demandes d'adhésion

### 🔔 Notifications & modération
- Notifications push (Expo), email (vérification, reset password) — groupées intelligemment
- Signalement de contenus/profils, outils de modération, conformité RGPD (export des données, suppression de compte)

---

## Architecture

**Monolithe modulaire** : un seul backend NestJS découpé en modules métier (auth, profile, social, feed, chat, geo, marketplace, association, notification, moderation). Extractible en services séparés plus tard si besoin.

```
            ┌──────────────────────┐
            │   App mobile Expo    │  iOS / Android (EAS Build + OTA Updates)
            └──────────┬───────────┘
                       │ HTTPS + Socket.io
            ┌──────────▼───────────┐
            │  API NestJS (VPS)    │  api.nigerconnect.app
            │  Traefik + Docker    │
            └──┬───────┬───────┬───┘
               │       │       │
        ┌──────▼──┐ ┌──▼───┐ ┌─▼──────┐
        │Postgres │ │Redis │ │ MinIO  │
        │+PostGIS │ │      │ │  (S3)  │
        └─────────┘ └──────┘ └────────┘

            ┌──────────────────────┐
            │  Site web Next.js    │  nigerconnect.app
            │  (vitrine + légal)   │  (même VPS, même Traefik)
            └──────────────────────┘
```

### Stack

| Couche | Technologies |
|---|---|
| **API** | NestJS 10 · TypeScript · Prisma · PostgreSQL 16 + PostGIS · Redis 7 · Socket.io · JWT RS256 |
| **Mobile** | React Native · Expo SDK 54 · Expo Router v6 · Zustand · TanStack Query · EAS Build/Update |
| **Web** | Next.js 16 · Tailwind CSS 4 (site vitrine, pages légales, vérification email) |
| **Infra prod** | VPS · Docker Compose · Traefik · Cloudflare · Let's Encrypt |
| **Tests** | Jest (unit) · Playwright (e2e API + web) |
| **CI/CD** | GitHub Actions (CI par app, e2e, deploy VPS, OTA mobile) |
| **Monorepo** | pnpm workspaces · Turborepo |

### Sécurité

- JWT RS256 + refresh token rotatif, argon2id pour les mots de passe
- Activation de compte par email obligatoire (guard global API)
- Rate limiting par route, helmet, CORS strict, body size limit
- Chiffrement AES des documents d'identité, buckets S3 publics/privés séparés
- Scrubbing des tokens dans les logs et Sentry

---

## Structure du monorepo

```
nigerConnect/
├── apps/
│   ├── api/        API NestJS (modules : auth, profile, social, feed, chat, geo,
│   │               marketplace, association, notification, moderation)
│   ├── mobile/     App Expo (expo-router : (auth), (tabs), chat, post, user,
│   │               associations, settings, legal, stories...)
│   └── web/        Site vitrine Next.js (landing, support, pages légales,
│   │               vérification email, reset password)
├── packages/
│   ├── shared-types/   Types TS partagés API ↔ Mobile
│   └── config/         tsconfig partagés
├── e2e/            Suite Playwright (contrats API + pages web) — 54 tests
├── scripts/        deploy-vps.sh, smoke-prod.sh, backup-pg.sh
├── docs/           Architecture, guide de déploiement, soumission stores
└── .github/        Workflows CI/CD
```

---

## Démarrage local

Prérequis : Node ≥ 20, pnpm ≥ 9, Docker Desktop.

```bash
# 1. Dépendances
pnpm install

# 2. Environnement
cp .env.example .env

# 3. Clés JWT RS256
pnpm --filter @nigerconnect/api keys:generate

# 4. Postgres + Redis + MinIO
docker compose up -d

# 5. Base de données
pnpm --filter @nigerconnect/api prisma:generate
pnpm --filter @nigerconnect/api prisma:migrate

# 6. API (port 3000)
pnpm --filter @nigerconnect/api dev

# 7. Mobile (autre terminal)
pnpm --filter @nigerconnect/mobile dev

# 8. Web (optionnel, port 3001)
pnpm --filter @nigerconnect/web dev
```

Vérification : `curl http://localhost:3000/health` → `{ "status": "ok", ... }`

### Seed de développement

```bash
pnpm --filter @nigerconnect/api prisma:seed
# 20 utilisateurs, amitiés, posts, 5 associations
# Comptes : seed.user0@nigerconnect.local → seed.user19, password Seed!Password99
```

---

## Tests

```bash
# Unit (API) — 134 tests
pnpm --filter @nigerconnect/api test

# E2E Playwright (nécessite API + web démarrés, voir e2e/playwright.config.ts)
cd e2e && npx playwright test
```

La suite e2e couvre : contrats OAuth, cycle de vie des sessions, gate de vérification email, endpoints amis/associations/commentaires, pages web d'auth.

---

## Déploiement

📖 **Guide complet : [`docs/DEPLOY-QUICK.md`](docs/DEPLOY-QUICK.md)**

| Cible | Méthode | Durée |
|---|---|---|
| Mobile (JS/TS) | `eas update --channel preview` (OTA) | ~2 min |
| API / Web | Copie source → VPS → `deploy-vps.sh` (Docker + migrations) | ~10 min |
| Mobile (natif) | `eas build --profile preview` | ~20 min |
| TestFlight / Stores | `eas build --profile production --auto-submit` | ~30 min |

### CI/CD (GitHub Actions)

| Workflow | Déclencheur | Rôle |
|---|---|---|
| `api.yml` / `web.yml` / `mobile.yml` | PR, push develop | Typecheck, lint, tests |
| `e2e.yml` | PR touchant api/web/e2e | Suite Playwright complète |
| `deploy.yml` | Push sur `main` | Gates qualité → deploy VPS → smoke tests |
| `mobile.yml` (job OTA) | Push sur `main` | `eas update` automatique |

---

## Endpoints API principaux

- `POST /api/auth/register|login|refresh|logout` · `GET /api/auth/me` · `GET /api/auth/verify-email`
- `POST /api/auth/google|apple` (OAuth mobile)
- `GET/PATCH /api/profile/me` · `GET /api/profile/:id` · `GET /api/profile/search`
- `POST /api/friends/request/:userId|accept/:id` · `GET /api/friends/relationship/:userId`
- `POST /api/posts` · `GET /api/feed` · `POST /api/posts/:id/like|comments`
- `GET/POST /api/conversations` + Socket.io `/chat`
- `GET /api/geo/members|stats|nearby` (carte)
- `POST/GET /api/services` (marketplace) · `POST/GET /api/associations`
- `GET/PATCH /api/notifications` · `POST /api/reports`

Documentation d'architecture détaillée : [`docs/NigerConnect-Architecture-v2.md`](docs/NigerConnect-Architecture-v2.md)

---

## Identité visuelle

Orange `#E05206` · Vert `#0DB02B` · Crème `#FDFBF7` · Brun `#1A0F0A`
Typographies : **DM Sans** (texte) + **Playfair Display** (titres)

## Contact

Support, RGPD, modération : **contact@nigerconnect.app**
