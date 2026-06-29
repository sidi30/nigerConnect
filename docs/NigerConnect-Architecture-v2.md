# NigerConnect — Architecture & Plan de Réalisation
## Réseau Social de la Diaspora Nigérienne

---

# TABLE DES MATIÈRES

1. Vision & Principes
2. Architecture : Monolithe Modulaire
3. Stack technologique
4. Structure du projet
5. Modèle de données (une seule base)
6. Sécurité
7. Infrastructure
8. Plan en 10 phases
9. Prompts Claude Code — Phase par phase

---

# 1. VISION & PRINCIPES

## Objectif
Réseau social pour 62 000+ Nigériens de la diaspora dans 15+ pays.
Se retrouver, s'entraider, rester connectés.

## Principes architecturaux

- **Simple d'abord** — Un monolithe modulaire, pas de microservices. 
  On split plus tard si et seulement si on en a besoin.
- **Mobile-First** — L'app React Native est le produit principal.
- **Security-First** — Auth robuste, vérification d'identité, chiffrement.
- **Feature-based** — Le code est organisé par fonctionnalité (auth, feed, 
  chat...), pas par couche technique (controllers, services, repositories).
- **Une seule base de données** — PostgreSQL pour tout. Moins de complexité 
  opérationnelle, transactions simples, un seul backup.
- **Convention over configuration** — On suit les conventions NestJS/Expo, 
  on ne réinvente rien.

## Pourquoi PAS de microservices au démarrage ?

- Équipe petite → un seul repo, un seul déploiement, un seul debug
- Pas de latence réseau entre services
- Transactions simples (pas de saga pattern)
- Un seul schéma de base → jointures SQL directes
- Déploiement trivial (un container)
- On pourra extraire un module en service séparé plus tard si un 
  module a besoin de scaler indépendamment (ex: chat temps réel)

---

# 2. ARCHITECTURE : MONOLITHE MODULAIRE

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │   App Mobile    │  │    Web App     │  │  Admin Panel     │   │
│  │  React Native   │  │   Next.js 16   │  │  Next.js         │   │
│  │  Expo SDK 54    │  │   (PWA)        │  │                  │   │
│  └───────┬────────┘  └───────┬────────┘  └────────┬─────────┘   │
└──────────┼───────────────────┼────────────────────┼──────────────┘
           │                   │                    │
           ▼                   ▼                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                    API (NestJS monolithe)                         │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │   Auth    │ │ Profile  │ │  Social  │ │     Feed         │   │
│  │  Module   │ │  Module  │ │  Module  │ │    Module        │   │
│  │          │ │          │ │  (amis)  │ │  (posts,stories) │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │   Chat   │ │ Services │ │  Assoc   │ │    Geo / Map     │   │
│  │  Module  │ │ Marketplace│ │  Module  │ │    Module        │   │
│  │+Socket.io│ │  Module   │ │          │ │                  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────────────────┐   │
│  │  Media   │ │  Notif   │ │       Shared / Common          │   │
│  │  Module  │ │  Module  │ │  Guards, Pipes, Interceptors    │   │
│  │ (upload) │ │(push,sms)│ │  Config, Logger, Exceptions     │   │
│  └──────────┘ └──────────┘ └────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ PostgreSQL │  │   Redis    │  │  AWS S3    │
    │  (tout)    │  │  (cache,   │  │  (médias)  │
    │            │  │  sessions, │  │            │
    │            │  │  présence) │  │            │
    └────────────┘  └────────────┘  └────────────┘
```

**Le seul service séparé** : le serveur Socket.io pour le chat temps réel 
peut tourner dans le même process NestJS (Gateway) ou être extrait plus tard.

**Web & Admin = une seule app Next.js** : le site public et la console d'administration (tenant) sont servis par le même conteneur `nigerconnect-web`. Un *middleware* réécrit l'hôte `tenant.nigerconnect.app` vers le groupe de routes `/admin` (et l'apex `nigerconnect.app` renvoie 404 sur `/admin`). La console pilote la gestion des utilisateurs, le badge ambassadeur, les réglages et la sécurité MFA du staff.

---

# 3. STACK TECHNOLOGIQUE

| Couche | Techno | Pourquoi |
|--------|--------|----------|
| **App Mobile** | React Native + Expo SDK 54 | Cross-platform. Expo = builds cloud, OTA updates, moins de config native. |
| **Web** | Next.js 16 (App Router) | SEO, partage de composants React avec le mobile. |
| **API** | NestJS + TypeScript | Framework structuré, modules, guards, DI. Standard Node.js entreprise. |
| **ORM** | Prisma | Type-safe, migrations, introspection. Simple et fiable. |
| **Base de données** | PostgreSQL 16 | Tout-en-un : relationnel, JSON, full-text search, PostGIS (géo). Une seule base. |
| **Cache** | Redis 7 | Sessions, cache profils, présence en ligne, rate limiting. |
| **Stockage fichiers** | AWS S3 + CloudFront | Photos, vidéos, documents. CDN mondial. MinIO en local. |
| **Traitement images** | Sharp | Resize, thumbnails, compression. Rapide, natif. |
| **Temps réel** | Socket.io (intégré NestJS Gateway) | Chat, présence, notifications live. |
| **Auth OAuth** | Passport.js (Google, Facebook, Apple) | Standard, bien intégré NestJS. |
| **Push notifications** | Expo Push Service (FCM optionnel) | Transport réel = Expo Push pour tous les tokens ; FCM désactivé sauf si credentials fournis. iOS + Android. |
| **Emails** | nodemailer + SMTP (IONOS `smtp.ionos.fr`, expéditeur `contact@gwani.fr`, DKIM `nc1`) | Transport SMTP direct ; pas de SDK Resend dans le code. |
| **SMS** | Twilio | OTP, alertes. Standard mondial. |
| **Queues (background jobs)** | BullMQ + Redis | Traitement images, emails, notifications. Fiable. |
| **Validation** | Zod | Validation et typage partagés front/back. |
| **Tests** | Jest + Supertest | Standard NestJS. |
| **CI/CD** | GitHub Actions | Pipeline `deploy.yml` (quality-api/web → docker-build → e2e Playwright → deploy-vps SSH → smoke). Builds mobile EAS `--local` sur runners (pas de quota cloud). |
| **Conteneurs** | Docker + Docker Compose | Dev local identique à la prod. |
| **Hébergement** | **VPS dédié (46.224.193.109)** : Docker Compose derrière **Traefik**, **Cloudflare** devant | MVP réel en prod. Stockage S3 = **MinIO** auto-hébergé (`cdn.nigerconnect.app`). |
| **Sauvegarde / DR** | `pg_dump` quotidien (Tier-2) + **pgBackRest PITR** (Tier-1, WAL continu → S3 chiffré off-site) | RPO ~1min, restauration point-in-time. Roadmap : hot standby 2ᵉ VPS. |
| **Monitoring** | Sentry (errors) + Axiom (logs) | Services managés, pas d'infra à gérer. |

---

# 4. STRUCTURE DU PROJET

```
nigerconnect/
│
├── apps/
│   ├── api/                          # NestJS monolithe
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts         # Importe tous les modules
│   │   │   │
│   │   │   ├── auth/                 # ── MODULE AUTH ──
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── auth.guard.ts         # JWT guard
│   │   │   │   ├── strategies/
│   │   │   │   │   ├── jwt.strategy.ts
│   │   │   │   │   ├── google.strategy.ts
│   │   │   │   │   ├── facebook.strategy.ts
│   │   │   │   │   └── apple.strategy.ts
│   │   │   │   ├── dto/
│   │   │   │   │   ├── register.dto.ts
│   │   │   │   │   ├── login.dto.ts
│   │   │   │   │   └── verify-identity.dto.ts
│   │   │   │   └── auth.service.spec.ts
│   │   │   │
│   │   │   ├── profile/              # ── MODULE PROFILE ──
│   │   │   │   ├── profile.module.ts
│   │   │   │   ├── profile.controller.ts
│   │   │   │   ├── profile.service.ts
│   │   │   │   ├── dto/
│   │   │   │   └── profile.service.spec.ts
│   │   │   │
│   │   │   ├── social/               # ── MODULE SOCIAL (amis) ──
│   │   │   │   ├── social.module.ts
│   │   │   │   ├── friends.controller.ts
│   │   │   │   ├── friends.service.ts
│   │   │   │   ├── blocks.service.ts
│   │   │   │   ├── suggestions.service.ts
│   │   │   │   ├── dto/
│   │   │   │   └── friends.service.spec.ts
│   │   │   │
│   │   │   ├── feed/                 # ── MODULE FEED ──
│   │   │   │   ├── feed.module.ts
│   │   │   │   ├── posts.controller.ts
│   │   │   │   ├── posts.service.ts
│   │   │   │   ├── comments.controller.ts
│   │   │   │   ├── comments.service.ts
│   │   │   │   ├── stories.controller.ts
│   │   │   │   ├── stories.service.ts
│   │   │   │   ├── feed.service.ts       # Algorithme de feed
│   │   │   │   ├── dto/
│   │   │   │   └── feed.service.spec.ts
│   │   │   │
│   │   │   ├── chat/                 # ── MODULE CHAT ──
│   │   │   │   ├── chat.module.ts
│   │   │   │   ├── chat.controller.ts    # REST (historique)
│   │   │   │   ├── chat.gateway.ts       # Socket.io (temps réel)
│   │   │   │   ├── chat.service.ts
│   │   │   │   ├── dto/
│   │   │   │   └── chat.gateway.spec.ts
│   │   │   │
│   │   │   ├── marketplace/          # ── MODULE SERVICES/ENTRAIDE ──
│   │   │   │   ├── marketplace.module.ts
│   │   │   │   ├── services.controller.ts
│   │   │   │   ├── services.service.ts
│   │   │   │   ├── responses.service.ts
│   │   │   │   ├── dto/
│   │   │   │   └── services.service.spec.ts
│   │   │   │
│   │   │   ├── association/          # ── MODULE ASSOCIATIONS ──
│   │   │   │   ├── association.module.ts
│   │   │   │   ├── association.controller.ts
│   │   │   │   ├── association.service.ts
│   │   │   │   ├── membership.service.ts
│   │   │   │   ├── events.controller.ts
│   │   │   │   ├── dto/
│   │   │   │   └── association.service.spec.ts
│   │   │   │
│   │   │   ├── geo/                  # ── MODULE GEOLOCATION ──
│   │   │   │   ├── geo.module.ts
│   │   │   │   ├── geo.controller.ts
│   │   │   │   ├── geo.service.ts
│   │   │   │   └── geo.service.spec.ts
│   │   │   │
│   │   │   ├── media/                # ── MODULE MEDIA ──
│   │   │   │   ├── media.module.ts
│   │   │   │   ├── media.controller.ts
│   │   │   │   ├── media.service.ts
│   │   │   │   ├── image-processor.ts    # Sharp resize queue
│   │   │   │   └── media.service.spec.ts
│   │   │   │
│   │   │   ├── notification/         # ── MODULE NOTIFICATION ──
│   │   │   │   ├── notification.module.ts
│   │   │   │   ├── notification.service.ts
│   │   │   │   ├── push.service.ts       # Expo Push (FCM optionnel)
│   │   │   │   ├── email.service.ts      # SMTP IONOS (nodemailer)
│   │   │   │   └── sms.service.ts        # Twilio
│   │   │   │
│   │   │   ├── moderation/           # ── MODULE MODERATION ──
│   │   │   │   ├── moderation.module.ts
│   │   │   │   ├── report.controller.ts
│   │   │   │   ├── report.service.ts
│   │   │   │   └── moderation.service.ts
│   │   │   │
│   │   │   └── common/               # ── PARTAGÉ ──
│   │   │       ├── guards/
│   │   │       │   ├── jwt-auth.guard.ts
│   │   │       │   ├── verified.guard.ts     # Identité vérifiée
│   │   │       │   └── roles.guard.ts
│   │   │       ├── interceptors/
│   │   │       │   ├── transform.interceptor.ts
│   │   │       │   └── logging.interceptor.ts
│   │   │       ├── filters/
│   │   │       │   └── http-exception.filter.ts
│   │   │       ├── pipes/
│   │   │       │   └── zod-validation.pipe.ts
│   │   │       ├── decorators/
│   │   │       │   ├── current-user.decorator.ts
│   │   │       │   └── public.decorator.ts
│   │   │       └── config/
│   │   │           └── env.validation.ts
│   │   │
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # UN SEUL SCHÉMA
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   │
│   │   ├── test/                     # Tests E2E
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── mobile/                       # React Native Expo
│   │   ├── app/                      # Expo Router (file-based)
│   │   │   ├── (auth)/
│   │   │   │   ├── login.tsx
│   │   │   │   ├── register.tsx
│   │   │   │   └── verify.tsx
│   │   │   ├── (tabs)/
│   │   │   │   ├── map.tsx
│   │   │   │   ├── feed.tsx
│   │   │   │   ├── services.tsx
│   │   │   │   ├── messages.tsx
│   │   │   │   └── profile.tsx
│   │   │   ├── chat/[id].tsx
│   │   │   ├── user/[id].tsx
│   │   │   ├── association/[id].tsx
│   │   │   ├── post/[id].tsx
│   │   │   └── _layout.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── stores/                   # Zustand
│   │   ├── services/                 # API calls
│   │   └── package.json
│   │
│   └── web/                          # Next.js (plus tard)
│       └── ...
│
├── packages/
│   ├── shared-types/                 # Types partagés API ↔ Mobile
│   │   ├── src/
│   │   │   ├── user.ts
│   │   │   ├── post.ts
│   │   │   ├── message.ts
│   │   │   ├── friendship.ts
│   │   │   ├── association.ts
│   │   │   ├── service-request.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── config/                       # ESLint, TSConfig partagés
│       ├── eslint-config/
│       └── tsconfig/
│
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example
└── README.md
```

**Règle clé : chaque module ne dépend que de `common/` et de Prisma. 
Les modules communiquent via injection de services NestJS, jamais 
par import direct entre modules.**

---

# 5. MODÈLE DE DONNÉES (UNE SEULE BASE POSTGRESQL)

```sql
-- ══════════════════════════════════════════════
-- AUTH & USERS
-- ══════════════════════════════════════════════

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(255) UNIQUE,
    phone               VARCHAR(20) UNIQUE,
    password_hash       VARCHAR(255),
    oauth_provider      VARCHAR(20),       -- google | facebook | apple
    oauth_provider_id   VARCHAR(255),
    
    -- Profil (dans la même table, simple)
    first_name          VARCHAR(100),
    last_name           VARCHAR(100),
    display_name        VARCHAR(100),
    bio                 TEXT,
    avatar_url          VARCHAR(500),
    cover_url           VARCHAR(500),
    
    -- Localisation
    city                VARCHAR(100),
    country_code        CHAR(2),
    latitude            DECIMAL(10,7),
    longitude           DECIMAL(10,7),
    show_on_map         BOOLEAN DEFAULT TRUE,
    
    -- Paramètres
    languages           TEXT[] DEFAULT '{"fr"}',
    privacy_level       VARCHAR(10) DEFAULT 'friends',
    
    -- Statuts
    email_verified      BOOLEAN DEFAULT FALSE,
    phone_verified      BOOLEAN DEFAULT FALSE,
    identity_status     VARCHAR(20) DEFAULT 'not_submitted',
        -- not_submitted | pending | approved | rejected
    role                VARCHAR(20) DEFAULT 'user',
        -- user | moderator | admin
    status              VARCHAR(20) DEFAULT 'active',
        -- active | suspended | banned
    
    -- Sécurité
    mfa_enabled         BOOLEAN DEFAULT FALSE,
    mfa_secret          VARCHAR(255),
    failed_login_count  INT DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    last_login_at       TIMESTAMPTZ,
    last_login_ip       INET,
    
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE identity_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    document_type       VARCHAR(30),
    file_url            VARCHAR(500),  -- S3, chiffré
    status              VARCHAR(20) DEFAULT 'pending',
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    expires_at          TIMESTAMPTZ,   -- auto-delete 30j après approval
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash          VARCHAR(255) UNIQUE NOT NULL,
    device_name         VARCHAR(100),
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE push_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    token               VARCHAR(500) NOT NULL,
    platform            VARCHAR(10),  -- ios | android | web
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, token)
);

-- ══════════════════════════════════════════════
-- SOCIAL (AMIS, BLOCAGES)
-- ══════════════════════════════════════════════

CREATE TABLE friendships (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    addressee_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    status              VARCHAR(10) DEFAULT 'pending',
        -- pending | accepted | declined
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(requester_id, addressee_id)
);

CREATE INDEX idx_friends_accepted ON friendships(requester_id, addressee_id) 
    WHERE status = 'accepted';
CREATE INDEX idx_friends_pending ON friendships(addressee_id) 
    WHERE status = 'pending';

CREATE TABLE blocks (
    blocker_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    blocked_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(blocker_id, blocked_id)
);

-- ══════════════════════════════════════════════
-- FEED (POSTS, COMMENTAIRES, LIKES)
-- ══════════════════════════════════════════════

CREATE TABLE posts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id           UUID REFERENCES users(id) ON DELETE CASCADE,
    content             TEXT,
    visibility          VARCHAR(15) DEFAULT 'friends',
        -- public | friends | association
    association_id      UUID,  -- si posté dans une association
    is_story            BOOLEAN DEFAULT FALSE,
    story_expires_at    TIMESTAMPTZ,
    
    -- Stats dénormalisées (maj par trigger ou application)
    like_count          INT DEFAULT 0,
    comment_count       INT DEFAULT 0,
    share_count         INT DEFAULT 0,
    
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_feed ON posts(created_at DESC) 
    WHERE is_story = FALSE;
CREATE INDEX idx_posts_stories ON posts(author_id, story_expires_at) 
    WHERE is_story = TRUE;

CREATE TABLE post_media (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             UUID REFERENCES posts(id) ON DELETE CASCADE,
    media_url           VARCHAR(500),
    thumbnail_url       VARCHAR(500),
    media_type          VARCHAR(10),  -- image | video
    width               INT,
    height              INT,
    blurhash            VARCHAR(100),
    sort_order          INT DEFAULT 0
);

CREATE TABLE likes (
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    post_id             UUID REFERENCES posts(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(user_id, post_id)
);

CREATE TABLE comments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             UUID REFERENCES posts(id) ON DELETE CASCADE,
    author_id           UUID REFERENCES users(id) ON DELETE CASCADE,
    parent_id           UUID REFERENCES comments(id),  -- réponse
    content             TEXT NOT NULL,
    like_count          INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id, created_at);

-- ══════════════════════════════════════════════
-- PHOTOS DE PROFIL (galerie)
-- ══════════════════════════════════════════════

CREATE TABLE user_photos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    url                 VARCHAR(500),
    thumbnail_url       VARCHAR(500),
    caption             TEXT,
    sort_order          INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════
-- CHAT (CONVERSATIONS, MESSAGES)
-- ══════════════════════════════════════════════

CREATE TABLE conversations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                VARCHAR(10) DEFAULT 'direct',  -- direct | group
    name                VARCHAR(100),    -- pour les groupes
    avatar_url          VARCHAR(500),
    created_by          UUID REFERENCES users(id),
    last_message_at     TIMESTAMPTZ,
    last_message_preview TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversation_members (
    conversation_id     UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    role                VARCHAR(10) DEFAULT 'member',  -- admin | member
    last_read_at        TIMESTAMPTZ,
    unread_count        INT DEFAULT 0,
    muted               BOOLEAN DEFAULT FALSE,
    joined_at           TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(conversation_id, user_id)
);

CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id           UUID REFERENCES users(id) ON DELETE CASCADE,
    content             TEXT,
    message_type        VARCHAR(10) DEFAULT 'text',
        -- text | image | file | system
    media_url           VARCHAR(500),
    reply_to_id         UUID REFERENCES messages(id),
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_convo ON messages(conversation_id, created_at DESC);

-- ══════════════════════════════════════════════
-- MARKETPLACE (SERVICES & ENTRAIDE)
-- ══════════════════════════════════════════════

CREATE TABLE service_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id           UUID REFERENCES users(id) ON DELETE CASCADE,
    title               VARCHAR(200) NOT NULL,
    description         TEXT,
    category            VARCHAR(20),
        -- logement | transport | admin | sante | emploi | business | education | autre
    urgency             VARCHAR(10) DEFAULT 'normal',
        -- urgent | normal
    budget              VARCHAR(50),
    city                VARCHAR(100),
    country_code        CHAR(2),
    status              VARCHAR(15) DEFAULT 'open',
        -- open | in_progress | resolved | closed
    response_count      INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_services_open ON service_requests(created_at DESC) 
    WHERE status = 'open';

CREATE TABLE service_responses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID REFERENCES service_requests(id) ON DELETE CASCADE,
    responder_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    message             TEXT,
    accepted            BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE service_ratings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          UUID REFERENCES service_requests(id),
    rated_user_id       UUID REFERENCES users(id),
    rating              INT CHECK(rating >= 1 AND rating <= 5),
    comment             TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════
-- ASSOCIATIONS
-- ══════════════════════════════════════════════

CREATE TABLE associations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    logo_url            VARCHAR(500),
    cover_url           VARCHAR(500),
    category            VARCHAR(20),
        -- generaliste | etudiants | femmes | jeunesse | culture | 
        -- business | sport | religieux
    country_code        CHAR(2),
    city                VARCHAR(100),
    website             VARCHAR(300),
    contact_email       VARCHAR(255),
    is_verified         BOOLEAN DEFAULT FALSE,
    member_count        INT DEFAULT 0,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE association_members (
    association_id      UUID REFERENCES associations(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    role                VARCHAR(15) DEFAULT 'member',
        -- admin | moderator | member
    status              VARCHAR(10) DEFAULT 'approved',
        -- pending | approved
    joined_at           TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(association_id, user_id)
);

CREATE TABLE association_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID REFERENCES associations(id) ON DELETE CASCADE,
    title               VARCHAR(200),
    description         TEXT,
    event_date          TIMESTAMPTZ,
    location            VARCHAR(200),
    cover_url           VARCHAR(500),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════
-- NOTIFICATIONS
-- ══════════════════════════════════════════════

CREATE TABLE notifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    type                VARCHAR(30),
        -- friend_request | friend_accepted | like | comment | 
        -- message | service_response | association_invite | system
    title               VARCHAR(200),
    body                TEXT,
    data                JSONB,         -- payload flexible
    actor_id            UUID REFERENCES users(id),
    read                BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifs_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifs_unread ON notifications(user_id) WHERE read = FALSE;

-- ══════════════════════════════════════════════
-- MODERATION
-- ══════════════════════════════════════════════

CREATE TABLE reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id         UUID REFERENCES users(id),
    target_type         VARCHAR(15),   -- user | post | message | association
    target_id           UUID,
    reason              VARCHAR(30),
        -- spam | harassment | inappropriate | fake_identity | scam | other
    description         TEXT,
    status              VARCHAR(15) DEFAULT 'pending',
        -- pending | reviewed | resolved | dismissed
    reviewed_by         UUID REFERENCES users(id),
    action_taken        VARCHAR(20),
        -- warning | content_removed | suspended | banned | none
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ
);

-- ══════════════════════════════════════════════
-- EXTENSIONS POSTGIS (pour la carte)
-- ══════════════════════════════════════════════

-- CREATE EXTENSION IF NOT EXISTS postgis;
-- 
-- ALTER TABLE users ADD COLUMN location GEOGRAPHY(POINT, 4326);
-- CREATE INDEX idx_users_location ON users USING GIST(location);
--
-- Note : activer PostGIS quand on implémente la carte (Phase 7)
-- En attendant, latitude/longitude simples suffisent
```

---

# 6. SÉCURITÉ

## Couches de protection

```
Couche 1  │ HTTPS/TLS 1.3 partout (Cloudflare + Let's Encrypt via Traefik)
Couche 2  │ Cloudflare-only : Traefik n'accepte que les IP egress Cloudflare
Couche 3  │ Rate limiting : @Throttle() buckets short/medium/long par IP & user
Couche 4  │ Auth : JWT RS256 (~15min, iss/aud, jti) + refresh rotatif (~7j) + reuse detection
Couche 5  │ Guards NestJS globaux : JwtAuthGuard + EmailVerifiedGuard (+ statut) + RolesGuard
Couche 6  │ MFA TOTP (staff) : 2ᵉ facteur, secret AES-256-GCM, codes de récupération
Couche 7  │ Validation : Zod sur chaque body (ZodValidationPipe), rejouée côté WS
Couche 8  │ Helmet.js : security headers automatiques
Couche 9  │ CORS : origines whitelistées (web + admin), pas de wildcard en prod
Couche 10 │ Argon2id : hash des mots de passe (pas bcrypt)
Couche 11 │ Documents identité : chiffrés AES-256 at rest (bucket S3 privé)
Couche 12 │ SQL injection : impossible (Prisma ORM, pas de raw SQL)
Couche 13 │ XSS / homographes : sanitisation des inputs (control/zero-width/bidi)
Couche 14 │ Brute force : lock escaladé après 5/10/15 échecs (mdp ET code MFA)
```

## Vérification diaspora

```
Upload document → Scan antivirus → Chiffrement AES-256 → Stockage S3
     → File modération (admin review manuel)
     → Approuvé : badge ✓ + accès complet + suppression doc à J+30
     → Rejeté : notification avec motif + possibilité de re-soumettre
```

## Tokens

```
Access Token :  JWT RS256, ~15 min, payload = { sub, role, identityStatus, jti }
                iss/aud vérifiés ; jti blacklisté en Redis au logout
Refresh Token : Opaque, ~7 jours, hashé en base
                Rotation à chaque usage (ancien invalidé)
                Reuse detection : un refresh déjà consommé → révocation de TOUS
                  les tokens du user (vol potentiel)
                Stocké côté mobile dans Expo SecureStore
mfaToken :      Challenge RS256 court (audience <aud>:mfa), émis au login d'un
                compte mfaEnabled — non échangeable contre un access token,
                consommé uniquement par POST /auth/mfa/verify
```

## MFA & double authentification (staff)

```
- TOTP (Google Authenticator) : enroll → confirm (10 codes de récupération
  hashés SHA-256, usage unique) → verify au 2ᵉ facteur ; disable ; status
- Secret stocké chiffré AES-256-GCM (mfa-secret.service)
- Login 2 étapes : password OK → { mfaRequired, mfaToken } → /auth/mfa/verify
  (TOTP 6 chiffres OU code de récupération)
- Politique admin_mfa_required (AppSetting) : refuse au login tout admin/
  moderator non enrôlé (MFA_REQUIRED_NOT_ENROLLED) ; garde anti-auto-lockout
  (impossible d'activer le réglage sans avoir soi-même enrôlé)
- Mauvais codes MFA → registerFailedLogin() (même escalade que le mot de passe)
```

## Statut de compte (appliqué globalement)

```
- status ∈ { active | suspended | banned }
- EmailVerifiedGuard (global) rejette banned (ACCOUNT_BANNED) / suspended
  (ACCOUNT_SUSPENDED) à chaque requête — verdict NÉGATIF jamais caché
  (levée de sanction immédiate) ; seul l'état vérifié est mis en cache ~60s
- Suspendre/bannir révoque tous les refresh tokens (atomique) → déconnexion
- Modération & admin : un moderator ne peut pas sanctionner le staff,
  pas d'auto-action (statut/role/suppression sur soi-même)
```

---

# 7. INFRASTRUCTURE

## Dev local (Docker Compose)

```yaml
# docker-compose.yml
services:
  postgres:   PostgreSQL 16 + PostGIS   (port 5432)
  redis:      Redis 7                    (port 6379)
  minio:      MinIO (S3 local)           (port 9000)
  api:        NestJS (hot reload)        (port 3000)
  # Le mobile tourne directement via Expo sur la machine hôte
```

## Production (VPS auto-hébergé)

VPS unique `46.224.193.109`, **Docker Compose derrière Traefik**, **Cloudflare** devant
(`docker-compose.prod.yml`). Conteneurs :

```
  nigerconnect-postgres  PostgreSQL 16 + PostGIS   réseau interne uniquement
  nigerconnect-redis     Redis 7 (requirepass, AOF) réseau interne uniquement
  nigerconnect-minio     MinIO (S3) + buckets pub/privé  interne + Traefik (CDN)
  nigerconnect-api       NestJS (port 3000)         derrière Traefik
  nigerconnect-web       Next.js (public + admin)   derrière Traefik
```

Hôtes (A records Cloudflare → VPS, proxied ; TLS Let's Encrypt DNS-challenge via Traefik) :

```
  nigerconnect.app          → web (vitrine publique)
  api.nigerconnect.app      → API + Socket.io
  cdn.nigerconnect.app      → MinIO bucket public (médias, Cache-Control immutable)
  tenant.nigerconnect.app   → console admin (middleware → /admin ; 404 sur l'apex)
```

PostgreSQL / Redis / MinIO sont sur un réseau Docker **privé** (aucun port hôte publié) ;
seuls `api` et `web` sont exposés via le réseau `traefik-public`. `TRUST_PROXY_HOPS=2`
(Cloudflare → Traefik → api). Middleware Traefik `cloudflare-only` : seules les IP
egress Cloudflare atteignent l'origine.

**Déploiement** (`scripts/deploy-vps.sh`, dossier VPS = repo git sur `main`) :
sanity checks → génère le keypair JWT RS256 + `DATA_ENCRYPTION_KEY` si absents →
`docker compose build` → démarre postgres/redis/minio → `prisma migrate deploy`
(one-shot, abort si échec) → (re)démarre api + web → résumé/health.

## Sauvegarde & Disaster Recovery

```
Tier-2 (logique)   scripts/backup-pg.sh : pg_dump quotidien → gzip, rétention
                   14 j + dimanches 8 sem, miroir rclone off-host optionnel,
                   webhook de notification. RPO ~24 h.
Tier-1 (PITR)      pgBackRest (docker/postgres/Dockerfile, docker-compose.pitr.yml,
                   scripts/pitr-setup.sh + pitr-backup.sh, docs/DISASTER_RECOVERY.md) :
                   archivage WAL continu + base/diff/incr vers un dépôt S3-compatible
                   off-site chiffré (AES-256). RPO ~1 min, restauration point-in-time.
Roadmap            hot standby sur un 2ᵉ VPS (réplication streaming).
```

## CI/CD (GitHub Actions)

```
deploy.yml (push main / dispatch) :
  quality-api  → typecheck + prisma + tests unit + e2e (jest) + build
  quality-web  → typecheck + lint + build Next standalone
  e2e          → Playwright full-stack
  docker-build → valide le build des images api & web
  deploy-vps   → SSH : git fetch/checkout/pull --ff-only + scripts/deploy-vps.sh
  smoke        → health checks web & api post-déploiement

Mobile :
  android-build.yml / ios-build.yml → eas build --local sur runners
       (pas de quota cloud EAS) → APK/AAB Play (track internal) / .ipa TestFlight
  mobile.yml → typecheck + OTA `eas update --channel production` sur push main
```

**Android App Links** (`apps/web/public/.well-known/assetlinks.json`) : DEUX empreintes
SHA-256 (clé d'upload **et** Play App Signing) → les liens `nigerconnect.app` ouvrent l'app.

**Garde de sécurité pre-push** (réinstallable : `scripts/hooks/pre-push` + `scripts/setup-hooks.sh`) :
lance l'agent **gwani-pentest** en lecture seule sur le diff, bloque uniquement sur un
verdict réel `BLOCK_DEPLOY` (fail-open sinon ; bypass `SKIP_PENTEST=1 git push`).

---

# 8. PLAN EN 10 PHASES

```
                                              Semaine
Phase                                    1  2  3  4  5  6  7  8
─────────────────────────────────────────────────────────────────
 1. Setup projet + Docker               ██
 2. Auth (register, login, OAuth, JWT)   ████
 3. Profil + Photos + Galerie               ██
 4. Social (amis, suggestions, block)       ████
 5. Feed (posts, likes, commentaires)           ████
 6. Chat temps réel (Socket.io)                 ████
 7. App Mobile React Native                     ████████
 8. Carte Snap Map + Géoloc                          ████
 9. Marketplace + Associations                       ████
10. Notifications + Modération                           ████
─────────────────────────────────────────────────────────────────
MVP fonctionnel : semaine 5 (phases 1-5 + début 7)
Version complète : semaine 8
```

---

# 9. PROMPTS CLAUDE CODE — PHASE PAR PHASE

---

## PHASE 1 — Setup projet, monorepo, Docker

```
Initialise le monorepo NigerConnect. Stack : pnpm workspaces + Turborepo.

Crée la structure suivante :

nigerconnect/
├── apps/
│   ├── api/           → NestJS 10 + TypeScript + Prisma
│   └── mobile/        → React Native Expo SDK 54 + Expo Router
├── packages/
│   ├── shared-types/  → Types TypeScript partagés (User, Post, Message...)
│   └── config/        → ESLint + Prettier config partagée
├── docker-compose.yml → PostgreSQL 16, Redis 7, MinIO
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example

Pour apps/api/ :
- NestJS avec les modules : AppModule importe AuthModule (vide), 
  ProfileModule (vide), etc.
- Prisma configuré pour PostgreSQL
- Le schéma Prisma contient pour l'instant juste la table users 
  avec les champs de base (id, email, password_hash, first_name, 
  last_name, created_at)
- Health check sur GET /health
- Helmet.js activé
- CORS configuré depuis .env
- Logger structuré JSON (NestJS built-in)
- Variables d'env validées au démarrage avec Zod

Pour apps/mobile/ :
- Expo SDK 54 avec Expo Router
- Structure de base : app/(auth)/login.tsx, app/(tabs)/_layout.tsx
- Fichier de config pour les couleurs NigerConnect 
  (orange #E05206, vert #0DB02B, crème #FDFBF7, brun #1A0F0A)

Le docker-compose.yml doit permettre de lancer tout avec :
  docker compose up -d
  cd apps/api && pnpm dev

Pas de code métier à cette étape. Juste la fondation qui compile 
et qui tourne.
```

---

## PHASE 2 — Auth complet

```
Implémente le module Auth dans apps/api/src/auth/.

Le schéma Prisma doit inclure : users, identity_documents, refresh_tokens.
Lance la migration.

Endpoints :

POST /auth/register
  - Body : { email, password, firstName, lastName, phone }
  - Validation Zod : email valide, password 12+ chars avec 1 majuscule 
    1 chiffre 1 spécial, phone format international
  - Hash password avec argon2 (npm argon2)
  - Crée le user, retourne tokens
  - Rate limit : 3 par IP par heure

POST /auth/login
  - Body : { email, password }
  - Vérifie le hash argon2
  - Anti brute-force : après 5 échecs → lock 15min, puis 30min, puis 1h
  - Retourne : { accessToken, refreshToken, user }

POST /auth/google
  - Passport.js Google OAuth2 avec PKCE
  - Crée le user si premier login, sinon login existant
  - Retourne tokens

POST /auth/facebook
  - Même chose avec Facebook

POST /auth/apple
  - Même chose avec Apple

POST /auth/refresh
  - Body : { refreshToken }
  - Vérifie le refresh token hashé en base
  - Rotation : génère nouveau access + refresh, invalide l'ancien
  - Si le refresh token est déjà utilisé → ALERT : révoquer TOUS 
    les tokens du user (vol potentiel)

POST /auth/logout
  - Supprime le refresh token de la base
  - Ajoute le JWT access token dans un blacklist Redis (TTL = expiry restant)

GET /auth/me
  - Protected (JwtAuthGuard)
  - Retourne le user courant depuis le JWT sub

POST /auth/identity/submit
  - Protected
  - Upload multipart (document scan)
  - Valide : JPEG/PNG/PDF, max 10MB
  - Upload vers S3 (chiffré server-side encryption)
  - Crée une entrée identity_documents en status pending
  - Met le user en identity_status = 'pending'

GET /auth/identity/status
  - Protected
  - Retourne le statut de vérification

PATCH /auth/identity/review  (admin only)
  - Body : { userId, decision: 'approved' | 'rejected', reason? }
  - Met à jour identity_status du user
  - Si approved : planifier suppression du document à J+30

Guards à créer :
  - JwtAuthGuard : vérifie le JWT, check le blacklist Redis
  - VerifiedGuard : vérifie que identity_status === 'approved'
  - RolesGuard : vérifie le role (admin, moderator, user)

Décorateurs :
  - @CurrentUser() : injecte le user depuis le JWT
  - @Public() : marque une route comme publique (pas de JWT)

Tests unitaires : register, login, refresh avec rotation, brute force lock.
Tests E2E : flow complet register → login → refresh → me.
```

---

## PHASE 3 — Profil + Photos

```
Implémente le module Profile dans apps/api/src/profile/.

Schéma Prisma : les champs profil sont déjà dans la table users.
Ajoute la table user_photos. Lance la migration.

Endpoints :

GET /profile/me → mon profil complet
PATCH /profile/me → mise à jour partielle (bio, city, countryCode, 
    languages, privacyLevel, showOnMap, latitude, longitude)
    Validation Zod sur chaque champ.
    Invalide le cache Redis du profil.

GET /profile/:id → profil d'un autre user
    - Si profil public : retourne tout
    - Si profil friends : vérifier qu'on est ami (query friendships)
    - Si profil private : retourne 404
    - Ne JAMAIS retourner password_hash, mfa_secret, etc.

GET /profile/:id/photos → galerie photos (paginé, 20 par page)
POST /profile/me/photos → ajouter une photo (presigned URL S3)
DELETE /profile/me/photos/:photoId → supprimer
PATCH /profile/me/avatar → changer avatar_url
PATCH /profile/me/cover → changer cover_url

GET /profile/search?q=&country=&city= → recherche de profils
    - Full text search PostgreSQL sur first_name, last_name, display_name
    - Filtres optionnels par country_code et city
    - Ne retourne que les profils publics + les amis
    - Pagination cursor-based (pas offset)
    - Exclure les users bloqués

Cache Redis :
  - Clé : profile:{userId}
  - TTL : 5 minutes
  - Invalidé sur PATCH

Utilise un ProfileSerializer pour ne jamais exposer les champs sensibles.

Tests : CRUD profil, privacy levels, recherche.
```

---

## PHASE 4 — Social (amis)

```
Implémente le module Social dans apps/api/src/social/.

Schéma Prisma : tables friendships et blocks. Migration.

Endpoints amitié :

POST /friends/request/:userId → envoyer une demande
    - Vérifier qu'on n'est pas bloqué par l'autre
    - Vérifier qu'il n'y a pas déjà une demande en cours
    - Créer friendship (status: pending)
    - Émettre une notification (via NotificationService injection)

POST /friends/accept/:friendshipId → accepter
    - Vérifier que je suis l'addressee
    - Passer en status: accepted
    - Notification à l'autre

POST /friends/decline/:friendshipId → refuser
DELETE /friends/:userId → supprimer un ami

GET /friends → mes amis (paginé)
    - Requête bidirectionnelle : je suis requester OU addressee
    - Trié par display_name
    - Retourne les profils résumés (id, name, avatar, city, country, online)

GET /friends/requests → demandes reçues en attente
GET /friends/requests/sent → demandes envoyées

GET /friends/mutual/:userId → amis en commun
    - Requête SQL optimisée (intersection)

GET /friends/suggestions → suggestions d'amis
    - Algorithme simple :
      1. Amis des amis (pas déjà ami, pas bloqué)
      2. Même pays
      3. Même ville
    - Score = amis_communs * 3 + même_ville * 2 + même_pays * 1
    - Retourne top 20

Endpoints blocage :

POST /blocks/:userId → bloquer
    - Supprime aussi l'amitié si existante
    - L'autre ne peut plus : voir mon profil, m'envoyer de message,
      me voir sur la carte, me retrouver en recherche

DELETE /blocks/:userId → débloquer
GET /blocks → liste des bloqués

Middleware important : dans TOUS les autres modules, vérifier les blocages.
Créer un BlockService injectable avec : isBlocked(userId1, userId2): boolean.
Le cache Redis pour éviter un query à chaque requête.

Tests : flow complet demande → acceptation → amis communs → suppression.
Test blocage : vérifier qu'un user bloqué ne peut rien faire.
```

---

## PHASE 5 — Feed (posts, likes, commentaires, stories)

```
Implémente le module Feed dans apps/api/src/feed/.

Schéma Prisma : tables posts, post_media, likes, comments. Migration.

Endpoints posts :

POST /posts → créer un post
    - Body : { content, visibility, mediaUrls[], associationId? }
    - Validation : content max 5000 chars, max 10 médias
    - Si associationId : vérifier que je suis membre

GET /posts/:id → détail d'un post
    - Inclure auteur (profil résumé), médias, like_count, 
      comment_count, isLikedByMe

PATCH /posts/:id → modifier (auteur uniquement, dans les 24h)
DELETE /posts/:id → soft delete

Endpoints feed :

GET /feed → mon fil d'actualité
    - Posts de mes amis + posts publics + posts des associations
      dont je suis membre
    - Exclure les users bloqués
    - Tri : chronologique (plus récent d'abord)
    - Pagination cursor-based (cursor = created_at du dernier post)
    - Limite : 20 posts par page
    - Cache Redis du feed (TTL 2min, invalidé quand un ami poste)

    Requête SQL :
    SELECT p.* FROM posts p
    WHERE (
      p.author_id IN (SELECT friend_id FROM my_friends_view WHERE ...)
      OR p.visibility = 'public'
      OR p.association_id IN (SELECT association_id FROM my_memberships)
    )
    AND p.author_id NOT IN (SELECT blocked_id FROM blocks WHERE ...)
    AND p.is_story = FALSE
    ORDER BY p.created_at DESC
    LIMIT 20

Endpoints interactions :

POST /posts/:id/like → toggle like (like si pas liké, unlike sinon)
    - Met à jour like_count (incrément/décrément)
    - Notification à l'auteur (sauf si c'est moi)
    
GET /posts/:id/likes → liste des likers (paginé)

POST /posts/:id/comments → commenter
    - Body : { content, parentId? }
    - content max 1000 chars
    - parentId pour les réponses (1 niveau de profondeur max)
    - Notification à l'auteur du post

GET /posts/:id/comments → commentaires (paginé)
    - Inclure les réponses imbriquées
    - Inclure auteur de chaque commentaire

POST /posts/:id/share → repartager
    - Crée un nouveau post de type "share" avec référence au post original

Endpoints stories :

POST /stories → créer une story
    - Comme un post mais is_story = true, story_expires_at = NOW() + 24h
    - Max 1 média par story

GET /stories/feed → stories de mes amis
    - Groupées par auteur
    - Seulement celles qui n'ont pas expiré
    - Trié par plus récent d'abord

Cron job (BullMQ) : supprimer les stories expirées toutes les heures.

Tests : créer post avec médias, feed avec filtrage, like toggle, 
commentaires imbriqués, stories expiration.
```

---

## PHASE 6 — Chat temps réel

```
Implémente le module Chat dans apps/api/src/chat/.

Schéma Prisma : tables conversations, conversation_members, messages. 
Migration.

REST endpoints (pour l'historique) :

GET /conversations → mes conversations
    - Trié par last_message_at DESC
    - Inclure : dernier message (preview), autre participant(s), 
      unread_count, avatar
    - Pagination cursor

GET /conversations/:id/messages → messages d'une conversation
    - Paginé par cursor (du plus récent au plus ancien)
    - 50 par page
    - Vérifier que je suis membre de la conversation

POST /conversations → créer une conversation
    - Body : { participantIds[], name? }
    - Si 1 participant : conversation directe (vérifier qu'il n'y en a 
      pas déjà une)
    - Si 2+ : groupe

POST /conversations/:id/messages → envoyer un message (fallback REST)
DELETE /messages/:id → supprimer un message

Socket.io Gateway (chat.gateway.ts) :

Namespace : /chat
Auth : JWT passé dans handshake auth → vérifié dans middleware

Événements serveur → client :
  - message:new → nouveau message (à tous les membres de la conversation)
  - message:read → message lu par X
  - typing:start → X est en train d'écrire
  - typing:stop → X a arrêté d'écrire
  - user:online → un ami est en ligne
  - user:offline → un ami est hors ligne

Événements client → serveur :
  - message:send → { conversationId, content, type, mediaUrl?, replyToId? }
  - message:read → { conversationId, messageId }
  - typing:start → { conversationId }
  - typing:stop → { conversationId }

Présence en ligne :
  - À la connexion Socket : ajouter dans Redis SET online_users
  - Heartbeat toutes les 30 secondes
  - TTL Redis 60 secondes
  - À la déconnexion : retirer du SET après un délai de 10 secondes 
    (pour gérer les reconnexions)
  - GET /users/online → liste des amis en ligne

Rooms Socket.io :
  - Chaque user rejoint une room "user:{userId}"
  - Chaque conversation a une room "conv:{conversationId}"
  - Au join, rejoindre toutes ses rooms de conversations

Notification push :
  - Si le destinataire n'est PAS connecté en WebSocket → envoyer 
    une push notification via NotificationService

Unread count :
  - Incrémenter unread_count dans conversation_members quand un 
    message arrive
  - Remettre à 0 quand le user envoie message:read

Tests : créer conversation, envoyer message, vérifier broadcast, 
présence, unread count.
```

---

## PHASE 7 — App Mobile React Native

```
Développe l'app mobile NigerConnect dans apps/mobile/.

Tech : Expo SDK 54, Expo Router v4, Zustand, React Query (TanStack), 
React Native Reanimated 3, expo-image, expo-secure-store.

Le design doit reprendre EXACTEMENT le prototype React qu'on a fait :
  - Palette : Orange #E05206, Vert #0DB02B, Crème #FDFBF7, Brun #1A0F0A
  - Font : DM Sans (expo-font + Google Fonts)
  - Coins arrondis 14-18px, ombres subtiles
  - Animations fluides (Reanimated pour les transitions)

Navigation (Expo Router) :

app/
├── _layout.tsx              → RootLayout (providers : QueryClient, 
│                               AuthProvider, SocketProvider)
├── (auth)/
│   ├── _layout.tsx          → Stack sans header
│   ├── welcome.tsx          → Landing page (celle du prototype)
│   ├── login.tsx            → Email/password + boutons Google/Facebook/Apple
│   ├── register.tsx         → 3 étapes : infos → pays → photo profil
│   └── verify-identity.tsx  → Upload document
├── (tabs)/
│   ├── _layout.tsx          → Tab bar custom (5 onglets : Carte, Fil, 
│   │                          Services, Messages, Profil)
│   ├── map.tsx              → Snap Map (react-native-maps)
│   ├── feed.tsx             → Fil d'actualité avec stories en haut
│   ├── services.tsx         → Marketplace entraide
│   ├── messages.tsx         → Liste conversations
│   └── profile.tsx          → Mon profil
├── chat/[id].tsx            → Écran de chat
├── user/[id].tsx            → Profil d'un autre user
├── post/[id].tsx            → Détail d'un post
├── association/[id].tsx     → Page association
└── settings/
    ├── index.tsx
    └── privacy.tsx

Services API (services/) :

api.ts → Instance Axios avec :
  - baseURL depuis .env
  - Interceptor request : ajouter Authorization Bearer
  - Interceptor response 401 : tenter refresh automatique
  - Si refresh échoue : redirect vers login
  - Tokens stockés dans expo-secure-store

authApi.ts → register, login, loginGoogle, loginFacebook, refresh, logout
profileApi.ts → getProfile, updateProfile, uploadPhoto, searchProfiles
friendsApi.ts → sendRequest, accept, decline, getFriends, getSuggestions
feedApi.ts → getFeed, createPost, likePost, getComments, createComment
chatApi.ts → getConversations, getMessages, createConversation
marketplaceApi.ts → getServices, createService, respondToService

Stores Zustand (stores/) :

authStore.ts → { user, tokens, isAuthenticated, login, logout, refresh }
chatStore.ts → { conversations, activeConversation, unreadTotal }

Socket.io (hooks/useSocket.ts) :

- Connexion au namespace /chat avec JWT dans auth
- Auto-reconnect
- Écouter : message:new, typing:start, user:online
- Émettre : message:send, typing:start, message:read

Écrans clés à implémenter en détail :

1. Feed : 
   - Stories en haut (ScrollView horizontal, dégradé border pour non-vues)
   - Pull-to-refresh
   - Posts avec photos (carousel si plusieurs), likes animés (❤️ bounce), 
     commentaires (bottom sheet)
   - FAB pour nouveau post

2. Messages :
   - Amis en ligne en haut (avatars avec point vert)
   - Liste conversations avec unread badge
   - Swipe to delete/archive

3. Chat :
   - Bulles de messages (orange pour moi, blanc pour l'autre)
   - Typing indicator animé (3 points)
   - Envoi de photos (expo-image-picker)
   - Reply (swipe right sur un message)

4. Profil :
   - Header avec avatar, stats (amis, photos, assos), bio
   - Grille de photos (3 colonnes)
   - Boutons : Modifier / Ajouter ami / Message
   - Badge vérifié ✓

Commence par le layout, auth, et feed. Les autres écrans viendront 
dans les phases suivantes.
```

---

## PHASE 8 — Carte Snap Map

```
Implémente la carte style Snap Map.

Backend (apps/api/src/geo/) :

Endpoints :

GET /geo/members?bounds=...&zoom=...
    - bounds = { north, south, east, west } (viewport de la carte)
    - zoom = niveau de zoom (1-20)
    
    Logique de clustering :
    - zoom < 4 : grouper par country_code 
      → retourner { countryCode, lat, lon, count, flag }
    - zoom 4-8 : grouper par ville 
      → retourner { city, countryCode, lat, lon, count }
    - zoom > 8 : retourner les individus 
      → { userId, name, avatar, city, lat, lon, online }
    
    Filtres : 
    - Seulement les users avec show_on_map = true
    - Exclure les users bloqués
    - Filtrer par type : people | associations | all

GET /geo/stats 
    → { totalMembers, countryCounts: [{code, count}], topCities }

GET /geo/nearby?lat=...&lon=...&radius=... 
    → membres proches (utiliser distance Haversine en SQL, pas besoin 
      de PostGIS pour cette échelle)

Requête SQL pour la distance :
    SELECT *, 
      (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * 
       cos(radians(longitude) - radians(?)) + 
       sin(radians(?)) * sin(radians(latitude)))) AS distance
    FROM users
    WHERE show_on_map = TRUE
    HAVING distance < ?
    ORDER BY distance

Cache Redis des clusters par zoom level (TTL 5min).

Mobile (apps/mobile/app/(tabs)/map.tsx) :

Utilise react-native-maps (MapView) avec react-native-map-clustering.

- Markers personnalisés : 
  - Personnes : photo de profil ronde (Image dans un Marker), 
    bordure blanche, point vert si en ligne
  - Associations : icône emoji dans un cercle bleu
  - Clusters : cercle blanc avec nombre + drapeau du pays

- Au chargement : centrer sur la position de l'utilisateur 
  (expo-location, permission demandée)
- Quand la carte bouge ou zoom change : appeler GET /geo/members 
  avec les nouvelles bounds

- Clic sur un marker individuel : 
  Bottom sheet (react-native-bottom-sheet) avec :
  - Photo, nom, ville, pays, bio
  - Boutons : Message / Ajouter ami / Voir profil
  - Mini galerie de 4 photos

- Clic sur un cluster :
  Zoom in animé sur le cluster

- Filtres en haut : pills "Tous", "Personnes", "Associations"

- Boutons en bas à droite :
  - Ma position (re-centrer)
  - Zoom + / -

Design : carte style Apple Maps (claire, colorée, pas sombre).
```

---

## PHASE 9 — Marketplace + Associations

```
Implémente les modules Marketplace et Association.

=== MARKETPLACE (apps/api/src/marketplace/) ===

Schéma Prisma : tables service_requests, service_responses, 
service_ratings. Migration.

Endpoints :

POST /services → créer une demande
    - Body : { title, description, category, urgency, budget?, 
      city?, countryCode? }
    - Categories : logement, transport, admin, sante, emploi, 
      business, education, autre

GET /services → lister les demandes
    - Filtres : category, country, urgency, status
    - Tri : recent, urgent_first
    - Pagination cursor
    - Inclure auteur (profil résumé), response_count

GET /services/:id → détail
GET /services/mine → mes demandes

POST /services/:id/respond → répondre à une demande
    - Body : { message }
    - Notification à l'auteur

GET /services/:id/responses → réponses (auteur de la demande only)
PATCH /services/:id/resolve → marquer comme résolu
POST /services/:id/rate → noter l'aidant (1-5 étoiles + commentaire)

Mobile : écran services.tsx reprenant le design du prototype 
(catégories en pills, cards avec avatar auteur, badge urgence, 
bouton Répondre).

=== ASSOCIATIONS (apps/api/src/association/) ===

Schéma Prisma : tables associations, association_members, 
association_events. Migration.

Endpoints :

POST /associations → créer (identity_status = approved requis)
GET /associations → lister (filtres : country, category)
GET /associations/:id → page complète + membres + events
PATCH /associations/:id → modifier (admin asso only)

POST /associations/:id/join → demander à rejoindre
POST /associations/:id/leave → quitter
PATCH /associations/:id/members/:userId/role → changer rôle 
    (admin asso only)
GET /associations/:id/members → membres (paginé)

POST /associations/:id/events → créer un événement (admin/moderator)
GET /associations/:id/events → événements à venir
GET /events/upcoming → tous les prochains événements (toutes assos)

POST /associations/:id/posts → poster au nom de l'association 
    (admin/moderator)
    → crée un post avec association_id, apparaît dans le feed 
      des membres

Mobile : écran association/[id].tsx avec header (logo, cover, 
description), liste des membres avec rôles, événements à venir, 
fil de posts de l'association.
```

---

## PHASE 10 — Notifications + Modération + Polish

```
Dernière phase : notifications, modération, et polish de l'app.

=== NOTIFICATIONS (apps/api/src/notification/) ===

Schéma Prisma : tables notifications, push_tokens. Migration.

Le NotificationService est injecté dans les autres modules. 
Il est appelé quand :
  - friend.requested → "X veut être votre ami"
  - friend.accepted → "X a accepté votre demande"
  - post.liked → "X a aimé votre publication"
  - post.commented → "X a commenté votre publication"
  - message.received → "X vous a envoyé un message"
  - service.responded → "X a répondu à votre demande"
  - identity.approved → "Votre identité a été vérifiée ✓"
  - identity.rejected → "Votre demande de vérification a été refusée"

Méthodes du NotificationService :
  - createNotification(userId, type, title, body, data, actorId)
    → Insère en base + envoie push si user pas connecté en WebSocket
  - sendPush(userId, title, body, data) 
    → Expo Push Service (FCM optionnel)
  - sendEmail(to, template, variables)
    → SMTP IONOS via nodemailer (bienvenue, identité approuvée, résumé hebdo)

Endpoints :
  GET /notifications → mes notifications (paginé)
  PATCH /notifications/:id/read → marquer comme lue
  PATCH /notifications/read-all → tout marquer comme lu
  POST /notifications/register-device → { token, platform }

Groupement intelligent (BullMQ delayed job) :
  - Si 5+ likes en 5 min → regrouper en une seule notif 
    "X, Y et 3 autres ont aimé votre publication"

Mobile :
  - expo-notifications pour les push
  - Badge sur l'icône de l'app (expo-notifications setBadgeCountAsync)
  - Badge sur l'onglet notifications dans la tab bar

=== MODERATION (apps/api/src/moderation/) ===

Schéma Prisma : table reports. Migration.

Endpoints :

POST /reports → signaler
    - Body : { targetType, targetId, reason, description }
    - targetType : user | post | message | association
    - reason : spam | harassment | inappropriate | fake_identity | 
      scam | other

GET /reports → file d'attente (admin/moderator only)
    - Filtré par status
    - Inclure le contenu signalé

PATCH /reports/:id/resolve → résoudre (admin only)
    - Body : { action: warning | content_removed | suspended | 
      banned | dismissed, note }
    - Si content_removed : soft delete du post/message
    - Si suspended : mettre user.status = 'suspended' + durée
    - Si banned : mettre user.status = 'banned'
    - Log de l'action dans le report

Mobile :
  - Bouton "Signaler" sur chaque profil, post, message (menu ⋯)
  - Modal avec choix du motif

=== POLISH FINAL ===

- Vérifier que tous les écrans sont responsive
- Animations de transition entre les écrans (Reanimated)
- Pull-to-refresh sur feed, messages, services
- Empty states (pas de posts, pas d'amis, pas de messages)
- Loading skeletons (pas de spinner blanc)
- Error boundaries avec écran d'erreur user-friendly
- Deep linking (ouvrir un profil/post depuis un lien)
- Seed de données : 20 faux utilisateurs, 5 associations, 
  30 posts, 10 conversations pour la démo
- README avec instructions d'installation et captures d'écran

Tests E2E : flow complet register → verify → add friend → post → 
like → comment → message → create service → report.
```

---

# RÉSUMÉ

| Phase | Contenu | Durée |
|-------|---------|-------|
| 1 | Setup monorepo + Docker | 1 jour |
| 2 | Auth complet (register, OAuth, JWT, identité) | 3 jours |
| 3 | Profil + Photos + Recherche | 2 jours |
| 4 | Amis, suggestions, blocage | 2 jours |
| 5 | Posts, feed, likes, commentaires, stories | 3 jours |
| 6 | Chat temps réel (Socket.io) | 3 jours |
| 7 | App mobile complète | 5 jours |
| 8 | Carte Snap Map | 3 jours |
| 9 | Marketplace + Associations | 3 jours |
| 10 | Notifications, modération, polish | 3 jours |
| **Total** | **MVP complet** | **~6 semaines** |

## MVP minimal (démo fonctionnelle) : Phases 1-5 + 7 = 3 semaines

## Conseils d'exécution

1. **Copiez chaque prompt dans Claude Code** dans l'ordre
2. **Testez chaque phase** avant de passer à la suivante
3. **Commitez après chaque phase** : git tag v0.1, v0.2...
4. **La phase 7 (mobile)** peut commencer en parallèle de la phase 5
5. **Ne faites PAS de microservices** — ce monolithe tiendra facilement 
   jusqu'à 100K users
6. **Si un module a besoin de scaler** plus tard (ex: chat), alors 
   seulement à ce moment-là on l'extrait en service séparé
