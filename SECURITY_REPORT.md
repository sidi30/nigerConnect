# Security Audit — Post-Push Diff Review (Mode A, READ-ONLY)

- **Range:** `6df13db..6485eb9` (29 commits)
- **Scope:** new/changed API modules — admin, page, poll, review, association (invites), geo, chat (edit/delete), auth (OAuth/reset), moderation; web admin console; infra/config.
- **Method:** SAST (code read + grep), convention conformance vs `CLAUDE.md`, OWASP Top 10 2021 / API Top 10 2023 mapping. No DAST executed (read-only mandate).
- **Verdict:** No critical/high open findings. Three lower-severity items below — none block deploy.

---

## Findings

### [MEDIUM] WebSocket gateway does not honour JWT revocation (jti blacklist) — OWASP A07 / CWE-613 (CVSS 4.2)
- **Where:** `apps/api/src/chat/chat.gateway.ts:312-327` (`verifyToken`) vs `apps/api/src/auth/guards/jwt-auth.guard.ts:29`.
- **Evidence:** The REST guard rejects revoked tokens:
  `if (user?.jti && (await this.redis.isJwtBlacklisted(user.jti))) ...`.
  The gateway's `verifyToken` validates signature + `iss`/`aud`/`exp` only and never consults `redis.isJwtBlacklisted(payload.jti)`. `logout()` blacklists the access-token `jti` (`auth.service.ts:369-375`), so a logged-out (but not-yet-expired) access token is rejected on REST yet still opens a `/chat` socket and can send/read messages until natural expiry.
- **Impact:** A stolen or post-logout access token retains realtime chat access for the remainder of its TTL. Bounded by access-token lifetime; requires possession of a valid unexpired token.
- **PoC (safe, local):** Log in, capture `accessToken`, call `/api/auth/logout`, then open a socket to `/chat` with `auth.token = <that token>` and emit `message:read`/`message:send` — it still succeeds. (Not executed here; read-only.)
- **Fix (proposed):** In `verifyToken` / `handleConnection`, after decoding, check `await this.redis.isJwtBlacklisted(payload.jti)` and `client.disconnect(true)` on hit — mirror `JwtAuthGuard`. Optionally re-check on each `message:send` for long-lived sockets.
- **Ref:** OWASP API2:2023 Broken Authentication; CWE-613 Insufficient Session Expiration.

### [LOW-to-MEDIUM] Page / association / event image URLs persisted unbound (no `assertOwnedPublicImage`) — OWASP A08 / A10 / CWE-918 (CVSS 4.0)
- **Where:**
  - `apps/api/src/page/page.service.ts:42-43` (`avatarUrl`, `coverUrl` on create) and `:123` (`update` passes `data: dto` straight through).
  - `apps/api/src/association/association.service.ts:51-52` (`logoUrl`, `coverUrl` on create), `:148` (`update`), `:412` (event `coverUrl`).
  - DTOs validate only `z.string().url().max(...)` — `page.dto.ts:9-10`, `association.dto.ts` logo/cover/event cover.
- **Evidence:** The documented convention (`CLAUDE.md` -> "ne jamais persister une URL client brute... La binder via `S3Service.assertOwnedPublicImage`... vaut pour posts, stories ET chat"). Posts (`feed/posts.service.ts:67,100`), stories, profile avatar/cover (`profile.service.ts:110,122,309`) and chat (`chat.service.ts:254`) all bind. The new Page/Association/Event entities store the raw client URL. `assertOwnedPublicImage` is what enforces "points at OUR public bucket + caller's `users/<id>/` prefix + image/* MIME + size cap" (`s3.service.ts:212-241`).
- **Impact:** An identity-approved creator (gate at `page.service.ts:33` / `association.service.ts:43`) can store an arbitrary off-platform URL as a page/asso logo/cover. That URL is then auto-loaded by every viewer's client (tracking-pixel / beacon) and appears on the public map markers (`geo.service.ts:226,267`). It also lets a creator reference another user's uploaded object. Not a server-side SSRF (the API never fetches it), so impact is client-side beacon + cross-object reference rather than internal network access — hence below high.
- **PoC (safe):** `POST /api/pages` with `avatarUrl: "https://attacker.example/track.gif"` -> stored verbatim, surfaced on `/api/geo/markers`.
- **Fix (proposed):** Bind each image field through `s3.assertOwnedPublicImage(url, creatorId)` in `PageService.create/update`, `AssociationService.create/update`, and `createEvent` (mirror `posts.service.ts`). On `update`, only re-bind fields actually present.
- **Ref:** OWASP A08:2021 Software & Data Integrity; CWE-918 (variant) / CWE-20.

### [LOW] Association reject reason not schema-validated — OWASP A04 / CWE-20 (CVSS 2.6)
- **Where:** `apps/api/src/association/association.controller.ts:143-151` — `@Body('reason') reason?: string` (raw, no `ZodValidationPipe`); flows to `rejectJoinRequest` -> stored in a notification (`association.service.ts:343-350`).
- **Evidence:** Every other body in the module uses `ZodValidationPipe`; this one extracts a raw field with no type/length cap.
- **Impact:** An admin/moderator (already role-checked via `assertRole`) can store an arbitrarily long / non-string-coerced `reason` in a notification row sent to the rejected user. Authenticated-privileged, no length bound. Minor (no injection — rendered as text on RN client).
- **Fix (proposed):** Validate with a small Zod object (`{ reason: z.string().max(500).optional() }`).
- **Ref:** OWASP A04:2021 Insecure Design; CWE-20 Improper Input Validation.

---

## Verified-good (no finding)

- **AuthZ / IDOR — pages:** all mutations go through `assertRole` (`page.service.ts:122,127,191,205,219`); follow/unfollow are self-scoped; `update` cannot mass-assign sensitive fields (`updatePageSchema = createPageSchema.partial()` excludes `createdById`/`followerCount`/`isVerified`).
- **AuthZ / IDOR — associations:** `assertRole` (status `approved` + role) on update/delete/invite/approve/reject/changeRole/createEvent/pending (`association.service.ts:435-443`); `inviteMember` rejects self-invite and dup states; last-admin guards on leave/removeAdmin.
- **AuthZ / IDOR — polls:** page-poll creation requires page admin (`poll.service.ts:24-28`); option ids validated against the poll (`:103-110`); delete = author or page admin (`:145-161`); vote/retract self-scoped.
- **AuthZ / IDOR — reviews:** cannot review self / own page / administered page (`review.service.ts:130-153`); delete checks `authorId` (`:112-115`); unique constraint per (author,target).
- **Chat edit/delete:** sender-only + 15-min window (`chat.service.ts:354-356,387-393`), soft-delete nulls content/media, `replyToId` confined to same live conversation (`:222-230`), `assertMember` everywhere, media bound via `assertOwnedPublicImage` (`:254`), control/invisible-char sanitisation + 4 kB cap on both REST and WS paths.
- **WS gateway:** RS256 + `iss`/`aud` verify with key rotation (`chat.gateway.ts:312-327`); Zod re-validation of the socket payload (`socketSendMessageSchema`); per-user Redis rate-limit keyed by user not socket (`:166-173`); presence scoped to shared conversations (no stranger leak); CORS from validated `CORS_ORIGINS`.
- **Auth service:** OAuth auto-link guarded against account takeover (`auth.service.ts:404-430`, only links verified-email + password-less + same/no provider); Google rejects unverified email; Apple trusts only verifier's `email_verified`; login lockout (staged), timing-safe `fakeVerify` against enumeration, register IP rate-limit; password reset revokes all refresh tokens (`:302-316`); identity file pointer validated to private bucket + `users/<id>/identity/`, traversal-checked (`:509-526`).
- **Admin module:** role-gated `@UseGuards(RolesGuard) @Roles('admin','moderator')` (`admin.controller.ts:26-27`); identity docs served via short-lived (300 s) presigned GET, never persisted/logged; web console gates client-side AND server enforces RolesGuard (`moderation.controller.ts:40-49`, `auth.controller.ts:239-241`).
- **Injection:** all admin `$queryRaw` / geo `$queryRaw` use `Prisma.sql` parameterised binds (`${since}`, `${dto.lat}`, `Prisma.join(blockedIds)`) — no string interpolation. `days` etc. Zod-bounded upstream.
- **Privacy (public/friends/private):** individual map markers, orphan clusters, nearby, and proximity all filter `privacyLevel <> 'private'` + `showOnMap` (`geo.service.ts:337,429,663,711`); private users only feed anonymous aggregate counts.
- **Secrets:** no secret files added in range; SMTP/DKIM/Apple/Resend all sourced from env (`docker-compose.prod.yml`, `env.validation.ts`); OAuth refused-link log redacts email to a 12-char SHA-256 prefix.
- **Web CSP:** `connect-src` correctly reduced to API origin; `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`; admin tree `noindex`.

---

## Recap by severity

| Severity | Count | Items |
|---|---|---|
| critical | 0 | — |
| high | 0 | — |
| medium | 1 | WS jti-revocation gap |
| low | 2 | unbound page/asso/event image URLs; un-validated reject reason |

**Fixes applied:** none (read-only audit — report only).
**Fixes proposed (for human review):** WS gateway jti blacklist check; bind page/asso/event image URLs via `assertOwnedPublicImage`; Zod-validate association reject `reason`.

**Deploy verdict:** no open critical/high -> OK to deploy. The medium (WS revocation) and lows should be scheduled but do not block.
