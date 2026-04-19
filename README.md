# NigerConnect

Réseau social pour la diaspora nigérienne — Monolithe modulaire NestJS + App mobile Expo.

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
│   └── mobile/     Expo Router
├── packages/
│   ├── shared-types/   Types TS partagés API ↔ Mobile
│   └── config/         tsconfig partagés
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## Plan en 10 phases

Voir `NigerConnect-Architecture-v2.md` pour le détail complet.

| Phase | Contenu |
|---|---|
| 1 | Setup monorepo + Docker ✓ |
| 2 | Auth complet (OAuth, JWT, identité) |
| 3 | Profil + Photos |
| 4 | Social (amis, blocage) |
| 5 | Feed (posts, stories, likes, comments) |
| 6 | Chat temps réel Socket.io |
| 7 | App Mobile complète |
| 8 | Carte Snap Map |
| 9 | Marketplace + Associations |
| 10 | Notifications + Modération |

## Palette

Orange `#E05206` · Vert `#0DB02B` · Crème `#FDFBF7` · Brun `#1A0F0A` · Font DM Sans
