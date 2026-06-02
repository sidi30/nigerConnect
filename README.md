# NigerConnect

Réseau social pour la diaspora nigérienne — Monolithe modulaire NestJS + App mobile Expo.

## Contexte

**NigerConnect**, c'est une application mobile pensée pour les **Nigériens vivant à l'étranger** (plus de 62 000 personnes réparties dans 15+ pays).

### Le problème
La diaspora nigérienne est dispersée. Les gens ont du mal à :
- retrouver des compatriotes près de chez eux,
- s'entraider au quotidien (logement, démarches, services, conseils),
- rester en lien avec leur communauté et leur culture.

Les réseaux sociaux classiques (Facebook, WhatsApp, Instagram) ne sont pas pensés pour ça : ils mélangent tout le monde et ne mettent pas la communauté nigérienne en valeur.

### La solution
Une seule app, **simple et mobile-first**, qui réunit tout ce dont la diaspora a besoin :

- 👤 **Profil & identité** — créer un compte vérifié (OAuth Google/Facebook/Apple, vérification d'identité optionnelle).
- 👥 **Social** — retrouver des amis, suggestions, blocage.
- 📰 **Feed** — publier des posts, stories 24h, likes et commentaires.
- 💬 **Chat temps réel** — discussions privées et de groupe (Socket.io).
- 🗺️ **Carte communautaire** — voir les Nigériens autour de soi (style Snap Map, avec clustering).
- 🤝 **Marketplace d'entraide** — proposer / demander des services entre membres.
- 🏛️ **Associations** — rejoindre des assos de la diaspora, voir leurs événements.
- 🔔 **Notifications** push, email, SMS — groupées intelligemment.
- 🛡️ **Modération** — signalements et outils pour garder la communauté saine.

### À qui ça s'adresse
- Aux **Nigériens à l'étranger** qui veulent se reconnecter à leur communauté.
- Aux **associations de la diaspora** qui veulent fédérer leurs membres.
- Aux **nouveaux arrivants** qui cherchent de l'aide sur place.

### Choix techniques (en deux mots)
- **Mobile d'abord** : React Native + Expo, pas de site lourd au lancement.
- **Un seul backend simple** : NestJS modulaire, une seule base Postgres, pas de microservices.
- **Sécurité sérieuse** : JWT RS256 + refresh rotatif, argon2id, rate limiting, chiffrement des documents d'identité.
- **Open & évolutif** : on peut extraire un module en service séparé plus tard si besoin.

### État du projet
Le plan se découpe en **10 phases** (voir tableau plus bas). Toutes sont livrées (`v1.0.0`) : auth, profil, social, feed, chat, mobile, carte, marketplace, associations, notifications & modération.

## Stack

- **API** : NestJS 10 + TypeScript + Prisma + PostgreSQL 16 + Redis 7 + Socket.io
- **Mobile** : React Native + Expo SDK 52 + Expo Router v4 + Zustand + TanStack Query
- **Infra locale** : Docker Compose (Postgres + Redis + MinIO)
- **Monorepo** : pnpm workspaces + Turborepo

## Prérequis

- Node.js ≥ 20
- pnpm ≥ 9 (`npm i -g pnpm`)
- Docker Desktop (pour les services locaux)

## Démarrage

```bash
# 1. Installer les dépendances
pnpm install

# 2. Copier le .env et le renseigner
cp .env.example .env

# 3. Générer les clés JWT RS256 (pour Phase 2+)
pnpm --filter @nigerconnect/api keys:generate

# 4. Lancer Postgres, Redis, MinIO
docker compose up -d

# 5. Générer le client Prisma + migrer
pnpm --filter @nigerconnect/api prisma:generate
pnpm --filter @nigerconnect/api prisma:migrate

# 6. Démarrer l'API (port 3000)
pnpm --filter @nigerconnect/api dev

# 7. Dans un autre terminal, démarrer le mobile
pnpm --filter @nigerconnect/mobile dev
```

## Validation rapide

```bash
curl http://localhost:3000/health
# → { "status": "ok", "service": "nigerconnect-api", ... }
```

## Scripts racine

| Commande | Description |
|---|---|
| `pnpm dev` | Tout en parallèle (Turborepo) |
| `pnpm build` | Build de tous les packages |
| `pnpm test` | Tests de tous les packages |
| `pnpm typecheck` | Vérification types sur tout le monorepo |
| `pnpm lint` | Lint partout |

## Structure

```
nigerconnect/
├── apps/
│   ├── api/        NestJS monolithe (modules : auth, profile, social, feed, chat, …)
│   ├── mobile/     Expo Router
│   └── web/        Site vitrine Next.js 15 (landing / téléchargement app)
├── packages/
│   ├── shared-types/   Types TS partagés API ↔ Mobile
│   └── config/         tsconfig partagés
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## Site web (brand / landing)

```bash
pnpm --filter @nigerconnect/web dev
# → http://localhost:3001
```

Site vitrine Next.js 15 + Tailwind. Palette et typographies alignées avec l'app mobile
(DM Sans + Playfair Display). Sections : Hero, Problème, Fonctionnalités, Comment ça
marche, Communauté, Sécurité, FAQ, Download, Footer. SEO / Open Graph / sitemap prêts.

## Plan en 10 phases

Voir `docs/NigerConnect-Architecture-v2.md` pour le détail complet.

| Phase | Contenu | Statut |
|---|---|---|
| 1 | Setup monorepo + Docker | ✓ v0.1.0 |
| 2 | Auth complet (OAuth, JWT, identité) | ✓ v0.2.0 |
| 3 | Profil + Photos | ✓ v0.3.0 |
| 4 | Social (amis, blocage) | ✓ v0.4.0 |
| 5 | Feed (posts, stories, likes, comments) | ✓ v0.5.0 |
| 6 | Chat temps réel Socket.io | ✓ v0.6.0 |
| 7 | App Mobile complète | ✓ v0.7.0 |
| 8 | Carte Snap Map (backend) | ✓ v0.8.0 |
| 9 | Marketplace + Associations | ✓ v0.9.0 |
| 10 | Notifications + Modération | ✓ v1.0.0 |

## Endpoints API principaux

- `POST /api/auth/register|login|refresh|logout` · `GET /api/auth/me`
- `POST /api/auth/identity/submit|status` · `PATCH /api/auth/identity/review`
- `GET/PATCH /api/profile/me` · `GET /api/profile/:id` · `GET /api/profile/search`
- `POST /api/profile/me/photos/presign|photos` · `DELETE /api/profile/me/photos/:id`
- `POST /api/friends/request/:userId|accept/:id|decline/:id` · `DELETE /api/friends/:id`
- `GET /api/friends` · `/requests` · `/requests/sent` · `/mutual/:id` · `/suggestions`
- `POST/DELETE/GET /api/blocks`
- `POST /api/posts` · `GET /api/feed` · `POST /api/posts/:id/like|comments|share`
- `POST /api/stories` · `GET /api/stories/feed`
- `GET/POST /api/conversations` · `GET /api/conversations/:id/messages`
- Socket.io `/chat` : `message:send|read`, `typing:start|stop`, `user:online|offline`
- `GET /api/geo/members|stats|nearby`
- `POST/GET /api/services` · `POST /api/services/:id/respond|rate`
- `POST/GET /api/associations` · `/:id/join|leave|members|events`
- `GET/PATCH /api/notifications` · `POST /api/notifications/register-device`
- `POST /api/reports` · `GET/PATCH /api/reports` (modérateur)

## Seed de développement

```bash
pnpm --filter @nigerconnect/api prisma:seed
# Crée 20 utilisateurs, 4 amitiés, 20 posts, 5 associations vérifiées
# Password pour tous les comptes seed: Seed!Password99
# Comptes: seed.user0@nigerconnect.local → seed.user19@nigerconnect.local
```

## Palette

Orange `#E05206` · Vert `#0DB02B` · Crème `#FDFBF7` · Brun `#1A0F0A` · Font DM Sans
