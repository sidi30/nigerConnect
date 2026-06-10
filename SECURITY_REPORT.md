# Security Audit — Mode A (post-push, read-only)

**Range audited (intent):** push that delivered the internal admin console + web CSP/env fixes.
**Strict commit range requested:** `bfcf5be..6c40a36` (single commit: CSP `connect-src` origin fix).
**Broader scope reviewed (same push):** `320caa1` admin Phase 1, `e2c3a3d` build-time env baking, `bfcf5be` `NEXT_PUBLIC_API_URL` prefix, `6c40a36` CSP origin fix, `74f920d` chat media-binding e2e test.

**Date:** 2026-06-09 · **Auditor:** gwani-pentest · **Mode:** strict read-only (no edits applied).

---

## Scope & method

Reviewed the pushed diff against OWASP Top 10 2021 / API Security Top 10 2023 and the project conventions in `CLAUDE.md` (Zod validation, AuthZ guards/IDOR, JWT RS256, media URL binding, privacy levels, CSP / `NEXT_PUBLIC_API_URL`). Read surrounding context (global guard wiring, JWT strategy, role decorator, the backend endpoints the admin UI calls) to confirm exploitability. No build/network/deploy run.

## AuthZ chain — verified SOUND

The admin console's server-side authorization was the primary risk and it holds up:

- Global guards are registered as `APP_GUARD` in `apps/api/src/auth/auth.module.ts:34-35` in order `JwtAuthGuard` -> `EmailVerifiedGuard`. Global guards run before controller-level `@UseGuards(RolesGuard)`, so `req.user` (with `role`) is populated before role checks.
- JWT is RS256, `kid`-dispatched, `iss`/`aud`/`exp` verified, blacklist (`jti`) checked (`jwt.strategy.ts`, `jwt-auth.guard.ts`). `role` is a signed claim (`current-user.decorator.ts:4-11`) — not client-controllable.
- `RolesGuard` (`roles.guard.ts`) throws `ForbiddenException` when `user.role` is not in the required set.
- Every admin-reachable endpoint is `@UseGuards(RolesGuard) @Roles('admin','moderator')`:
  - `apps/api/src/admin/admin.controller.ts:21-22` (`GET /admin/metrics`, `GET /admin/identity`)
  - `apps/api/src/auth/auth.controller.ts:239-241` (`PATCH /auth/identity/review`)
  - `apps/api/src/moderation/moderation.controller.ts:40-49` (`GET /reports`, `PATCH /reports/:id/resolve`)
- Identity-document images are exposed only via 300s presigned GETs (`admin.service.ts:114-126`); the private bucket is never public, URLs are not persisted/logged, and the path is `s3://<privateBucket>/` prefix-checked before presign.
- Client-side gating (`LoginForm.tsx:23-28` role check, `layout.tsx` token guard) is UX only; real enforcement is server-side. The `nc_admin_role` localStorage value is never trusted for authorization.

No IDOR found: identity list filters by `status`, cursor is `uuid()`-validated; the admin queries return aggregate/queue data appropriate to the admin/moderator role.

## CSP change (the strict range commit `6c40a36`) — NOT a weakening

`apps/web/next.config.mjs:22-32,40`: previously `connect-src 'self' <raw NEXT_PUBLIC_API_URL>`; if the env value carried a path (`.../api`) CSP treated it as an exact-path source and blocked sub-paths. The fix parses the URL and uses `new URL(apiUrl).origin`, falling back to the raw string only if unparseable. This narrows/normalizes to a single API origin — no wildcard, no new host, no `unsafe-*` added. Correctness fix; no security regression.

## Env baking (`e2c3a3d`) — no secret leakage

`apps/web/Dockerfile` and `docker-compose.prod.yml` bake `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_APP_URL` at build time. These are public origins (`NEXT_PUBLIC_*` are inlined into the client bundle by design). No secret, key, or token is introduced into the image. Diff-wide secret scan: clean.

---

## Findings

### [LOW] Admin access token stored in `localStorage` (XSS would exfiltrate the session) — OWASP A07 / CWE-522 (CVSS ~3.5)
- **Where:** `apps/web/lib/adminApi.ts:8-29` (`TOKEN_KEY` in `localStorage`, injected as `Authorization: Bearer`).
- **Evidence:** `window.localStorage.setItem(TOKEN_KEY, token)`; the same value is read for every admin request.
- **Impact:** Any script execution in the web origin (stored/reflected XSS, or a compromised first-party/inlined script) can read the admin/moderator JWT and act with that role until the ~15-min access token expires. Tokens in `localStorage` are not protected by `HttpOnly`/`SameSite`.
- **Mitigating factors:** short access-token TTL; CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY`; admin tree is `noindex`; no `dangerouslySetInnerHTML` in admin components (React auto-escapes rendered email/name/report fields). The Bearer + `credentials:false` (no cookies) model is an intentional CSRF trade-off documented in `main.ts:64-68`.
- **Fix (describe only):** acceptable for an internal console given the short TTL; if hardening, move the admin session to an `HttpOnly; Secure; SameSite=Strict` cookie with a server-side session, or keep the token in memory only. Tighten `script-src` (next finding) to reduce XSS reachability.

### [LOW] CSP allows `script-src 'self' 'unsafe-inline'` (pre-existing, not introduced by this push) — OWASP A05 / CWE-1021 (CVSS ~3.1)
- **Where:** `apps/web/next.config.mjs:36`.
- **Evidence:** `"script-src 'self' 'unsafe-inline'"`.
- **Impact:** `'unsafe-inline'` defeats CSP's XSS mitigation for inline scripts, raising the practical impact of the `localStorage` token model above. Not changed by this push (listed for context / defense-in-depth).
- **Fix (describe only):** migrate to nonce/hash-based inline scripts and drop `'unsafe-inline'` from `script-src`. Out of scope for this commit range; track separately.

### [INFO] Identity PII + ID-document images surfaced to `moderator` role
- **Where:** `apps/api/src/admin/admin.service.ts:73-112` (returns email, names, city, country, avatar + 300s presigned ID scan).
- **Assessment:** Intended function of the identity-review queue; correctly role-gated and short-lived. Noted for data-handling awareness (PII minimization / an access log of who viewed which document would be a good Phase 2 addition), not a vulnerability.

### [INFO] JWT role read from the access token, not re-checked against the DB per request
- **Where:** `roles.guard.ts:18-22` (reads `user.role` from the signed JWT).
- **Assessment:** A demoted admin keeps elevated access until the access token expires (<= ~15 min). Standard stateless-JWT trade-off; acceptable at this TTL. For immediate revocation on demotion, blacklist the `jti` (infra already present in `JwtAuthGuard`/Redis).

---

## Summary by severity

| Severity | Count | Open |
|----------|-------|------|
| critical | 0 | 0 |
| high     | 0 | 0 |
| medium   | 0 | 0 |
| low      | 2 | 2 |
| info     | 2 | — |

## Positive observations (this push)

- New `e2e/tests/api/chat-edit-delete.spec.ts` adds a security regression guard proving a foreign `mediaUrl` (SSRF/tracking-beacon, OWASP A01/A10) is rejected with 400.
- Admin endpoints consistently role-gated; identity docs only via short presigned GETs; private bucket never exposed.
- `/admin` added to `robots.ts` disallow + `noindex` meta/metadata.
- CORS `credentials:false`, body size capped (256kb), `poweredByHeader:false`, HSTS/Permissions-Policy/Referrer-Policy set, login/register throttled.
- No secrets introduced in the diff; `NEXT_PUBLIC_*` baking exposes only public origins.

## Fixes applied

None (strict read-only audit — no edits performed).

## Fixes proposed (human review)

- (Low) Consider migrating the admin session off `localStorage` to an `HttpOnly` cookie or in-memory storage.
- (Low) Plan removal of `script-src 'unsafe-inline'` via nonces/hashes.
- (Info) Add an access-audit log for identity-document views (Phase 2).

## Verdict

No open critical or high findings. The CSP and env changes are correctness-only and do not weaken security; the admin authZ chain is enforced server-side.

**OK_TO_DEPLOY**
