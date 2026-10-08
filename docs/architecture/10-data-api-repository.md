# 20–22. Database, API and Repository Architecture

## 1. Database architecture

<a id="d-02"></a>
### D-02 — PostgreSQL in every environment

**DECISION:** Use PostgreSQL for local development, CI and production. Retire SQLite and `prisma/schema.postgres.prisma`. Keep one schema and use `prisma migrate` (not `db push`) with committed migration history.
**WHY:** E-2 and E-3. Two hand-synced schemas drift. The ledger needs Postgres features: `CHECK` constraints, triggers that block updates to posted rows, deferred constraints, row-level permissions for the app user. Production has no migration history today.
**ALTERNATIVES:** Keep SQLite for dev and accept drift.
**BENEFITS:** Dev and production parity; real constraints; auditable schema history. `docker-compose.postgres-local.yml` already exists.
**RISKS:** Developers need Docker, which the repository already assumes.
**REVERSIBILITY:** easy
**REQUIRES LEGAL REVIEW:** no
**REQUIRES FOUNDER APPROVAL:** no
**STATUS:** Implemented (Stage 2, 2026-09-26). Baseline migration `20260926000000_init`; CI applies migrations to a clean Postgres and fails if `schema.prisma` and the migrations disagree. Existing production databases are baselined once with `prisma migrate resolve` ([deploy guide](../operations/deploy-hetzner-postgres.md#7-initialize-the-database)).

### Principles

1. Money is `BIGINT` cents with a `currency` column (D-03).
2. Posted financial rows are **insert-only**. The application's database role has no `UPDATE`/`DELETE` on `journal_entries`/`journal_lines` where `status = 'posted'`; a trigger enforces this.
3. Enumerations are Postgres enums or check-constrained text, never free text (statuses today are free strings).
4. Every table has `created_at`, and mutable tables have `updated_at`. Every financially relevant change writes `audit_log`.
5. Opaque UUID primary keys; human-facing numbers (`MC-10001`, `JE-2026-000123`, `L-2026-0007`) are separate unique columns.
6. No derived balance is authoritative. Cached aggregates must be rebuildable and are checked nightly.

### Entities

| Group | Tables | New / changed |
|---|---|---|
| Identity & access | `users`, `credentials`, `mfa_factors`, `sessions`, `roles`, `permissions`, `role_permissions`, `user_roles` | **New**; replaces `Admin` and the portal password fields on `Member` |
| Membership | `members`, `member_profiles`, `membership_status_events`, `member_documents`, `member_notes` | `Member` split; status history new |
| Contributions | `contribution_plans`, `dues_obligations` | **New** |
| Payments | `payments`, `payment_allocations`, `portal_payments` (existing, kept as the online-initiation record) | `Contribution` and `LoanPayment` become `payments` + allocations |
| Lending | `loan_applications`, `loans`, `loan_installments`, `loan_events`, `loan_agreements`, `agreement_signatures`, `loan_policy_versions` | Schedule, events, policy versions new; `HistoricalLoan` merged into `loans` with `origin = 'legacy_import'` |
| Ledger | `ledger_accounts`, `journal_entries`, `journal_lines`, `accounting_periods`, `bank_statement_lines`, `reconciliation_matches` | **New** |
| Controls | `approval_requests`, `audit_log`, `idempotency_keys` | **New** |
| Comms | `notifications`, `email_log` | `EmailLog` kept |
| Rewards (Phase 10) | `reward_rules`, `reward_events`, `points_accounts`, `points_entries` | New, later |
| Web3 (Phase 12+) | `wallet_links`, `chain_contracts`, `token_transfers` (indexed mirror), `treasury_proposals` (mirror) | New, later |
| Legacy (read-only until removed) | `YearlyTotal`, member balance fields | Kept for reconciliation during migration, then dropped |

### Core ledger schema (sketch)

```prisma
model LedgerAccount {
  id        String  @id @default(uuid())
  code      String  @unique            // "2000"
  name      String
  type      AccountType                // ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
  subledger SubledgerKind?             // MEMBER | LOAN | COLLECTOR | BANK
  active    Boolean @default(true)
}

model JournalEntry {
  id                String   @id @default(uuid())
  entryNumber       String   @unique        // JE-2026-000123
  effectiveDate     DateTime @db.Date
  type              EntryType
  status            EntryStatus               // DRAFT | PENDING_APPROVAL | POSTED | REJECTED
  description       String
  reference         String?
  sourceType        String?
  sourceId          String?
  idempotencyKey    String   @unique
  reversesEntryId   String?  @unique
  createdById       String
  approvedById      String?                   // CHECK approvedById <> createdById
  approvalRequestId String?
  createdAt         DateTime @default(now())
  postedAt          DateTime?
  lines             JournalLine[]
}

model JournalLine {
  id          String @id @default(uuid())
  entryId     String
  accountId   String
  memberId    String?
  loanId      String?
  debitCents  BigInt @default(0)              // CHECK exactly one of debit/credit > 0
  creditCents BigInt @default(0)
  currency    String @default("USD")
  memo        String?
  entry       JournalEntry  @relation(fields: [entryId], references: [id])
  account     LedgerAccount @relation(fields: [accountId], references: [id])
  @@index([accountId, memberId])
  @@index([loanId])
}

model AuditLog {
  id         BigInt   @id @default(autoincrement())
  at         DateTime @default(now())
  actorId    String?
  action     String                           // "loan.approve", "member.status.change"
  entityType String
  entityId   String
  before     Json?
  after      Json?
  requestId  String?
  ip         String?
}
```

Balance-check trigger (Postgres, sketch): on commit of a transaction that inserts `journal_lines`, assert `SUM(debit_cents) = SUM(credit_cents)` per `entry_id` (a deferred constraint trigger). A second trigger rejects `UPDATE`/`DELETE` of lines whose entry is `POSTED`.

### Performance note

At the club's volume (hundreds of entries a year, not millions), balances can be computed with `SUM` over indexed lines on every request. Materialised snapshots are unnecessary until well past 100,000 lines.

## 2. API architecture

### Conventions

| Topic | Rule |
|---|---|
| Versioning | New endpoints under `/api/v1/…`. Existing `/api/*` routes stay until their UI moves, then are removed. Webhooks stay unversioned under `/api/webhooks/*` |
| Framework | Next.js 16 Route Handlers, kept thin: parse → authorise → call a module → map to DTO |
| Authorisation | One Data Access Layer: `requirePermission(session, 'loans.approve')` reads the user and roles from the database (D-07). `proxy.ts` (Next 16's renamed middleware) may do *optimistic* redirects only, per the Next.js auth guide |
| Validation | `zod` schemas per endpoint, shared with the UI forms. Unknown fields are rejected (prevents mass assignment by construction) |
| DTOs | Responses are explicit objects, never raw Prisma rows (the current `sanitizeMember` is the first example) |
| Idempotency | Every financial `POST` requires an `Idempotency-Key` header, stored with a request hash and the response. A replay returns the stored response; a different body with the same key returns `409` |
| Errors | RFC 9457 problem-details JSON (`type`, `title`, `status`, `detail`, `errors[]`) |
| Pagination | Cursor-based (`?cursor=…&limit=…`) for ledger, payments and audit; offset stays acceptable for small admin lists |
| Rate limits | Persistent (database or Redis) per user and IP; stricter on auth and payment initiation |
| Money in JSON | Integer cents as strings (`"amountCents": "41666"`), avoiding JavaScript number precision issues at scale |

### Domains

| Prefix | Examples | Replaces today |
|---|---|---|
| `/api/v1/members` | list, get, create, `POST /:id/status-transitions` | `/api/members`, `PATCH` edits |
| `/api/v1/contributions` | plans, obligations, arrears | `/api/contributions` (read side) |
| `/api/v1/payments` | record, allocate, void (reversal), receipts | `/api/contributions` POST, `/api/loan-payments` POST |
| `/api/v1/loans` | applications, approve, disburse, schedule, payoff quote | `/api/loans`, `/api/agreements` |
| `/api/v1/accounting` | accounts, journal entries (propose / approve), trial balance, periods, reconciliation | **new** |
| `/api/v1/approvals` | queue, approve, reject | **new** (Zelle confirm moves here) |
| `/api/v1/reports` | member statement, portfolio, cash flow — as of any date | `/api/dashboard` |
| `/api/v1/admin` | users, roles, audit log | `/api/admins` |
| `/api/v1/me` | member-scoped: profile, statements, loans, payments, points | `/api/portal/*` |
| `/api/v1/rewards`, `/api/v1/wallets`, `/api/v1/mctn`, `/api/v1/treasury` | Phase 10+ | — |
| `/api/v1/umi` | **not created** (D-15) | — |

## 3. Repository architecture

<a id="d-01"></a>
### D-01 — Modular monolith now; the `mcfinancial/` monorepo is the target, reached in stages

**DECISION:** Keep the single Next.js application and organise it into domain modules **named exactly like the packages of the target `mcfinancial/` monorepo** (below), so each module can later move into `packages/` without code changes. Split out apps, services and `web3/` only when the trigger for each is met ([staged path](#staged-path-to-the-target-monorepo)). No separate NestJS/Fastify backend now.
**WHY:** One small team and about 200 members. Built all at once, the target is about 16 deployables (4 apps, 11 services, contracts), each with its own CI, deployment, secrets, monitoring and copy of member data. Staging captures the target's organisation now and pays the operational cost only when a split buys something.
**ALTERNATIVES:** Build the full `mcfinancial/` monorepo now (§44); keep a monolith with no target shape.
**BENEFITS:** Incremental modernisation of working code; one security perimeter until a split is justified; a destination everyone agrees on.
**RISKS:** Module boundaries can erode before the split. The mitigation is an import-boundary lint rule and each module exposing only `index.ts`.
**REVERSIBILITY:** easy. Modules become packages by moving folders.
**REQUIRES LEGAL REVIEW:** no
**REQUIRES FOUNDER APPROVAL:** yes

### Current structure (Stages 1–3)

```
mcfinancial/
├── src/
│   ├── app/                    # Next.js routes: UI (portal + admin route groups) + thin /api/v1 handlers
│   ├── modules/                # names match the target packages/
│   │   ├── auth/               # users, credentials, sessions, MFA, DAL (requirePermission)
│   │   ├── permissions/        # roles, permissions, RBAC matrix
│   │   ├── approvals/          # maker/checker requests
│   │   ├── audit/              # append-only audit log
│   │   ├── membership/         # members, status machine, eligibility
│   │   ├── contributions/      # plans, obligations, arrears, receipts
│   │   ├── payments/           # payments, allocations, Stripe/Zelle adapters
│   │   ├── loans/              # applications, amortization/ (pure engine), repayments, delinquency job
│   │   ├── accounting/         # ledger/ (posting, invariants), accounts, periods, reconciliation
│   │   ├── treasury/           # liquidity policy, cash position
│   │   ├── compliance/
│   │   ├── documents/
│   │   ├── notifications/
│   │   ├── reporting/          # read-only queries over ledger + domain
│   │   └── rewards/            # Stage 4 (MC Points)
│   ├── lib/                    # money, validation, db client, http helpers
│   └── components/             # becomes packages/ui
├── prisma/                     # single schema + migrations/ (becomes packages/database)
├── tests/                      # integration + e2e (unit tests sit next to modules)
├── scripts/                    # jobs/, ops/, data/, dev/, models/
├── docs/                       # architecture/ (this), and the §42 documents over time
└── infrastructure/             # compose files, Caddy, backup + restore scripts
```

**Module rules:** a module owns its tables; other modules call its exported functions; only `accounting` writes journal entries; `loans/amortization` and `accounting/ledger/invariants` are pure functions with no I/O.

### Target structure (`mcfinancial/`)

The founder's proposed layout, adopted as the destination with five adjustments:

1. **One home for each concern.** `packages/` holds all business logic. `apps/` only receive requests and render. `services/` only run background work and call `packages/`. So loans live in `packages/loans` (not also in `apps/api/loans` and `services/loan-engine`), and the same applies to compliance, reporting, notifications and treasury.
2. **Missing packages added:** `approvals` (maker/checker), `audit`, and `identity` split from `auth`.
3. **Contracts trimmed to what the gate decisions need:** `MCTNToken.sol` and `MCTNRewardsMinter.sol`. The treasury is a **Safe** multisig, not custom code (D-14). Vesting, if ever needed, is OpenZeppelin's `VestingWallet` (D-13). `MemberBenefits.sol` is dropped: benefits stay off-chain (D-09, D-15).
4. **Services start as scheduled jobs** inside the app. Premature ones (`benefit-engine`, `fraud-monitoring`, `analytics`) are not created until volume or a real requirement exists.
5. **No MCTN pages** in `apps/web`, `apps/member-portal` or `apps/admin` until Gate #2 ([product map](13-product-map.md)).

```
mcfinancial/
├── apps/
│   ├── web/                    # mcfinancial.us — static public site (no member data)
│   ├── member-portal/          # app.mcfinancial.us
│   ├── admin/                  # admin.mcfinancial.us — access-gated, own session
│   └── api/                    # api.mcfinancial.us — only when a second client exists (e.g. mobile)
├── packages/
│   ├── database/               # schema, migrations, seeds (synthetic only), repositories
│   ├── accounting/             # ledger, accounts, journal-entries, reconciliation, reporting
│   ├── membership/             # members, eligibility, status  (levels: not until needed)
│   ├── contributions/          # schedules, transactions, receipts, statements
│   ├── loans/                  # applications, underwriting, approvals, disbursement,
│   │                           # amortization, repayments, delinquency, statements
│   ├── payments/  treasury/  identity/  auth/  permissions/  approvals/  audit/
│   ├── compliance/  notifications/  reporting/  documents/  rewards/
│   └── ui/  config/
├── web3/                       # created at Gate #2
│   ├── contracts/              # MCTNToken.sol, MCTNRewardsMinter.sol
│   ├── scripts/                # deploy/, verify/, administration/ (via Safe)
│   ├── test/                   # unit/, integration/, fuzz/, invariant/
│   └── deployments/            # local/, testnet/, mainnet/
├── services/                   # each created only when its trigger is met
│   ├── blockchain-indexer/     # after Gate #2
│   ├── payment-worker/  reconciliation-worker/  notifications/  reporting/
├── infrastructure/             # docker, cloud, database, networking, monitoring,
│                               # secrets, backups, disaster-recovery
├── docs/  tests/  scripts/  .github/
└── README.md  SECURITY.md
```

### Staged path to the target monorepo

| Step | Creates | Trigger (do it when…) | Why then |
|---|---|---|---|
| 1 | `src/modules/*` with target names (above) | Stage 2 starts | Organisation now; zero operational cost |
| 2 | `apps/web` (static public site) | the public site is wanted and its copy is cleared by counsel | Independent, low-risk, keeps the public away from the app. ✅ **Built** (plain HTML and CSS served by Caddy; published once its copy is cleared). It has no build or dependencies, so it is not yet the second deployable that triggers step 3 |
| 3 | Monorepo tooling (npm/pnpm workspaces + Turborepo or Nx); the existing app moves to `apps/member-portal`; modules move to `packages/*` | step 2 creates a second deployable | Workspaces pay off once there are two apps |
| 4 | `apps/admin` split from the member portal | RBAC and MFA are stable (Stage 2 exit) | Real security boundary: separate deployment behind an access gateway |
| 5 | `services/*` (one at a time) | a job outgrows the app process (runtime, schedule, or failure isolation) | Until then, scheduled jobs inside the app are simpler and safer |
| 6 | `web3/` with the two contracts; later `services/blockchain-indexer` | Gate #2 approves an on-chain MCTN | Nothing on-chain exists before then |
| 7 | `apps/api` as its own service | a second client (e.g. a mobile app) needs the API | Until then, Next.js route handlers serve the web apps directly |
