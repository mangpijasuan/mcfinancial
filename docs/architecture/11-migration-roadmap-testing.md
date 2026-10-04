# 23–25. Migration Strategy, Development Roadmap and Testing Strategy

## 1. Migration strategy

**Approach: incremental (strangler), never big-bang.** Each step ships on its own, can be rolled back, and leaves the club able to operate. Money-related cutovers happen at a period boundary, after reconciliation.

| Step | What | Done when | Rollback |
|---|---|---|---|
| **M0 Safety** | Production snapshot; verified restore; audit tasks A-1 to A-3 ([02](02-existing-system-audit.md#3-remaining-audit-work-requires-access-outside-this-repository)) | Restore tested; production consistency report reviewed by the Treasurer | — |
| **M1 One database** ✅ | Postgres in dev and CI; baseline `prisma migrate` from the production schema; drop the SQLite schema (D-02) | CI runs migrations on a clean Postgres | Revert the commit; production unaffected |
| **M2 Controls first** ✅ | Audit log, users/roles/permissions, database-backed DAL, staff MFA (D-07). Existing admins become users with roles | Every write route logs to `audit_log`; roles revoke instantly | Feature flag back to the old checks |
| **M3 Ledger in place, empty** ✅ built; chart awaits the accountant | Money module; ledger tables; chart of accounts approved by the accountant | Invariant tests green | Drop the new tables |
| **M4 Opening balances** ✅ built; runs once the chart is approved (A13), after a rehearsal on the production snapshot (A14) | At a cutover date (proposed **2026-01-01**, matching the start of transaction-level data): see the recipe below. Tooling: *Ledger → Opening balances* (report, then propose; a second person approves) and `npm run ledger:opening -- --rehearse` (posts everything inside a transaction, checks it, rolls back) | Trial balance balances; account 9000 explained (below) | Nothing is posted until the approval; the rehearsal never commits |
| **M5 Dual-write** ✅ built; the count starts once opening balances are posted | New payments, loans and withdrawals post to the ledger **and** update the legacy fields, in one transaction. A nightly job (`npm run ledger:compare`, *Ledger → Nightly comparison*) compares the two: ledger invariants, member capital, loan balances, and records with no ledger entry; it keeps every run and emails an alert on any difference | 30 consecutive days, including one month-end, with zero differences | Stop ledger writes; legacy remains authoritative |
| **M6 Read cutover** ✅ built, switched off | Dashboards, statements, eligibility and loan balances read from the ledger when `LEDGER_READS=true` (`src/modules/accounting/reads.ts`). Each figure keeps its meaning; only the source changes. *Ledger → Ledger reads* puts every such figure from both sources side by side before the switch is turned on | Board reviews the first ledger-based monthly report | `LEDGER_READS=false` |
| **M7 Retire legacy** | Stop writing legacy balance fields; drop them after one more period close; keep `YearlyTotal` as a read-only historical memo | Schema no longer contains stored balances | Restore from the M6 snapshot |
| **M8 Identity merge** | Admin and portal credentials → `users` (bcrypt hashes carry over unchanged); new members get sequential numbers | All logins go through `users` | Keep the old tables until verified |
| **M9 Loan unification** ✅ built; run it **before** M4 | `HistoricalLoan` linked by **member ID**; the loans still owing move to `loans` (origin `legacy_import`). Exact matches are automatic; the 2 duplicate-name pairs and 12 unmatched names go to a Treasurer review queue. The 30 "Active" historical loans are imported with **Treasurer-confirmed** balances. Tooling: *Loan History → Link older loans* (`src/modules/loans/history.ts`). Paid-off loans stay in the read-only table, linked; a balance still owed becomes a live loan with one brought-forward repayment, so the ledger opens it at the confirmed figure. Opening balances are refused until every Active loan is confirmed, as of a day before the cutover | No name-based matching remains in code | The legacy table is kept read-only; nothing is posted to the ledger until M4 |

### Opening-balance recipe (M4)

*Built* (`src/modules/accounting/opening.ts`). The report shows every figure below, the items to review (contributions dated before the cutover or in the future, withdrawals before the cutover, historical loans still marked Active, loans overpaid before the cutover), and each difference between the ledger and the old member totals and loan balances. On approval, it posts the opening entries (dated the day before the cutover) and everything since the cutover in one transaction, and moves older loans whose repayments match their schedule onto the loan engine. Afterwards the daily dues job keeps posting withdrawals and the remaining older loans until M5. Re-proposing is refused once posted, and an approval is refused if any record before the cutover changed after the proposal.

1. **Member capital:** for each member, post `Dr 9000 Opening balance equity / Cr 2000 Member capital (member)` for the pre-2026 archive total (`archiveLifetime`; $164,790 in aggregate).
2. **2026 activity:** replay the 350 contribution rows as real payment entries at their payment dates. Then member capital equals today's `overallContributions` ($171,960), which is a built-in check.
3. **Loans:** replay live loans (disbursement + repayments). For confirmed legacy loans still open, post `Dr 1100 Loans receivable / Cr 9000` at the confirmed balance.
4. **Cash:** post the bank balance on 2025-12-31 from the statement: `Dr 1000 Bank / Cr 9000`.
5. **Explain 9000.** After steps 1–4, the opening-balance account holds *(cash + receivables) − member capital*. A zero balance means the books tie. A non-zero balance is the club's true historical surplus or shortfall: unrecorded fees, losses, withdrawals never recorded, or data errors. It must be investigated, explained to the board, and reclassified to `3000 Club surplus` or specific accounts before M6. **This is the most important output of the migration.**

## 2. Development roadmap

The Master Prompt's 18 phases are kept, but **reordered**: the security baseline moves up, legal scoping moves up to run alongside the financial core, and MC Points (off-chain) comes before any Web3 build. There are no dates; each stage ends on its exit criteria.

| Stage | Phases (§46) | Scope | Exit criteria | Gate |
|---|---|---|---|---|
| **0. Audit** | 0 | Done in this session, plus A-1 to A-8 | Remaining audit findings recorded | — |
| **1. Decide** | 1 | This assessment reviewed | **Founder Decision Gate #1 signed** | **Gate #1** |
| **2. Foundation** ✅ built | 5 (moved up), part of 2 | M0–M2: backups, Postgres, audit log, RBAC, MFA, test harness | Security baseline met ([05](05-security-and-privacy.md#operational-security-baseline-phase-5-exit-criteria)); CI runs tests. *Remaining: backups switched on in production and a first restore check (M0)* | — |
| **3. Financial core** (under way: Money, loan engine, ledger, maker/checker, the loan lifecycle, dues/receipts, opening balances, the liquidity policy (A10), dual-write with the nightly comparison (M5), reconciliation with month-end close (F-11), older-loan linking (M9) and ledger reads behind a switch (M6) built) | 2, 3, 4 | Ledger, contributions (obligations, allocations, reconciliation), lending (engine, schedule, disbursement, delinquency, maker/checker), M3–M7, M9 | Ledger is the system of record; monthly close performed twice; opening variance explained | — |
| **3a. Legal scoping** (parallel) | part of 15 (moved up) | D-16 engagement using the [compliance matrix](09-compliance-matrix.md) | Written advice on rows 1–3, 7, 9–11, 16, 21 | — |
| **4. MC Points** | 10 (off-chain) | Rules engine, points ledger, member dashboard section visually separate from money | 3–6 months of real usage data | — |
| **5. MCTN decision** | 6, 7 | Name clearance; tokenomics finalised from points data and legal advice | Go / no-go on an on-chain token | **Gate #2** |
| **6. Web3 build** *(only if Gate #2 = go)* | 8, 9, 12, 13 | Wallet provider, `MCTNToken` + `MCTNRewardsMinter`, Safe setup, testnet with real members | Testnet soak; invariants green; runbooks rehearsed | — |
| **7. Assurance** | 14, 15, 16 | Independent contract audit; final legal review; production-readiness review | Audit findings closed; counsel sign-off | **Gate #3 (mainnet approval)** |
| **8. Mainnet** | 17 | Limited production (capped mint ceiling), then general availability | Monitoring and incident response live | — |
| **UMI** | 11 | Feasibility simulation only when an external funding source exists | Meets all [go/no-go criteria](07-umi.md#go--no-go-criteria--all-must-hold-before-any-umi-pilot) | Separate founder and board decision |

## 3. Testing strategy

**Status (Stage 2, 2026-09-26):** Vitest runs against a real PostgreSQL database in CI: the authorisation matrix (every route × method × caller, with a coverage check for new routes), ownership, payment-flow and audit-log tests, and a check that every write route records an audit entry. The financial core must not be changed without tests in place first.

### Layers and tools

| Layer | Tool | What it covers | Where it runs |
|---|---|---|---|
| Unit | Vitest | Money module, loan engine, allocation, rules engine, eligibility policy, ledger invariants | every commit |
| Property-based | Vitest + fast-check | Engine and ledger properties across thousands of generated cases | every commit |
| Integration | Vitest against real Postgres (CI service container) | Posting service, triggers, idempotency, approvals, migrations | every commit |
| Authorisation matrix | Vitest + a route table | Every role × every endpoint → expected 200/401/403 (catches the class of bug found in this session's audit) | every commit |
| End-to-end | Playwright (`e2e/`, CI job `e2e`) | Golden paths against a production build, staff signed in with password and TOTP: every screen loads without console errors (desktop and 390 px phone); a recorded contribution and its receipt; a member's Zelle claim → confirm → receipt; the full loan lifecycle (capacity → loan → signatures → payout → repayment); older loans linked by member ID (M9); chart approval → opening balances → Board approval → nightly comparison → bank reconciliation → month-end close | pull requests |
| Migration rehearsal | Scripted run on an **anonymised** production snapshot | M4 opening balances, M5 reconciliation, M9 loan linking | before each migration step |
| Smart contracts *(Phase 12+)* | Foundry (unit, fuzz, invariant); Slither | See the invariants below | every contract commit |

### Critical invariants (must be automated)

**Ledger and lending**

- Every journal entry balances; the trial balance always balances.
- Posted entries cannot be updated or deleted (tested against the database role, not just the application).
- A reversal restores exact prior balances; double reversal is impossible.
- An idempotency key replay creates no second entry.
- Maker ≠ checker for every approved entry.
- A loan schedule sums exactly to principal (every principal from $1 to $5,000 × every term).
- Allocated amount = payment amount; outstanding principal is never negative.
- A late fee is applied at most once per installment.
- Member statement for any past date is identical when regenerated.

**Rewards and token (§34)**

- Unauthorised accounts cannot mint (only the minter; only within the ceiling).
- Supply cannot exceed the cap (Model B) or the per-period ceiling (Model C).
- The treasury cannot move funds with fewer than 3 signatures.
- Vesting cannot release early (if any vesting exists).
- A reward, `(rule, member, activity)`, is paid at most once; claims cannot be replayed across chains or contracts.
- Unauthorised administrators cannot alter token accounting; role changes wait out the timelock.
- *UMI distributions cannot be claimed twice*: not applicable (UMI is not being built).

### Standards

- Coverage: 100% branch coverage on `lib/money`, `modules/accounting/ledger` and `modules/loans/amortization`; 70% or more overall.
- Test data: synthetic fixtures in git. **No real member data in tests or CI** (S-7).
- CI pipeline *(in place)*: install → `prisma migrate deploy` (Postgres service) → typecheck → lint (ESLint with import boundaries, `eslint.config.mjs`) → unit + integration → build → Playwright (PRs) → `npm audit --audit-level=high` (every dependency) → secret scanning (gitleaks over the whole history).
- A failing invariant check in production (nightly job) pages the Treasurer and engineering.
