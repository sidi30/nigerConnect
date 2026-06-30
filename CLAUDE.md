# CLAUDE.md — NigerConnect

Réseau social de la diaspora nigérienne. Monorepo **pnpm + Turbo**. Backend monolithe modulaire **NestJS**, mobile **Expo React Native**, web **Next.js**.

## Layout

```
apps/api        NestJS (Prisma + PostgreSQL/PostGIS + Redis). Prefix global /api (sauf /health).
apps/mobile     Expo RN (expo-router). OTA + builds via EAS.
apps/web        Next.js.
packages/shared-types   Types partagés (@nigerconnect/shared-types) — build avant de typer api/mobile.
e2e             Playwright (tests API sous e2e/tests/api/*.spec.ts).
```

## Commandes

Racine (Turbo orchestre tous les workspaces) :
```bash
pnpm install
pnpm dev          # turbo run dev
pnpm test         # turbo run test
pnpm typecheck    # turbo run typecheck
pnpm lint
```
Ciblé :
```bash
pnpm --filter @nigerconnect/shared-types build
cd apps/api    && npx tsc --noEmit && npx jest [chemin/spec]      # unit
cd apps/mobile && npx tsc --noEmit
```
Prisma (apps/api) : `pnpm prisma:migrate` (dev), `pnpm prisma:deploy` (prod), `pnpm prisma:generate`.

## Conventions (à respecter en codant)

- **Validation** : tout body POST/PATCH/PUT passe par un schéma **Zod** via `ZodValidationPipe`. Le gateway WS rejoue la même validation que le REST.
- **AuthZ** : guards Nest (`CurrentUser`, `EmailVerifiedGuard` global qui lit la DB). Toute query Prisma sur ressource privée filtre par owner (`userId`/`senderId`) — pas d'IDOR. Vérifier l'ownership avant update/delete (ex. chat : `senderId !== userId → 403`).
- **JWT** : RS256 (clés `*.pem`), iss/aud vérifiés, révocation par `jti`.
- **Médias** : ne jamais persister une URL client brute. La binder via `S3Service.assertOwnedPublicImage(url, userId)` (clé `users/{userId}/...`) — vaut pour posts, stories ET chat.
- **Confidentialité** : niveaux `public`/`friends`/`private`. Un compte `private` ne doit fuiter ni sur la map (`/geo/*`), ni feed, ni recherche, ni proximité.
- **Types** : modifier `packages/shared-types` puis le rebuild ; api et mobile en dépendent.
- Écrire du code qui ressemble au code autour (mêmes idiomes, densité de commentaires, nommage).

## Gotchas (non-évidents — déjà rencontrés)

- **Windows + Norton MITM le TLS** : avant tout `npm`/`eas`/`node` réseau → `export NODE_EXTRA_CA_CERTS="/c/Users/ramzi/.certs/norton-root.pem"` (PowerShell : `$env:NODE_EXTRA_CA_CERTS=...`). Sinon `SELF_SIGNED_CERT_IN_CHAIN`.
- **`prisma generate` EPERM** (dll lockée par un dev server) → `npx prisma generate --no-engine` régénère juste les types (suffit pour `tsc`).
- **Glob/recherche** : le cwd par défaut est `apps/mobile` — utiliser des chemins absolus ou `--filter`.
- **Prod : API non publiée sur l'hôte** (Traefik devant). La tester en interne :
  `ssh root@46.224.193.109 'docker exec nigerconnect-api wget -qO- http://localhost:3000/api/...'` (curl local renvoie 000 à cause de Norton).
- **CRLF** : après extraction sur le VPS, `sed -i 's/\r$//'` les `.sh` (édités sous Windows).

## Déploiement

Détail complet + comptes (Apple/Expo/Play/VPS) : voir **`DEPLOY_PLAYBOOK.md`**. Résumé :

- **API/web** (déploie le dernier COMMIT, pas le working tree) :
  ```bash
  git archive HEAD | ssh -o BatchMode=yes root@46.224.193.109 \
    'cd /opt/apps/nigerConnect && tar xf - && find . -name "*.sh" -exec sed -i "s/\r$//" {} + \
     && chmod +x scripts/*.sh && ./scripts/deploy-vps.sh'
  ```
  Le script fait `prisma migrate deploy` + recreate des conteneurs api/web.
- **Mobile** : `runtimeVersion = appVersion`. **JS-only** → OTA `eas update --channel preview`. **Module natif ajouté/changé** → **rebuild EAS obligatoire** (l'OTA ne suffit pas). **Gros changement** → bump `app.json version`.
- Comptes : Apple Team `4SRJRX4N45`, Expo `sidi30`, VPS `root@46.224.193.109`.

## Sécurité

- Agent **gwani-pentest** (`~/.claude/agents/gwani-pentest.md`) : audit OWASP/SAST/DAST du diff, corrige + teste, verdict `BLOCK_DEPLOY`/`OK_TO_DEPLOY`. Hook `pre-push` optionnel (read-only, bloque si critical/high ; bypass `SKIP_PENTEST=1 git push`).
- Aucun secret en repo : `git ls-files | grep -E "\.p8$|\.pem$|\.keystore$|service-account.*\.json$|google-services\.json$|\.env"` doit ne RIEN renvoyer.

## Workflow imposé par le proprio

- À chaque gros changement → bump la version mobile.
- Pour détecter/corriger/tester des bugs : enchaîner les agents **bug-hunter → fixer → e2e-tester** (et **gwani-pentest** pour la sécu).
- **Construire/améliorer une feature de bout en bout** → agent **gwani-orchestrator** (`~/.claude/agents/gwani-orchestrator.md`), modèle Opus. Maître d'orchestre = **Product Owner + Scrum Master** : analyse la concurrence → en déduit la valeur → écrit + priorise le backlog (`memory/backlog.md`) → découpe en sprint → **délègue** chaque item au bon worker gwani (market-researcher → pm-spec → architect → backend/frontend → qa-tester → debugger → pentest → reviewer) → fait respecter la DoD (Zod, AuthZ/IDOR, privacy, **tests verts**, revue, verdict sécu, bump version mobile). **Ne code pas, ne déploie jamais** : il s'arrête au gate `READY_FOR_DEPLOY` et exige l'**approbation explicite du proprio** avant de déléguer à `gwani-deployer`/`gwani-mobile-deployer` (en respectant la consigne plateforme, ex. OTA iOS seul). S'appuie sur la machine d'état `memory/status.json`.
