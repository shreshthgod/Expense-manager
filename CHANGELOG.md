# Changelog

## 2.0.0 — 2026-09-29

A full repair and expansion of the v1 app on the same stack (Next.js 14, React 18, Prisma, PostgreSQL).

### Fixed (from the v1 audit)
- Adding/editing transactions, income, budgets and goals no longer fails (B1–B6, B10); cleared dates are `null`, never 1970.
- Transfers move money between accounts (B12); accounts can be created (B11); "mark as read" no longer deletes (B7); category filters work (B8); chat resumes conversations (B9).
- Categories are per user (B18); the seed only touches the demo user (B19); settings take effect (B15); account deletion works with re-authentication (B13); the landing page no longer shows invented statistics (B14).
- Security: revocable server-side sessions, fail-closed secret, mandatory route wrappers, CSRF same-origin check, trusted-proxy IPs, nonce CSP and security headers, upload sniffing, CSV formula-injection protection.

### Added
- Double-entry style ledger with opening balances, soft delete + undo, planned transactions, balance adjustments, reconciliation, version conflicts and idempotent creates.
- Splits, linked refunds, merchants and aliases, automation rules, favourites, receipts, bulk actions, smart filters, CSV export.
- Recurring engine for recurring items, bills and subscriptions; calendar; scheduler with outbox-based notifications.
- Credit-card limits, utilisation and statements.
- Statement import with presets, duplicate detection, undo.
- Budget rollover and templates; goal kinds and contribution ledger with transfers; emergency fund.
- Net worth history, cash-flow forecast, safe to spend, what-if simulator, monthly review with snapshots, analytics 2.0, review inbox.
- Grounded AI narration, "explain my month", proposed actions with confirmation, conversation pinning.
- Full JSON backup and restore; PWA; motion system with reduced/off settings; every page rebuilt.
- Versioned migrations 0001–0005, 273 unit/integration tests, Playwright E2E, CI workflow.

### Upgrade notes
See README → Deployment → Upgrading from v1.
