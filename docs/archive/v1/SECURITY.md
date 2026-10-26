# Security

Scope: read-only review of `expense-manager` source, config, dependencies and data flow.
No penetration testing was performed; no live server was reachable (PostgreSQL down).
Findings marked **CONFIRMED** were verified in source or by executing the project's own code.

---

## 1. Threat model (what this app must defend)

| Asset | Threat | Trust boundary |
|---|---|---|
| User credentials | brute force, credential stuffing, user enumeration | public `/api/auth/*` |
| Session | token theft, forgery, fixation, replay after logout | `em_session` cookie |
| Financial data of user A | horizontal privilege escalation (read/write B's rows) | all `/api/**` |
| Integrity of balances/budgets | malformed payloads, injection, double counting | mutating APIs |
| Availability | rate-limit bypass, unbounded queries, ReDoS via zod | public surface |
| Supply chain | vulnerable transitive deps | `package-lock.json` |

Non-goals in the current design: multi-tenant organisations, regulatory compliance (PCI/DPDP),
audit-grade logging, at-rest encryption (left to the DB/platform).

---

## 2. Controls present (verified)

| Control | Where | Status |
|---|---|---|
| Password hashing bcrypt, cost 10 | `lib/auth/password.ts` | ✅ CONFIRMED |
| Password policy: 8–128 chars, ≥1 letter, ≥1 digit | `registerSchema` | ✅ CONFIRMED |
| Identical 401 for unknown email and wrong password | `app/api/auth/login/route.ts` | ✅ CONFIRMED (anti-enumeration) |
| Duplicate email → 409 with neutral message | `app/api/auth/register/route.ts` | ✅ CONFIRMED |
| JWT HS256 signed with `AUTH_SECRET`, 30-day expiry | `lib/auth/jwt.ts` | ⚠️ see F1/F2 |
| Cookie `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` in production | `lib/auth/session.ts` | ✅ CONFIRMED |
| Page-level protection via `middleware.ts` | 11 prefixes | ✅ CONFIRMED |
| Per-handler `requireUserId()` on all 55 API handlers | `app/api/**` | ✅ CONFIRMED by enumeration |
| Tenant scoping `userId` on every query/delete | all of `server/services` | ✅ CONFIRMED |
| Unpredictable `cuid()` primary keys | `schema.prisma` | ✅ CONFIRMED |
| zod validation on all mutating bodies | `lib/validation/schemas.ts` + inline route schemas | ✅ CONFIRMED |
| Parameterised raw SQL (`Prisma.sql` / `$queryRaw` template literals) | `health-score`, `forecast`, `affordability`, `insight.service` | ✅ CONFIRMED — no string concatenation |
| `X-Content-Type-Options`-relevant config: `poweredByHeader: false` | `next.config.mjs` | ✅ CONFIRMED |
| Rate limiting on auth + AI chat | `lib/api/rate-limit.ts` | ⚠️ see F4/F5 |
| System categories cannot be modified/deleted by users | `category.service` | ✅ CONFIRMED |
| Category deletion blocked while referenced by transactions | `category.service.deleteCategory` | ✅ CONFIRMED |
| Pre-delete ownership checks / `deleteMany` with `userId` | all services | ✅ CONFIRMED |
| Secrets excluded from the repo | `.gitignore` lists `.env*` | ✅ CONFIRMED (but `.env` exists on disk) |

---

## 3. Findings

### F1 · Hardcoded fallback for `AUTH_SECRET` — **HIGH**
`lib/auth/jwt.ts:5-7`
```ts
const secret = process.env.AUTH_SECRET ??
  "dev-only-secret-change-me-in-production-0123456789abcdef";
```
**Impact:** if `AUTH_SECRET` is unset in a deployment, every token is signed with a value that is
now published in this document and in the source tree. Anyone can mint `{"sub":"<anyUserId>"}`
and impersonate any user, bypassing all authorization.
**CONFIRMED.**
**Fix:** throw at startup when `NODE_ENV === "production"` and `AUTH_SECRET` is missing/short
(< 32 bytes); keep the fallback dev-only behind an explicit `NODE_ENV !== "production"` guard.

---

### F2 · Non-revocable 30-day session — **HIGH**
`lib/auth/jwt.ts` (`SESSION_DURATION_SECONDS = 30d`), no `jti`, no denylist, no server-side
session table.
**Impact:**
- Changing the password (`PUT /api/profile`) does **not** invalidate existing tokens.
- Deleting the account removes the `User` row, but the cookie persists; the middleware still
  accepts it until expiry (subsequent `getCurrentUser()` returns null and the user is bounced to
  `/login`, so impact is limited, but the token remains cryptographically valid).
- Logout only clears the **browser's** cookie — a stolen token still works.
**CONFIRMED.**
**Fix:** add `jti` + a `SessionVersion`/`tokenVersion` claim checked against the DB, or a
`sessions` table with explicit revocation; lower TTL and/or add refresh rotation.

---

### F3 · Dependency advisories — **HIGH / CRITICAL**
`npm audit --omit=dev` (2026-09-27): **2 vulnerabilities — 1 critical, 1 high.**
- `next@14.2.35` — RCE on Windows-hosted servers, RCE in the Image Optimization API (AVIF),
  unauthenticated Server Function disclosure, cache poisoning / cache confusion, SSRF in
  Server Actions and rewrites, middleware/proxy bypass (i18n), DoS in App Router.
- bundled `postcss` — XSS via unescaped `</style>`, arbitrary file read / path traversal via
  attacker-controlled `sourceMappingURL`.
`npm audit fix --force` would jump to `next@16.3.6` (breaking major).
**CONFIRMED.**
**Fix:** upgrade Next.js to the patched 14.x line if one exists, otherwise plan the 15/16 migration
as a separate task; regenerate the lockfile and re-audit.

---

### F4 · Rate-limit IP taken from a spoofable header — **MEDIUM**
`app/api/auth/login/route.ts`, `register/route.ts`
```ts
const ip = request.headers.get("x-forwarded-for") ?? "local";
```
**Impact:** behind a proxy that appends (rather than replaces) the header, a client can prepend
arbitrary IPs and get a fresh bucket per request → full bypass of login brute-force protection.
Conversely, with no proxy and no header, every client collapses into the single key `local`,
so one attacker can lock out all users.
**CONFIRMED.**
**Fix:** trust exactly one hop (`x-forwarded-for` entry chosen by proxy config), or use
`request.headers.get("cf-connecting-ip")` / platform-provided IP; never default to a shared key.

---

### F5 · In-memory, single-node rate limiting — **MEDIUM**
`lib/api/rate-limit.ts` — `Map<string, number[]>`.
**Impact:** resets on every process restart/deploy; ineffective in multi-instance deployments;
the map only evicts when it exceeds 10,000 keys *and* a bucket is fully expired, so a burst of
distinct keys can grow memory before cleanup. No `Retry-After`, no penalty/backoff, no CAPTCHA.
**CONFIRMED.**
**Fix:** Redis-backed limiter (e.g. `@upstash/ratelimit`) if scaling horizontally; add eviction
on write and `Retry-After` on 429.

---

### F6 · `DELETE /api/account` with no re-authentication — **MEDIUM**
`app/api/account/route.ts` — deletes the `User` row (cascading to every financial record) with
only the session cookie as proof. No password confirmation, no `audit()` call despite an
`ACCOUNT_DELETED` `AuditAction` existing, and the session cookie is not cleared.
**CONFIRMED.**
**Fix:** require `{ password }` in the body, write an audit record (note: `audit()` runs after the
row is gone, so log with `userId: null` or write first), and call `clearSessionCookie()`.
Also surface the endpoint in the UI (the Settings button is currently a stub).

---

### F7 · API authentication is a per-handler convention — **MEDIUM**
`middleware.ts` matcher explicitly excludes `/api`. Every one of the 55 handlers must remember
`await requireUserId()`.
**Impact:** a single future handler that forgets it is an unauthenticated data exposure. There is
no central guard, no linter rule, and no test asserting it.
**CONFIRMED** that all 55 current handlers do call it.
**Fix:** add a `withAuth` wrapper or a vitest static check that greps every `app/api/**/route.ts`
for `requireUserId`.

---

### F8 · No security headers / CSP — **MEDIUM**
`next.config.mjs` sets only `reactStrictMode` and `poweredByHeader`.
**Missing:** `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`,
`X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`.
**Impact:** increased exposure to clickjacking, MIME sniffing, and XSS blast radius (no CSP
means an injected script can exfiltrate everything the session can reach — though the cookie is
`httpOnly`, so it is not directly readable).
**CONFIRMED.**
**Fix:** add a `headers()` export in `next.config.mjs`; start with
`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
and a CSP allowing only same-origin + the configured `AI_BASE_URL` if fetched client-side.

---

### F9 · Seed script destroys the entire database — **MEDIUM**
`prisma/seed.ts` begins with `deleteMany()` on every model **including `User`**.
**Impact:** `npm run db:seed` on a shared/staging/prod database wipes all tenants, not just demo
data. Combined with the documented demo password, this is a foot-gun.
**CONFIRMED.**
**Fix:** scope deletion to `where: { email: DEMO_EMAIL }` and idempotent `upsert`s for demo rows.

---

### F10 · Cross-tenant unique constraint on categories — **MEDIUM**
`prisma/schema.prisma`: `Category @@unique([name, isSystem])` is global.
**Impact:** user B cannot create a custom category whose name user A already owns. The service's
tenant-scoped conflict check catches the common case, but the race/other-tenant path surfaces as
an unhandled Prisma `P2002` → generic 500 `INTERNAL` (which can leak implementation detail via logs).
**CONFIRMED** by schema inspection; exploitability **INFERRED** (no UI for category creation today).
**Fix:** `@@unique([userId, name, isSystem])` (keeping system rows on `userId = null`).

---

### F11 · Unvalidated pagination on notifications — **LOW**
`app/api/notifications/route.ts` does `Number(searchParams.get("page") ?? 1)` with no zod schema.
`page = "abc"` → `NaN` → `skip: NaN` reaches Prisma.
**Impact:** 500 response / error log noise; no data exposure.
**CONFIRMED.**
**Fix:** validate with zod like `transactionQuerySchema`, clamp to sane bounds.

---

### F12 · User-controlled `avatarUrl` rendered as `<img>` — **LOW**
`components/ui/avatar.tsx` uses a raw `<img src={avatarUrl}>` (the repo's only lint warning).
**Impact:** `javascript:` URLs are inert in `img src`, but the URL can point at an attacker host,
allowing IP/user-agent disclosure and tracking; `svg` payloads served as `image/svg+xml` from a
same-site path could carry script in some browsers.
**CONFIRMED** (`profileUpdateSchema` only checks `z.string().url()`).
**Fix:** allowlist http(s) + known host patterns, or proxy through `next/image` with configured
`remotePatterns`; use `<Image />` to also fix the lint warning.

---

### F13 · `GET` endpoints with side effects — **LOW/MEDIUM**
`GET /api/dashboard` runs `processDueRecurrences()` and `checkGoalDeadlines()`, creating
transactions and notifications.
**Impact:** prefetchers, health checks, link previews or a double-request can trigger writes.
Idempotency of the recurring engine limits damage, but the pattern violates safe-method semantics
and complicates caching and CSRF reasoning.
**CONFIRMED.**
**Fix:** move housekeeping to a `POST /api/system/tick` invoked by a cron/scheduler, or run it
lazily inside a mutation.

---

### F14 · No CSRF token — **LOW (accepted risk)**
Mutations are `POST/PATCH/DELETE` with JSON bodies. `SameSite=Lax` blocks cross-site
sub-cookie-writing requests, and a cross-origin `fetch` with a JSON body triggers a CORS preflight
that the app does not answer → effectively blocked for `fetch`. Top-level `GET` navigation
(e.g. `/api/export`) is intentionally allowed by `Lax`.
**CONFIRMED by design.**
**Residual risk:** any future endpoint that accepts form-encoded bodies, or `SameSite` relaxation,
would need explicit CSRF tokens.

---

### F15 · Secrets present on disk — **LOW**
`.env` exists in the workspace with live `DATABASE_URL`, `AUTH_SECRET`, `AI_API_KEY` values
(names confirmed, values deliberately not read into this document). It is gitignored.
**Impact:** local exposure only; matters if the directory is shared, backed up, or committed by a
different tool that honours `.gitignore` differently.
**CONFIRMED** (file existence and key names).

---

### F16 · Missing hardening — **LOW**
- No account lockout / exponential backoff after repeated failures (only a flat 15/min).
- No password reset, email verification, MFA, or session list.
- `AuditLog` has no reader endpoint → users cannot detect suspicious activity.
- `AuditLog` stores no IP / user agent.
- `deleteMany({id, userId})` on notifications returns `deleted: 0` with HTTP 200, so probing IDs
  is not informative (good), but the UI can't distinguish "already gone" either (neutral).
- No maximum body-size guard beyond zod's array caps (2000 CSV rows, 24 categories).

---

## 4. Injection & input handling

| Vector | Assessment |
|---|---|
| SQL injection | **Mitigated.** All raw SQL uses `Prisma.sql` / `$queryRaw` tagged templates → bound parameters. No string concatenation found. |
| NoSQL injection | N/A (Postgres + Prisma) |
| XSS (stored) | Low. React escapes by default; text is rendered through JSX. Toasts render plain text. `avatarUrl` and `Notification.link` are the only attacker-influenced URLs (F12). |
| XSS (reflected) | Low. No `dangerouslySetInnerHTML` anywhere. |
| Command injection | None — no `child_process`, no shell invocation. |
| Path traversal | Low — no filesystem APIs in app code. |
| Prototype pollution | Low — no deep merges of untrusted objects; zod strips unknown keys. |
| SSRF | Low in app code (the only outbound call is `agents/provider.ts` to a configured `AI_BASE_URL`). Note: Next 14.2.35 carries SSRF advisories (F3). |
| ReDoS | Low — zod uses bounded `regex` for email and colour only. |
| Mass assignment | Mitigated — every update uses explicit field spreads (`...(input.x != null ? {x} : {})`) rather than passing the parsed object wholesale, except `preferences` (`update: input`, but `preferenceUpdateSchema` only allows known keys). |

---

## 5. Authorization testing summary

No live DB was available, so this is a static analysis:

- **Every** service read/update/delete includes `userId` in the `where` clause, or uses
  `deleteMany({ id, userId })` + `count === 0 → 404`. (CONFIRMED by reading all of `server/services`.)
- Relations are always loaded through `userId`-scoped queries; there is no "get by id then
  check owner" pattern that could leak via timing.
- **Residual risk (INFERRED):** `transactionCreateSchema` accepts *any* valid cuid for
  `categoryId`/`accountId`. If a client supplied another user's cuid, the insert would succeed
  (no FK-side tenant check). Nothing in the app does this today because the UI only ever has the
  current user's IDs, and the account/category lookups are `userId`-scoped — but the API itself
  does not re-verify ownership of the referenced IDs.
  **Fix:** resolve `categoryId`/`accountId` with `findFirst({ id, userId })` before insert.

---

## 6. Compliance-adjacent observations (informational)

- No data export endpoint other than CSV of transactions/budgets (no full data portability).
- No soft-delete / retention policy — deletions are immediate and hard.
- `AuditLog` lacks IP and UA, so it cannot support incident reconstruction.
- No encryption at rest or field-level encryption (relied on the platform).
- Passwords never logged; `passwordHash` is excluded from every `select`.
- Session cookie lacks a `__Host-` prefix and has no `Priority`/`Partitioned` attributes.

---

## 7. Priority remediation order

1. **F1** — fail closed on missing `AUTH_SECRET` (5 minutes, removes total compromise risk)
2. **F3** — dependency upgrade plan for `next`
3. **F2** — token versioning / session revocation
4. **F6** — password re-auth + audit + cookie clear on account deletion
5. **F7** — guard rail so a future handler cannot forget `requireUserId`
6. **F4/F5** — correct client IP extraction; move limiting to shared storage
7. **F8** — security headers
8. **F9/F10** — seed scoping and category uniqueness scoping
9. **F11–F16** — hygiene items

See `docs/ROADMAP.md` for how these interleave with the functional bugs.
