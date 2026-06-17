# Security Audit Report — OAuth users never routed to email verification (mobile gate)

**Mode:** A (post-push, READ-ONLY, report only — no code modified)
**Auditor:** gwani-pentest
**Date:** 2026-06-17
**Repo:** nigerConnect (`feat/parrainage-invitations`)

## Scope

Commit range audited (exclusive lower bound):

```
0be41f75d4fe2b0fb530ad13b2a2b0f3450a7f7e..9de87f209cb0860e64f6118d0ea0dde1af0b7a37
```

This range contains **exactly one commit**:

- `9de87f2` — fix(mobile,auth): never route OAuth users to email verification (Apple Guideline 4 defense-in-depth)

Files changed (3):

| File | Change |
|---|---|
| `apps/api/src/common/prisma/user-select.ts` | Add `oauthProvider: true` to `USER_SELF_SELECT` |
| `apps/mobile/app/_layout.tsx` | `AuthGate` skips the verify-email screen for OAuth users |
| `packages/shared-types/src/user.ts` | Add `oauthProvider` to the `User` interface |

### Out of scope (not in this range)

The audit prompt mentioned the **parrainage v2** feature (reusable links, unlimited
invitations, public parrain) and the **OAuth verified-by-default** API change. Those live
in commits `8fbcb37` and `0be41f7`, which are the **parent and lower bound** of this range —
i.e. already merged before this push and **not part of the audited diff**. They were covered
by the previous report run. I read the adjacent OAuth API code only as *context* to assess
whether this mobile change introduces a regression (it relies on that API behaviour); no
finding below is raised against out-of-range code.

## Methodology

- `git log` / `git diff` / `git show` over the exact range.
- Read `AuthGate` routing logic end-to-end (`apps/mobile/app/_layout.tsx:261-307`).
- Traced provenance of the new `oauthProvider` field: DB select (`user-select.ts`) →
  serializer (`auth.serializer.ts`) → shared type → client store consumption.
- Cross-checked the server-side OAuth flow it depends on
  (`auth.service.ts:520-649`, `apple-verifier.service.ts:108-121`) to confirm the
  client gate cannot be used to bypass the authoritative `EmailVerifiedGuard`.
- Secret scan over the raw diff (regex: passwords, tokens, API keys, AWS keys, PEM).
- Confirmed `complete-profile` / `verify-email` routes exist (no redirect loop).

## Findings

| # | Severity | Location | Description |
|---|---|---|---|
| 1 | Info | `apps/api/src/common/prisma/user-select.ts:7,41` | Stale/contradictory doc comment |
| 2 | Info | `apps/mobile/app/_layout.tsx:288-303` | `isOAuth` applied inconsistently across the 4 routing branches |
| 3 | Info | `apps/mobile/app/_layout.tsx:294` | Client-side verify-email gate is now bypassable for any account the client can mark OAuth — but defense is server-side (not a vuln) |

No Critical, High, Medium, or Low findings.

---

### [Info] 1 — Doc comment now contradicts the whitelist — `user-select.ts`

- **Where:** `apps/api/src/common/prisma/user-select.ts:7` vs `:41`
- **Evidence:** The file header still says the select *EXCLUDES* `oauthProvider`
  (`"… lastLoginIp, oauthProviderId, oauthProvider."`, line 7), while line 41 now adds
  `oauthProvider: true` to `USER_SELF_SELECT`.
- **Impact:** Documentation drift only. No security impact. `oauthProviderId` (the
  opaque, sensitive provider subject) remains excluded both here and in the serializer
  `SENSITIVE_FIELDS` (`auth.serializer.ts:9`). The exposed field is just the provider
  *name* enum (`google`/`apple`/`facebook`/null) and is returned **only to the account
  owner** via `USER_SELF_SELECT` — it is absent from `USER_PUBLIC_SELECT`, so it does not
  leak to other users.
- **Recommended fix:** Update the line-7 comment to move `oauthProvider` from the EXCLUDES
  list to the KEEPS list (and keep `oauthProviderId` in EXCLUDES).
- **Ref:** CWE-1059 (insufficient/inaccurate comments) — informational.

### [Info] 2 — `isOAuth` only consulted in 2 of 4 AuthGate branches — `_layout.tsx`

- **Where:** `apps/mobile/app/_layout.tsx:288-303`
- **Evidence:** `isOAuth` is used in the `needsProfile` computation (line 290) and the
  verify-email branch (line 294), but the final "forward authenticated user into the app"
  branch (line 301) still gates on `user?.emailVerified` alone:
  `else if (isAuthenticated && user?.emailVerified && !needsProfile && inAuth)`.
- **Impact:** UX edge only. An OAuth account whose server-side `emailVerified` is somehow
  `false` (the "server hiccup" the commit defends against) will *not* be auto-forwarded
  from an `(auth)` screen to `/(tabs)`. It is not bounced to verify-email either (line 294
  now excludes it), so it simply isn't auto-navigated. No security consequence — the user
  is authenticated and the server still authorizes their requests.
- **Recommended fix (optional):** For consistency, change line 301's condition to
  `(user?.emailVerified || isOAuth)` mirroring line 290.

### [Info] 3 — Client verify-email gate is advisory; enforcement is server-side (confirmed safe)

- **Where:** `apps/mobile/app/_layout.tsx:294` — `&& !isOAuth`
- **Evidence / analysis:** `isOAuth = Boolean(user?.oauthProvider)` and `user` is populated
  exclusively from the server's authenticated `/me` response (`USER_SELF_SELECT`). A
  password account is created with `oauthProvider = null`, so `isOAuth` is `false` for them
  and they remain corralled onto verify-email. A client cannot self-promote the flag because
  it is server-derived, not client-asserted.
- **Why this is not a vulnerability:** The verify-email screen is a *UX* gate. The
  authoritative control is the API's global `EmailVerifiedGuard`, which reads `emailVerified`
  from the DB on every request. OAuth accounts legitimately carry `emailVerified=true` in
  the DB (set on creation in the adjacent commit `0be41f7`, `auth.service.ts:624`), so they
  pass the guard on their own merits — the client flag does not relax any server check. The
  email values that drive OAuth creation come from cryptographically verified provider tokens
  (`apple-verifier.service.ts:108-121` requires a valid signature + explicit `email_verified`
  claim; Google rejects unverified emails at `auth.service.ts:74-77`) and the account-takeover
  auto-link guard (`auth.service.ts:520-548`) runs *before* the create branch — so a verified
  OAuth identity cannot be minted for an address the attacker does not control.
- **Impact:** None. Documented for completeness so reviewers know the client gate weakening
  is intentional and backed by server-side enforcement.
- **Ref:** OWASP A01 / A07 — reviewed, no broken access control or auth bypass introduced.

---

## Summary by severity

| Severity | Count | Open |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 0 |
| Low | 0 | 0 |
| Info | 3 | 3 (advisory only) |

## Assessment

- **No secrets** introduced in the diff.
- **No new endpoints, Zod schemas, Prisma queries, or JWT handling** in range — the change is
  a read-only field exposure to the account owner plus a client-side navigation tweak.
- **No IDOR / private-account leak:** `oauthProvider` is exposed only via `USER_SELF_SELECT`
  (owner only); `USER_PUBLIC_SELECT` is unchanged.
- **No AuthN/AuthZ regression:** the client verify-email skip is defense-in-depth on top of
  the server `EmailVerifiedGuard`; it cannot be abused to bypass server authorization because
  the driving flag is server-derived and the guard re-checks the DB.

## Verdict

**OK_TO_DEPLOY** — no open Critical or High findings. The three Info items are
documentation/consistency nits and may be addressed at leisure.
