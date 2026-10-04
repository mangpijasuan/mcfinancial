# 2. Existing-System Audit

Phase 0 is already largely complete. This session reviewed the code, schema, APIs, UI, deployment and dependencies, and fixed the security defects it found (see git history on this branch). This document records what was found, gives a keep / refactor / replace verdict for each area, and lists the audit work that still requires access this repository does not have.

## 1. Inventory

| Area | Current state |
|---|---|
| Application | One Next.js 16 app (App Router) holding the admin panel, member portal and REST routes under `src/app/api` |
| Language | TypeScript (`strict: true`), React 18, Tailwind 3 |
| Auth | NextAuth v4, two credential providers (admin email / member ID), JWT sessions with the roles inside the token |
| Roles | `admin`, `super_admin`, `member` |
| Data | Prisma 5; SQLite locally, PostgreSQL in production; **two hand-maintained schema files** (`schema.prisma`, `schema.postgres.prisma`) |
| Payments | Stripe Checkout with a signature-verified webhook; Zelle as a claim that an admin confirms (`PortalPayment`) |
| Email | Resend (reminders, overdue notices, admin summary) |
| Deploy | Docker Compose on one Hetzner VM (app + Postgres + Caddy) |
| Backups | Nightly `pg_dump` to `backups/` on the **same VM**, gzip only (not encrypted), 14-day retention, no restore test |
| CI | GitHub Actions: `prisma generate`, `tsc`, `next build`. **No tests exist.** |
| Data volume | 211 members, 350 contribution rows, 6 live loans, 115 historical loans, 705 yearly totals |

## 2. Findings and verdicts

Severity: **H** = can produce wrong money or unauthorised access; **M** = integrity or operational gap; **L** = quality.

### Financial core

| # | Finding | Sev | Verdict |
|---|---|:-:|---|
| F-1 | No ledger. Balances are stored fields that route handlers overwrite (`contributions2026`, `overallContributions`, `currentLoanBalance`, `totalPaid`, `balanceRemaining`, `eligible`, `thisMonth`). They agree with the rows today; nothing enforces it. | H | **Replace** with a double-entry ledger (D-04) |
| F-2 | Every money column is `Float`. The monthly payment is `Math.round(amount / term * 100) / 100`, so $10,000 / 24 is scheduled as 24 × $416.67 = $10,000.08. Loan L05 is this case. | H | **Replace** with integer cents (D-03) |
| F-3 | Cancelling or deleting a loan agreement hard-deletes the loan and all of its repayments (`loanPayment.deleteMany`). | H | **Fixed (Stage 2):** cancel keeps both records (loan marked `Cancelled`) and is refused once a repayment exists; hard delete removed. Full void-and-reversal comes with the ledger (D-05) |
| F-4 | Loan disbursements are never recorded as money leaving the club. | H | **Fixed for new loans (Stage 3):** the payout is a lifecycle step (maker/checker) that posts Dr 1100 / Cr 1000 / Cr 4000 once the chart is approved. Older loans come in with the opening balances (M4) |
| F-5 | Application fees are computed and printed on the agreement ("collect this separately") but never recorded. The $5 late fee in the policy is never applied. Stripe processing fees are not recorded; payments are booked gross. | M | **Missing** |
| F-6 | `overdue` is never set by any code. It is only read, so delinquency reflects the seed data or manual edits. | H | **Fixed for new loans (Stage 3):** computed from the stored schedule by the daily servicing job and after every payment. Older loans keep the hand-kept flag until migrated (`npm run loans:schedule-report` shows the differences) |
| F-7 | Loans have one `nextDueDate` and a `monthlyDue`. There is no repayment schedule, so missed installments cannot be identified. | M | **Missing** |
| F-8 | Two loan sources of truth. `HistoricalLoan` rows (2021–2025) link to members by normalised name. 2 pairs of members share a legal name; 12 of 66 historical borrower names match no member. 30 historical loans are still "Active" ($70,343) and are excluded from the dashboard's outstanding figure. `scripts/data/sync-active-historical-loans.js` bridges the two tables with substring name matching. | H | **Refactor**: link by member ID, reconcile balances. **Built (M9):** linked by member ID through a Treasurer review queue; open balances confirmed and moved to the live loans; the sync script and every name match removed |
| F-9 | $164,790 (95.8%) of all recorded contributions exist only as per-member yearly totals, with no transaction detail. | M | **Keep** as opening balances in the ledger migration |
| F-10 | The payment date is used as the period the payment covers (`monthYear` is derived from `paymentDate`). Prepayments are therefore recorded with future payment dates (rows exist dated Oct–Dec 2026). | M | **Fixed (Stage 3):** monthly dues obligations; payments cover the oldest unpaid month first and extra is credit, so a prepayment is recorded on the day it is paid. Existing future-dated rows still count as payments; clean-up is part of the M4 review |
| F-11 | Cash is collected by individuals (`receivedBy`: collectors' names) with no record of when it was deposited into the bank. | M | **Fixed (Stage 3):** cash posts to `1030` until a recorded deposit moves it to the bank; collector cash is aged; the bank is reconciled monthly and months close in order (*Money → Reconciliation*) |
| F-12 | Admin `PATCH /api/loans/:id` can set `status` and `overdue` directly, e.g. mark a loan "Paid Off" with no payment. | H | **Fixed (Stage 3):** `status` is no longer editable (it changes only through payments, cancellation and write-off); `overdue` and the due date are refused on new loans. The database allows only the documented lifecycle moves |
| F-13 | Member withdrawals (`Full Exit`, `Partial`) change status but post no balance movement. | M | **Refactor** into the ledger |

### Access and security

| # | Finding | Sev | Verdict |
|---|---|:-:|---|
| S-1 | The role lives inside a 30-day JWT (NextAuth default). Demoting or deleting an admin does not take effect until the token expires. | H | **Fixed (Stage 2):** database-backed staff sessions and live role checks (D-07); member sessions 7 days, cut off when portal access or password changes |
| S-2 | Two roles only. Every admin can record, edit and confirm any financial event alone. | H | **Partly fixed (Stage 2):** nine roles with least-privilege permissions (D-07). Maker/checker (D-06) follows in Stage 3; existing admins keep full access through the transitional Club Officer role until officers are named (A4) |
| S-3 | No MFA for staff. | H | **Fixed (Stage 2):** TOTP required for every staff account, with recovery codes |
| S-4 | No audit log of who changed what. | H | **Fixed (Stage 2):** append-only `AuditLog` (database trigger blocks UPDATE, DELETE, TRUNCATE) written in the same transaction by every write route, sign-ins and the Stripe webhook; super-admin viewer at `/settings/audit` |
| S-5 | Login rate limiting is in-memory: it resets on restart and is per process. | M | **Fixed (Stage 2):** limits stored in PostgreSQL; per account, per IP (password spraying) and tighter for two-factor codes; lockouts emailed to the security contact |
| S-6 | Backups sit on the same VM as the database, are unencrypted, and have never had a restore tested. | H | **Fixed (Stage 2):** age-encrypted to officers' public keys, copied off-site to a write-only versioned bucket, health-checked; weekly scripted restore check ([runbook](../operations/backup-and-restore.md)). Setting it up on the server is an operations task |
| S-7 | Real member names and financial history are committed to git in `prisma/seed-data.json` and `historical-loans.json`. The repository is private. | M | **Fixed going forward (Stage 2, Gate A15):** removed from the repository; development uses generated synthetic data; real data loads only from an encrypted file outside git. Still in git history by founder decision — the repository must stay private |
| S-8 | No Content-Security-Policy. Other security headers were added this session. | L | **Fixed (Stage 2):** nonce-based CSP on every page (no inline or injected scripts), HSTS at Caddy |
| S-9 | Previously found and fixed this session: Next.js critical CVEs, mass assignment, portal brute force, stray routes, a root Docker user, unescaped email HTML. | — | Done |

### Engineering

| # | Finding | Sev | Verdict |
|---|---|:-:|---|
| E-1 | Zero automated tests. CI checks types and build only. | H | **Fixed (Stage 2):** Vitest against PostgreSQL in CI; authorisation matrix, ownership, payment and audit tests |
| E-2 | Two Prisma schema files maintained by hand. | M | **Fixed (Stage 2):** one schema, PostgreSQL everywhere (D-02) |
| E-3 | Prisma `db push` instead of migrations: there is no migration history for production. | H | **Fixed (Stage 2):** `prisma migrate` with a baseline; production baselines once ([deploy guide](../operations/deploy-hetzner-postgres.md#7-initialize-the-database)) |
| E-4 | Business logic lives inside route handlers. The shared `paymentActions.ts` is the first extraction. | M | **Refactor** into modules (D-01) |
| E-5 | New member IDs are random (`MC-3F9A…`) while existing ones are sequential (`MC-10001`). | L | **Refactor**. **Built (M8):** new members get the next number after the highest in use, allocated under a lock |
| E-6 | No input schema validation library; validation is hand-written per route. | M | **Refactor** (zod) |

### Found and fixed by the Stage 2 tests

| # | Finding | Sev | Status |
|---|---|:-:|---|
| T-1 | Confirming a Zelle claim twice at the same moment recorded the contribution twice (5 simultaneous confirms → 5 contributions). | H | Fixed: the claim is taken with a conditional update inside the transaction |
| T-2 | Overlapping Stripe webhook retries recorded the same card payment more than once (3 deliveries → 3 contributions). | H | Fixed: same pattern; only paid sessions are recorded |
| T-3 | The session never carried the admin's id, so "you cannot delete or demote your own account" never triggered. | M | Fixed |
| T-4 | Nine write routes crashed (500) on missing or malformed input instead of returning 400/404; loan creation and full-exit withdrawals were not single transactions. | M | Fixed |
| T-5 | Searches were case-sensitive in production (PostgreSQL), unlike SQLite in development. | L | Fixed |
| T-6 | A signed agreement could be re-signed, overwriting the earlier signature, and a cancelled agreement could still be signed. | M | Fixed |

### What should remain

- The Next.js app, its routing, the admin and portal UI, and the mobile layouts.
- The loan-eligibility rules in `src/lib/loanPolicy.ts`. They become versioned policy that reads ledger balances.
- The agreement e-signature flow; add a content hash of the signed version.
- The Stripe Checkout and webhook design, and the Zelle claim-and-confirm pattern. Both become ledger postings.
- Docker, Caddy and Hetzner hosting at this scale.

## 3. Remaining audit work (requires access outside this repository)

| # | Task | Why it matters | Owner |
|---|---|---|---|
| A-1 | Snapshot the production database and run the same consistency checks run here against the seed (stored balances versus rows, loan totals, name matches) | Production may have drifted from the seed; the ledger's opening balances depend on it | Engineering + Treasurer |
| A-2 | Confirm whether `sync-active-historical-loans.js` has been run in production, and reconcile the 30 "Active" historical loans with the treasurer's records. *Link older loans* shows any loan the script copied, and confirming brings it to the Treasurer's figure | Up to $70k of receivables may be missing from, or duplicated in, the live portfolio | Treasurer |
| A-3 | Obtain bank statements for the club accounts and reconcile them to recorded contributions, loans and withdrawals for at least the last 12 months | Establishes the true cash position for the ledger's opening balance | Treasurer |
| A-4 | Document the real-world cash process: who collects, how often it is deposited, who holds bank access | Defines the cash-custody controls and maker/checker roles | Founder + Treasurer |
| A-5 | Inventory everyone with admin access, bank access or server access | Least-privilege baseline for RBAC | Founder |
| A-6 | Review the Google Sheets import process referenced in `docs/operations/deploy-hetzner-postgres.md` | A second, unaudited write path into financial data | Engineering |
| A-7 | Verify that production backups exist, and perform one restore into a scratch database | S-6 | Engineering |
| A-8 | Identify the club's legal entity, governing documents, and any written loan or membership policy | Every compliance question depends on it | Founder |
