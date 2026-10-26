# Security (v2)

Scope: a self-hosted, multi-user personal-finance web app. Each user's data must be invisible and unmodifiable to every other user, sessions must be revocable, and nothing financial may leak to caches, logs or the AI provider beyond what's needed.

## Controls

| Area | Control | Where |
|---|---|---|
| Authentication | bcrypt password hashes; generic error for unknown email / wrong password; rate limits per IP and per email | `app/api/auth/*`, `lib/api/rate-limit.ts` |
| Sessions | Server-side `Session` rows referenced by a signed JWT (`sid`); list, revoke one, revoke others; revoked on password change and account deletion; expired sessions purged by the scheduler | `server/services/session.service.ts` |
| Cookie | `httpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production | `lib/auth/session.ts` |
| Secret | `AUTH_SECRET` required (fails closed in production if missing or short) | `lib/auth/jwt.ts` |
| Authorization | Every route is created by `withAuth`, `withPublic` (4 allowlisted routes) or `withCron`; a unit test fails otherwise. Every query is scoped by `userId`; foreign ids return 404 | `lib/api/route.ts`, `tests/unit/route-guard.test.ts`, `tests/integration/security.test.ts` |
| CSRF | Same-origin check (`Origin`/`Sec-Fetch-Site`) on every browser mutation, plus `SameSite=Lax` | `lib/api/route.ts` |
| Input | zod validation for every body and query; JSON size limits (2 MB default, larger only for import confirm and backup restore); money precision; `CHECK` constraints in the database (amount > 0, transfer shape, card last-4 format, day ranges) | `lib/validation/*`, migrations |
| Integrity | Row locks, version checks (409), idempotency keys stored in the same transaction, unique constraints for occurrences, imports and notifications | `server/db/idempotency.ts` |
| Headers | Nonce-based CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS (production), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP; pages `Cache-Control: private, no-store`; APIs `no-store` | `middleware.ts`, `next.config.mjs` |
| Uploads | Type from file bytes (JPEG/PNG/WebP/PDF), 5 MB, sanitised file names, owner-only download with `nosniff`, `Content-Disposition` and a sandbox CSP | `server/services/attachment.service.ts` |
| Exports | CSV cells starting with `= + - @` are neutralised (formula injection) | `lib/utils/csv.ts` |
| Account deletion | Password + typed `DELETE`; cascades all data; session killed | `app/api/user/route.ts` |
| Backup restore | Validated structure and references before writing; new ids; one transaction; ledger verified afterwards; `REPLACE` confirmation | `server/services/backup.service.ts` |
| Logging | Structured logs; keys matching password/token/secret/cookie/authorization/api key are redacted; no request bodies logged | `lib/observability/logger.ts` |
| Offline / PWA | Service worker never caches API responses or pages; cache cleared on sign-out | `public/sw.js` |
| AI | Only aggregated, computed figures are sent to the provider (never credentials, account numbers or raw statements); tools are read-only; actions need user confirmation | `agents/*` |
| Seed | Demo tenant only; refuses to run in production without `ALLOW_DEMO_SEED=true` | `prisma/seed.ts` |

## Residual risks

1. **Next.js 14 advisories.** `npm audit` reports advisories for `next@14.2.35` (DoS in Server Components, cache poisoning, XSS with CSP nonces, image optimizer issues, a bundled `postcss`) whose fixes exist only in Next 15/16. Mitigations in place: `next/image` isn't used and the optimizer is disabled; no rewrites, Server Actions, Pages Router i18n or WebSocket upgrades; pages and redirects are `private, no-store`. **Recommended next step:** upgrade to the latest Next.js major (requires React 19) as its own tested change.
2. `style-src 'unsafe-inline'` is needed by the chart and motion libraries.
3. The default rate-limit store is per-instance memory; use `RATE_LIMIT_STORE=database` with more than one instance.
4. No two-factor authentication or email verification yet.
5. Attachments live in the main database; database backups contain them.

## Operational checklist

- Set `AUTH_SECRET` (≥ 32 random characters) and `CRON_SECRET`; run behind HTTPS.
- Set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the app so rate limits use the real client IP.
- Schedule `POST /api/cron/run` (Bearer `CRON_SECRET`) every 15 minutes, or run `npm run cron`.
- Apply migrations with `npx prisma migrate deploy`; never run the seed against production data.
- Back up PostgreSQL regularly (includes receipts); users can also download their own JSON backup.
