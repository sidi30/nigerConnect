# Déploiement Web (Next.js sur Vercel)

Ce guide couvre uniquement `apps/web` (la landing/site marketing Next.js 16). Pour
l'API NestJS et le mobile, voir `docs/DEPLOYMENT.md` et `apps/mobile/eas.json`.

## Architecture cible

```
            ┌─────────────────────────┐
            │  Vercel — apps/web      │   www.nigerconnect.ne
            │  Next.js 16 (Edge)      │
            └───────────┬─────────────┘
                        │  fetch
                        ▼
            ┌─────────────────────────┐
            │  Railway / Render       │   api.nigerconnect.ne
            │  NestJS + Postgres +    │
            │  Redis + S3 (R2/MinIO)  │
            └─────────────────────────┘
```

Vercel ne sert que le front Next.js. Le backend NestJS reste hébergé séparément
parce qu'il a besoin de connexions long-running (Socket.io), Prisma, BullMQ —
des charges qui ne tournent pas idéalement en serverless.

## Étape 1 — Créer le projet Vercel

1. Va sur [vercel.com/new](https://vercel.com/new), connecte ton compte GitHub.
2. Importe le repo `nigerconnect`.
3. **Root Directory** : `apps/web`
4. **Framework Preset** : Next.js (auto-détecté)
5. **Build & Output Settings** : laisser les valeurs du `vercel.json` (déjà
   configuré dans le repo). Vercel détecte automatiquement le `installCommand`
   et le `buildCommand`.
6. Avant le premier deploy, ajoute les variables d'environnement (étape 2)
   puis clique **Deploy**.

## Étape 2 — Variables d'environnement

Vercel → Project Settings → Environment Variables. Configure pour chaque
environnement (`Production`, `Preview`, `Development`) :

| Variable | Production | Preview | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.nigerconnect.ne` | `https://api-staging.nigerconnect.ne` | URL publique de l'API NestJS (sans `/api` final) |
| `NEXT_PUBLIC_APP_URL` | `https://nigerconnect.ne` | `https://staging.nigerconnect.ne` | Origine du front (sitemap, OG, robots) |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://xxx@sentry.io/yyy` | (optionnel) | DSN Sentry browser. Vide = reporting désactivé. |

Fichier `.env.example` à jour : voir `apps/web/.env.example`.

## Étape 3 — Brancher le pipeline GitHub Actions

Le workflow `.github/workflows/web.yml` :

- déclenche un **preview deploy** à chaque PR qui touche `apps/web/**` ;
- promeut en **production** à chaque push sur `main` ;
- bloque le déploiement si `typecheck` ou `lint` échouent ;
- commente la PR avec l'URL de preview (mise à jour à chaque push).

### Secrets GitHub à configurer

Dépôt → Settings → Secrets and variables → Actions → New repository secret :

| Secret | Où l'obtenir |
|---|---|
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) → Create Token (scope = full account, expiry 1 an) |
| `VERCEL_ORG_ID` | Après le 1er deploy local : `apps/web/.vercel/project.json` → champ `orgId` |
| `VERCEL_PROJECT_ID_WEB` | Idem fichier ci-dessus → champ `projectId` |

Pour récupérer `orgId` / `projectId` sans déployer manuellement :

```bash
cd apps/web
npx vercel link --yes   # te demande à quel projet Vercel lier
cat .vercel/project.json
```

> Le dossier `.vercel/` est déjà ignoré par `.gitignore`, donc rien n'est commité.

## Étape 4 — Domaine personnalisé

Vercel → Project → Settings → Domains :

1. Ajoute `nigerconnect.ne` et `www.nigerconnect.ne` (Vercel propose un redirect
   automatique du `apex` vers `www` ou l'inverse — choisis en fonction de ta
   préférence SEO).
2. Vercel te donne soit un `A record` (76.76.21.21) soit un `CNAME` à pointer
   chez ton registrar (OVH, Namecheap, etc.). Apex domain = `A record`,
   sous-domaine = `CNAME`.
3. Le certificat SSL Let's Encrypt est généré automatiquement en moins de 60s.

## Étape 5 — Headers de sécurité (déjà inclus)

Le `apps/web/vercel.json` configure déjà :

- `X-Frame-Options: DENY` — anti-clickjacking
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

Vérifie après le 1er deploy avec [securityheaders.com](https://securityheaders.com/?q=nigerconnect.ne). Cible : note **A** ou **A+**.

## Étape 6 — Promouvoir une preview en production

Si une preview est validée et que tu veux la mettre en prod sans rebuild :

```bash
# Récupère l'URL de la preview
vercel ls

# Promeut en prod (instantané, même artefact)
vercel promote https://nigerconnect-web-abc123.vercel.app
```

C'est plus rapide qu'un `vercel deploy --prod` (pas de rebuild) et garantit
que c'est exactement le même artefact qui passe en prod.

## Étape 7 — Rollback en cas d'incident

```bash
# Liste des derniers prod
vercel ls --prod

# Rollback à l'avant-dernier
vercel rollback

# Rollback à un déploiement précis
vercel rollback https://nigerconnect-web-xyz789.vercel.app
```

Le rollback est instantané (re-aliasing, pas de rebuild).

## Checklist post-1er-deploy

- [ ] `curl -I https://nigerconnect.ne` → `HTTP/2 200` + tous les headers de sécurité présents
- [ ] [securityheaders.com](https://securityheaders.com/) note A ou A+
- [ ] `https://nigerconnect.ne/sitemap.xml` répond et liste les routes
- [ ] `https://nigerconnect.ne/robots.txt` est cohérent (pas `Disallow: /` accidentel)
- [ ] Les images `next/image` sont servies en `image/webp` (vérifie via DevTools → Network)
- [ ] Lighthouse score ≥ 90 sur Mobile + Desktop (Performance, Accessibility, Best Practices, SEO)
- [ ] Sentry reçoit les premiers events (déclenche un 500 test si tu as branché un endpoint qui peut crasher)
- [ ] Le DNS est bien CNAME `cname.vercel-dns.com` (pour les sous-domaines) ou A `76.76.21.21` (apex)

## Coût indicatif

Plan Vercel **Hobby** (gratuit) :

- Bande passante : 100 GB/mois
- Builds : 6000 min/mois
- Edge requests : 1 M/mois
- Sites : illimités
- Domaines custom : illimités
- SSL : inclus

Suffit largement pour un site marketing. Passe en **Pro** ($20/mois) quand tu
dépasses 100 GB ou quand tu veux des analytics avancés.
