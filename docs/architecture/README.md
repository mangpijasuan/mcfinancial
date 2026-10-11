# MC Financial Platform - Architecture Assessment v1

**Status:** First Assignment deliverable (Master Prompt v2.0, §48). [Founder Decision Gate #1](FOUNDER_DECISION_GATE_1.md) **Part A approved 2026-09-26**; Part B (MCC, rewards, UMI principles) not yet decided.
**Progress:** Stage 2 (foundation) is built: PostgreSQL everywhere with migrations, test harness, append-only audit log, role-based access with database-backed sessions, staff MFA, encrypted off-site backups with a restore check, Content-Security-Policy, persistent rate limits, and real data out of the repository. What remains for Stage 2 is operational: switch the backups on in production and run the first restore check.
**Stage 3 (financial core) under way:** Money in integer cents, the loan calculation engine, and the double-entry ledger with database-enforced invariants are built (migration step M3). The chart of accounts waits for the accountant (A13); maker/checker approvals are built (switched on once officers are named, A4); new loans run on the engine (stored schedule, payout with the fee netted, daily delinquency, late fees switched off until counsel confirms, waivers and write-offs with checkers, postings once the chart is approved). Contributions are monthly dues obligations: payments cover the oldest month first, with numbered receipts, reversal with a checker, and arrears reporting. Opening balances (M4) are built: report, rehearsal, and posting with a second person's approval; they run once the chart is approved (A13) and the production snapshot has been rehearsed (A14). The liquidity policy (A10) is built: a minimum cash reserve, and loans approved only within the lending capacity (*Money → Treasury*). Dual-write and the nightly comparison (M5) are built: the 30-day count of clean days starts once opening balances are posted. Reconciliation and the month-end close (F-11) are built: transfers to the bank, collector cash aging, monthly bank reconciliation, and months closed in order. Next: reading from the ledger (M6), after the M5 count is met.

This assessment keeps the existing application and evolves it. It does not propose a rewrite. Every number cited comes from the current codebase and database (the seeded club data), or from the reproducible models in [`scripts/models/`](../../scripts/models/).

## How to read this

Start with the [executive assessment](01-executive-assessment.md) (one page), then [Founder Decision Gate #1](FOUNDER_DECISION_GATE_1.md). The remaining documents are the supporting detail.

| # | Deliverable (§48) | Document |
|---|---|---|
| 1 | Executive architecture assessment | [01-executive-assessment.md](01-executive-assessment.md) |
| 2 | Existing-system audit plan | [02-existing-system-audit.md](02-existing-system-audit.md) |
| 3 | Domain model | [03-domain-and-membership.md](03-domain-and-membership.md#1-domain-model) |
| 4 | Member-management architecture | [03-domain-and-membership.md](03-domain-and-membership.md#2-member-management-architecture) |
| 5 | Contribution-management architecture | [04-contributions-loans-ledger.md](04-contributions-loans-ledger.md#1-contribution-management) |
| 6 | Loan-management architecture | [04-contributions-loans-ledger.md](04-contributions-loans-ledger.md#2-loan-management) |
| 7 | Financial ledger / accounting architecture | [04-contributions-loans-ledger.md](04-contributions-loans-ledger.md#4-financial-ledger) |
| 8 | Security threat model | [05-security-and-privacy.md](05-security-and-privacy.md#1-threat-model) |
| 9 | Privacy architecture | [05-security-and-privacy.md](05-security-and-privacy.md#2-privacy-architecture) |
| 10 | Web2 / Web3 boundary | [06-web3-and-mcc.md](06-web3-and-mcc.md#1-web2--web3-boundary) |
| 11 | MCC feasibility analysis | [06-web3-and-mcc.md](06-web3-and-mcc.md#2-mcc-feasibility) |
| 12 | Blockchain comparison | [06-web3-and-mcc.md](06-web3-and-mcc.md#3-blockchain-comparison) |
| 13 | Three preliminary tokenomics models | [06-web3-and-mcc.md](06-web3-and-mcc.md#4-preliminary-tokenomics) |
| 14 | MCC rewards architecture | [06-web3-and-mcc.md](06-web3-and-mcc.md#5-rewards-architecture) |
| 15 | UMI feasibility framework | [07-umi.md](07-umi.md#1-feasibility-framework) |
| 16 | UMI funding-source analysis | [07-umi.md](07-umi.md#2-funding-source-analysis) |
| 17 | UMI sustainability simulation requirements | [07-umi.md](07-umi.md#3-sustainability-simulation) |
| 18 | Treasury architecture | [08-treasury.md](08-treasury.md) |
| 19 | Regulatory / compliance decision matrix | [09-compliance-matrix.md](09-compliance-matrix.md) |
| 20 | Database architecture | [10-data-api-repository.md](10-data-api-repository.md#1-database-architecture) |
| 21 | API architecture | [10-data-api-repository.md](10-data-api-repository.md#2-api-architecture) |
| 22 | Repository architecture | [10-data-api-repository.md](10-data-api-repository.md#3-repository-architecture) |
| 23 | Migration strategy | [11-migration-roadmap-testing.md](11-migration-roadmap-testing.md#1-migration-strategy) |
| 24 | Development roadmap | [11-migration-roadmap-testing.md](11-migration-roadmap-testing.md#2-development-roadmap) |
| 25 | Testing strategy | [11-migration-roadmap-testing.md](11-migration-roadmap-testing.md#3-testing-strategy) |
| 26 | Open questions | [12-open-questions.md](12-open-questions.md) |
| — | Product map: surfaces (www / app / admin), pillars, navigation | [13-product-map.md](13-product-map.md) |
| — | Founder Decision Gate #1 | [FOUNDER_DECISION_GATE_1.md](FOUNDER_DECISION_GATE_1.md) |

## Decision log

Each decision is written out in full, in the §49 format, in the linked document. "Legal" means the decision cannot be finalised without professional legal, tax or accounting review.

| ID | Decision (proposed) | Reversibility | Legal | Founder | Where |
|---|---|---|---|---|---|
| D-01 | Modular monolith now, with modules named for the target `mcfinancial/` monorepo; split into apps / services / `web3/` in stages as each trigger is met | easy | no | yes | [10](10-data-api-repository.md#d-01) |
| D-02 | PostgreSQL in every environment; retire SQLite and the duplicate schema file | easy | no | no | [10](10-data-api-repository.md#d-02) |
| D-03 | Store money as integer cents; all arithmetic through one Money module | moderate | no | no | [04](04-contributions-loans-ledger.md#d-03) |
| D-04 | Double-entry general ledger becomes the financial system of record | difficult | yes | yes | [04](04-contributions-loans-ledger.md#d-04) |
| D-05 | Posted entries are immutable; corrections by reversal; no hard deletes of financial data | moderate | no | yes | [04](04-contributions-loans-ledger.md#d-05) |
| D-06 | Maker/checker approval for manual postings, loans, withdrawals and Zelle confirmations | easy | no | yes | [04](04-contributions-loans-ledger.md#d-06) |
| D-07 | Permission-based RBAC with database-backed checks and staff MFA | moderate | no | yes | [05](05-security-and-privacy.md#d-07) |
| D-08 | Loan engine: zero-interest amortisation by default; fees as explicit transactions | easy | yes | yes | [04](04-contributions-loans-ledger.md#d-08) |
| D-09 | All PII and fiat financial records stay off-chain, permanently | difficult | no | yes | [06](06-web3-and-mcc.md#d-09) |
| D-10 | MCC starts as an off-chain, non-transferable points ledger that can be settled on-chain later | easy | yes | yes | [06](06-web3-and-mcc.md#d-10) |
| D-11 | If on-chain: shortlist EVM L2s (Base, Arbitrum One, OP Mainnet); final pick after testnet | moderate | no | yes | [06](06-web3-and-mcc.md#d-11) |
| D-12 | Minimal, non-upgradeable OpenZeppelin token; minting only through a rate-limited rewards minter | difficult | yes | yes | [06](06-web3-and-mcc.md#d-12) |
| D-13 | Supply sized from the reward policy (Model C or B); reject a large fixed pre-mint (Model A) | difficult | yes | yes | [06](06-web3-and-mcc.md#d-13) |
| D-14 | Treasury under Safe multisigs, 3-of-5 hardware-wallet signers, one Safe per purpose | moderate | yes | yes | [08](08-treasury.md#d-14) |
| D-15 | UMI remains research only; any future UMI is funded solely by identified external revenue | easy | yes | yes | [07](07-umi.md#d-15) |
| D-16 | Engage counsel for a legal scoping review before tokenomics or UMI work proceeds | easy | yes | yes | [09](09-compliance-matrix.md#d-16) |
| D-17 | Three surfaces on separate hosts (`mcfinancial.us`, `app.`, `admin.`) with isolated sessions; member app grouped into Membership / financial / Web3 (gated) | easy | yes | yes | [13](13-product-map.md#d-17) |

## Reproducing the numbers

```bash
node scripts/models/tokenomics.mjs   # §13 tokenomics tables
node scripts/models/umi.mjs          # §17 UMI funding tables
```

Both scripts use integer arithmetic and have no dependencies. Every assumption is a named constant at the top of the file.
