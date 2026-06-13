# SECURITY_REPORT — NigerConnect

**Mode:** A (post-push audit, READ-ONLY / report-only — no fixes applied)
**Date:** 2026-06-11
**Auditor:** gwani-pentest
**Referential:** OWASP Top 10 2021 + OWASP API Security Top 10 2023

---

## Scope & method

Requested range: `edd8e0be18cce435cc383ba36871e20eabf54de3..9b55a7ce51b7f7c1108e2fba46927bdab8f60397`.

That literal range contains a **single commit** (`9b55a7c chore(mobile): version 1.2.0 pour livraison OTA`) whose only change is a one-line version string in `apps/mobile/app.json` (`1.3.0` → `1.2.0`). Zero security surface.

Because the BEFORE endpoint (`edd8e0b`) is itself the substantive feature commit, the meaningful change set actually delivered with this push is the **association feature** spanning `481a055..edd8e0b` (commits `feat(assos): invitations…` and `feat(assos): publications réservées aux membres`). I audited that change set in full — it is where all the access-control surface lives:

```
apps/api/src/association/association.controller.ts   (+invite route)
apps/api/src/association/association.service.ts       (+inviteMember, MEMBER_SELECT +firstName/lastName)
apps/api/src/association/dto/association.dto.ts        (+inviteMemberSchema, countryCode/city now required)
apps/api/src/feed/feed.controller.ts                  (+GET associations/:id/posts)
apps/api/src/feed/posts.service.ts                    (+association visibility, getAssociationFeed)
apps/api/src/page/dto/page.dto.ts                     (countryCode/city now required)
apps/mobile/*                                          (deep links, composer, members UI)
e2e/tests/api/*                                        (new spec coverage)
.gitignore                                             (service-account exclusion hardening)
```

Static analysis only. The app was not run; no destructive or DAST actions were performed.

---

## Findings

### [INFO] Audited range is a no-op version bump
- **Where:** `apps/mobile/app.json:5`
- **Evidence:** the only diff in `edd8e0b..9b55a7c` is `"version": "1.3.0"` → `"1.2.0"`.
- **Impact:** none (security). Operational note only: this is a version *downgrade*; confirm it is intentional for the OTA channel (a lower `runtimeVersion`/version can affect OTA targeting), but it carries no security risk.
- **Fix:** n/a.

---

### [LOW/MEDIUM] Association members list is readable by any authenticated user, and the diff broadens the PII it returns
- **Where:** `apps/api/src/association/association.controller.ts:113-121` (`GET associations/:id/members`) → `apps/api/src/association/association.service.ts:386-400` (`listMembers`); `MEMBER_SELECT` at `:20-28`.
- **OWASP:** A01 Broken Access Control / API3:2023 Broken Object Property Level Authorization (excessive data exposure).
- **Evidence:** the `members` route has **no `assertRole` / membership check** — only the implicit global auth guard. `listMembers` returns every approved member. This diff added `firstName: true` and `lastName: true` to `MEMBER_SELECT`:
  ```ts
  const MEMBER_SELECT = {
    id: true, displayName: true,
    firstName: true,   // ← added in this change set
    lastName: true,    // ← added in this change set
    avatarUrl: true, city: true, countryCode: true,
  };
  ```
  So any logged-in user can enumerate the full membership roster of *any* association (including approval-gated ones) together with real first/last names, city and country.
- **Impact:** roster enumeration + real-name harvesting of arbitrary associations by any account, independent of the member's own profile `privacyLevel`. The diff did not create the open endpoint (pre-existing design) but it **widened the exposed PII** (added legal names).
- **Severity rationale:** kept at LOW/MEDIUM because `firstName`/`lastName` are already exposed app-wide for post authors, friends and blocks (`AUTHOR_SELECT` in `posts.service.ts:20-29`, `friends.service.ts:16-17`, `block.service.ts:78-79`), so this is consistent with existing exposure rather than a new class of leak. Still worth a decision: a members roster is more aggregatable than scattered author bylines.
- **PoC (safe, not executed):** as any test account, `GET /api/associations/<uuid>/members` for an association you are not a member of → returns the roster with names.
- **Fix (proposed, NOT applied):** gate `listMembers` on caller membership (same pattern as `getAssociationFeed` / `assertRole`), requiring approved membership before returning the roster; or, if the roster is intentionally public, drop `firstName`/`lastName` from `MEMBER_SELECT` and keep only `displayName`. Decide per product intent.
- **Ref:** OWASP API3:2023; CWE-200.

---

### [LOW] `rejectRequest` reason is an unvalidated free-form body field
- **Where:** `apps/api/src/association/association.controller.ts:143-151` — `@Body('reason') reason?: string` (no `ZodValidationPipe`).
- **OWASP:** A04 Insecure Design (validation gap) — minor.
- **Evidence:** unlike every other body in this module, `reason` bypasses Zod (no length bound, no type guard beyond TS). It flows into the rejection/notification path (`rejectJoinRequest`). Pre-existing pattern, not newly introduced, but adjacent to the audited feature.
- **Impact:** an admin/mod (already privileged via `assertRole`) could store an unbounded string. No injection (Prisma parameterises; RN/text rendering). Low blast radius — requires admin/mod role on the association.
- **Fix (proposed):** validate with a small Zod schema (`z.object({ reason: z.string().max(500).optional() })`) for consistency with the rest of the module.
- **Ref:** CWE-20.

---

## Items verified clean (no finding)

- **Association post creation authZ** — `posts.service.ts:50-59`: `visibility === 'association'` requires `associationId` and an **approved** membership (`ForbiddenException` otherwise). No way to post into an association you don't belong to. (A01 OK.)
- **Association feed read authZ** — `getAssociationFeed` (`:415-420`) enforces approved membership before returning anything; main feed (`:344-383`) and per-user wall (`:495-517`) gate `association` posts on `memberAssocIds`; single-post side channel `assertCanViewPost` (`:191-202`) enforces membership and returns 404 (no existence oracle). Consistent across all read surfaces. (A01 OK.)
- **Visibility-transition lock** — `update` (`:230-241`) rejects any change into/out of `association` visibility, preventing both orphaning and leak of members-only content to public/friends. Good defensive design.
- **Share guard** — `share` (`:285-292`) refuses to re-broadcast non-public (incl. association) posts. (A01 OK.)
- **Invite endpoint** — `inviteMember` (`association.service.ts:225-268`): `assertRole(['admin','moderator'])`, Zod `uuid` validation, self-invite rejected, existence checks on association/target, ConflictException on already-member/pending. Notification-only (creates no membership row) → respects `requiresApproval`. No spam/abuse vector beyond the role-gated caller. (A04/API6 OK.)
- **Media URL binding** — `create`/`createStory` (`:64-76`, `:111`) bind every client URL via `s3.assertOwnedPublicImage(url, authorId)` (owner-scoped `users/{id}/...` key). No raw client URL persisted; no SSRF via mediaUrl. (A08/A10 OK.)
- **Input validation** — `createPostSchema`/`updatePostSchema` (`post.dto.ts:13-25`) use `z.enum` visibility, `z.string().uuid()` associationId, bounded content/media; `inviteMemberSchema`, `createAssociationSchema`/`createPageSchema` (countryCode `length(2)`, city `min(1).max(100)`) all Zod-validated via `ZodValidationPipe`. UUID path params via `ParseUUIDPipe`. (A03 OK.)
- **Injection** — diff-wide scan: no `$queryRaw`/`$executeRaw`/`*Unsafe` introduced; all new queries are Prisma query-builder calls. (A03 OK.)
- **Mobile deep-link handler** — `_layout.tsx:189-213`: new `associationId`/`requestId`/`proximityUserId` branches all `typeof === 'string'` guarded and route only to internal app paths (`/associations/:id`, etc.). No open-redirect / arbitrary-URL navigation. (A01/A10 OK.)
- **Secrets** — no secret files added in range; the `.gitignore` change *hardens* posture by excluding `play-service-account.json` / `*service-account*.json`. Test-only `VALID_PASSWORD` constants in e2e specs are expected and harmless.
- **Private-profile leakage** — public-feed and per-user-wall queries continue to exclude `privacyLevel === 'private'` authors from strangers (`:370`, `:182-184`, `:487-492`); the association changes did not regress this.

---

## Out-of-scope note (pre-existing, flagged for awareness)

- `apps/mobile/google-services.json` is **tracked in git** (`git ls-files`). This is *not* part of the audited diff and Firebase Android config keys are client-distributable by design (low sensitivity), but the project's own rule (`CLAUDE.md` §Sécurité) lists `google-services.json` in its secret-scan exclusion. The `.gitignore` excludes `GoogleService-Info.plist` (iOS) but not the Android `google-services.json`. Recommend reviewing separately; not a blocker and not introduced by this push.

---

## Recap by severity (audited change set)

| Severity | Count | Open |
|---|---|---|
| critical | 0 | 0 |
| high | 0 | 0 |
| medium | 1 (members roster PII — rated LOW/MEDIUM) | 1 |
| low | 2 | 2 |
| info | 1 | 1 |

No fixes were applied (report-only mandate). All findings are proposals.

---

## Verdict

**OK_TO_DEPLOY.**

No OPEN critical or high finding. The association feature's access-control model (create / read / share / visibility-transition / invite) is consistently and correctly gated on approved membership and role. The only substantive item is the members-roster endpoint being readable by any authenticated user while now also returning real names — rated LOW/MEDIUM, consistent with existing app-wide name exposure; recommend deciding whether to gate it on membership or drop the names, but it does not block this deploy.
