# Security Audit — NigerConnect (Mode A, post-push, read-only)

- **Range:** `9b55a7c..e33c491` (4 commits)
- **Date:** 2026-06-13
- **Auditor:** gwani-pentest
- **Scope:** diff-only review (OWASP Top 10 2021 / API Top 10 2023), per `CLAUDE.md` conventions.
- **Method:** SAST + manual diff review. No DAST executed (read-only constraint).

## Commits in range

| SHA | Subject |
|---|---|
| 5b1da25 | chore(infra): migrate domain to nigerconnect.app + split admin to tenant subdomain |
| e270992 | feat(legal): RGPD-compliant CGU + privacy + mentions légales |
| 458fdde | fix(security): harden prod — WS jti revocation, bind entity media URLs, mask 500s |
| e33c491 | refacto et news letters (newsletter module) |

## Summary

This range is **net security-positive**. Commit `458fdde` closes three previously-identified
weaknesses (WS jti revocation, entity media SSRF binding, 500 info-disclosure), each with a
regression test. The new **newsletter module** (`e33c491`) follows project conventions closely:
Zod validation on every body, `@Public()` + tight throttling on public routes, `RolesGuard`
+ `@Roles('admin')` on the admin console (on top of the global JWT + EmailVerified guards),
cryptographically-strong unsubscribe tokens, anti-enumeration behaviour, and HTML escaping on
admin-composed campaigns. No Critical or High finding was introduced by this diff.

## Findings

| # | Severity | Location | Class | Status |
|---|----------|----------|-------|--------|
| 1 | Info | `apps/mobile/google-services.json` (tracked, pre-existing) | A05 — config | Pre-existing, outside diff |
| 2 | Info | `apps/api/src/newsletter/dto/newsletter.dto.ts:32-34` | A03/A08 — admin-authored raw `bodyHtml` | Accepted (admin-trusted) |
| 3 | Info | `apps/web/middleware.ts:16-18` | A05 — host-prefix admin gating | Defense-in-depth, OK |
| 4 | Info | `apps/api/src/newsletter/newsletter.service.ts:201` | A04 — in-process dispatcher, `sending` stuck on restart | Documented limitation |

No Critical / High / Medium / Low findings introduced by this range.

### Verified hardening (positive controls confirmed in this diff)

**A07/A01 — WS jti revocation** — `apps/api/src/chat/chat.gateway.ts:91-94`
Handshake now consults the Redis jti blacklist (`isJwtBlacklisted`), mirroring the REST
`JwtAuthGuard`. A revoked/logged-out access token can no longer open a `/chat` socket.
Regression test: `apps/api/src/chat/chat.gateway.spec.ts`.

**A10/A08 — Entity media binding (SSRF / cross-user object)** —
`apps/api/src/page/page.service.ts:40-56,133-145` and
`apps/api/src/association/association.service.ts:49-66,157-168,425-427`
Page avatar/cover and association logo/cover/event-cover are now bound via
`S3Service.assertOwnedPublicImage(url, ownerId)` on both create and partial update. The helper
(`s3.service.ts:212-241`) parses the public key, requires the `users/<ownerId>/` prefix, HEADs
the object, and enforces image MIME + size. Update DTOs declare these fields `.optional()`
(string-or-undefined, never null) and the `!== undefined` guard always passes a string. Closes
SSRF-to-internal-host and foreign-URL / cross-user-object injection. Matches posts/stories/chat.

**A05/A09 — 500 masking** — `apps/api/src/common/filters/http-exception.filter.ts:64-80`
Non-HTTP exceptions now return a stable `"Internal server error"` and the raw exception is **not**
spread into the body (`raw` is `null` for non-HTTP). Full detail still logged + sent to Sentry with
a scrubbed URL. HttpExceptions remain author-controlled and safe to echo. No Prisma/driver/path leak.

### Newsletter module review (new code, `e33c491`)

- **Validation / mass-assignment** — every body uses `ZodValidationPipe` with bounded schemas
  (`newsletter.dto.ts`). Page/association update DTOs are strict allow-lists (no `role`/`ownerId`/
  `status`), so the `{ ...dto }` spread into Prisma update is not a mass-assignment vector.
- **AuthZ** — public routes (`newsletter.controller.ts`) are `@Public()` and throttled
  (5/min, 20/h on subscribe). Admin routes (`newsletter.admin.controller.ts`) are gated by
  `RolesGuard` + `@Roles('admin')` *and* the global JWT/EmailVerified guards (`auth.module.ts:34-35`).
  IDs validated by `ParseUUIDPipe`.
- **Account enumeration** — `subscribe()` is an idempotent `upsert` and the controller always
  returns a generic `{ ok: true }` (`newsletter.controller.ts:30`). Unsubscribe returns the same
  page for unknown vs already-unsubscribed tokens. No oracle.
- **Tokens** — `randomBytes(32).toString('hex')` (256-bit), looked up by exact match; unguessable.
  Validation schema bounds token to 16-64 chars.
- **Open-relay / abuse** — `testCampaign` (arbitrary recipient) is throttled (5/min, 30/h) and
  admin-only, with an explicit defense-in-depth comment. Bulk send is an atomic `draft→sending`
  `updateMany` claim, preventing double-dispatch.
- **XSS** — admin UI composes campaigns from plain text via `textToHtml()` which HTML-escapes
  `& < > " '` (`apps/web/components/admin/NewsletterSection.tsx:43-50`); no `dangerouslySetInnerHTML`.
  Raw `bodyHtml` can still be POSTed directly to the admin API and is rendered in recipient emails —
  acceptable since campaign authoring is admin-trusted (Finding #2, Info).
- **Headers / URL** — `List-Unsubscribe` / `List-Unsubscribe-Post` set per-recipient
  (`mailer.service.ts`); unsubscribe URL is `encodeURIComponent`-escaped (`newsletter.service.ts:273`).

### Infra / config (`5b1da25`)

- CORS default is an explicit allow-list `https://${WEB_HOST},https://${ADMIN_HOST}` — **not** a
  wildcard (`docker-compose.prod.yml`). `ADMIN_HOST` is mandatory (`:?` Traefik rule).
- Admin console split by Host: Traefik routes only `tenant.*` to the container; `middleware.ts`
  404s `/admin` on the public apex and rewrites it onto the admin host. Edge routing is the real
  control; the middleware host-prefix check is defense-in-depth (Finding #3, Info).
- No hardcoded secrets in the diff (only the test fixture `'valid.jwt.token'`). Domain migration only.

### Finding #1 detail — google-services.json

`apps/mobile/google-services.json` is tracked in git (added in `d2bb9e9`, long before this range, so
EAS Build can embed it). Firebase config files contain a client API key that is identifying rather
than secret by Google's design; restrict it by package name / SHA in the Google Cloud console.
Out of scope for this diff-focused audit — noted because project `CLAUDE.md` flags tracked secret files.

## Verdict

No open Critical or High findings. This range removes risk on net (three prior weaknesses fixed
with regression tests; the new newsletter module is conformant). Safe to deploy.

OK_TO_DEPLOY
