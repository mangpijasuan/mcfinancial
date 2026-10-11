# Founder Decision Gate #1

**Purpose:** decisions that must be made before implementation starts (§50). Nothing past this gate begins until each item below is explicitly approved, amended or rejected.

**How to use:** for each item, tick one box and add notes where needed. A recommendation is given for every item; approving the recommendation is one tick. Items are split in two:

- **Part A** unblocks the financial-core work (Stages 2–3). It is needed now.
- **Part B** sets the *principles* for MCC, rewards and UMI. Details come back for approval at Gate #2, after the legal scoping review.

Each recommendation links to its full rationale.

---

## Part A — Required before any implementation

| # | Decision | Recommendation | Approve | Amend | Reject |
|---|---|---|:-:|:-:|:-:|
| A1 | Keep and evolve the existing app as a modular monolith, organised for the `mcfinancial/` monorepo target and split in stages as each trigger is met; no rewrite | Approve ([D-01](10-data-api-repository.md#d-01)) | ☑ | ☐ | ☐ |
| A2 | Adopt a double-entry ledger as the financial system of record; stored balance fields are retired after migration | Approve ([D-04](04-contributions-loans-ledger.md#d-04)) | ☑ | ☐ | ☐ |
| A3 | Posted financial entries are immutable; corrections by reversal; no hard deletion of members, loans, payments or agreements | Approve ([D-05](04-contributions-loans-ledger.md#d-05)) | ☑ | ☐ | ☐ |
| A4 | Maker/checker approvals per the table in D-06. **Name the officers** (at least three people) | Approved; **officer names still to be supplied** ([D-06](04-contributions-loans-ledger.md#d-06)) | ☑ | ☐ | ☐ |
| A5 | Replace the admin / super-admin model with the RBAC roles in [05](05-security-and-privacy.md#rbac-and-makerchecker); MFA mandatory for staff | Approve ([D-07](05-security-and-privacy.md#d-07)) | ☑ | ☐ | ☐ |
| A6 | Loan engine defaults: interest-free amortisation (last installment absorbs rounding), allocation order fees → overdue → current → prepay | Approve ([D-08](04-contributions-loans-ledger.md#d-08)) | ☑ | ☐ | ☐ |
| A7 | Late fee: enforce the existing $5 policy automatically (waivable with approval), **or** remove it from policy | **Enforce** ☑ / remove ☐. Counsel confirms state fee limits before the first fee is charged | ☑ | ☐ | ☐ |
| A8 | Application fees are recorded as club income at disbursement (collected separately **or** netted from the disbursement) | Approved; separate ☐ / **netted** ☑ (fee deducted from the amount paid out) | ☑ | ☐ | ☐ |
| A9 | Loan cancellation allowed only before disbursement; afterwards only payoff, restructure or board-approved write-off | Approve ([04 §2](04-contributions-loans-ledger.md#2-loan-management)) | ☑ | ☐ | ☐ |
| A10 | Liquidity policy: minimum cash reserve (starting point: the greater of 15% of member capital or 3 months of withdrawals) that is never lent out; lending capacity enforced at approval. *Built 2026-10-03 (Money → Treasury)* | Approve starting values ([08](08-treasury.md#1-fiat-treasury)) | ☑ | ☐ | ☐ |
| A11 | Migration cutover date **2026-01-01** for opening balances, and the Treasurer owns explaining any opening variance to the board | Approve ([23](11-migration-roadmap-testing.md#1-migration-strategy)) | ☑ | ☐ | ☐ |
| A12 | Engage counsel (lending, securities, digital assets) for the fixed-scope review in the compliance matrix, before any tokenomics or UMI work proceeds | Approved; **budget still to be set** ([D-16](09-compliance-matrix.md#d-16)) | ☑ | ☐ | ☐ |
| A13 | Engage an accountant to approve the chart of accounts and the member-capital classification (liability vs. equity) | Approve ([04 §4](04-contributions-loans-ledger.md#4-financial-ledger)) | ☑ | ☐ | ☐ |
| A14 | Provide engineering a confidential production snapshot and bank statements for the remaining audit (A-1 to A-3) | Approve ([02 §3](02-existing-system-audit.md#3-remaining-audit-work-requires-access-outside-this-repository)) | ☑ | ☐ | ☐ |
| A15 | Remove real member data from the repository's seed files going forward (encrypted import instead); decide whether to purge it from git history | Approved going forward; purge history: yes ☐ / **no** ☑ (repository stays private) | ☑ | ☐ | ☐ |
| A16 | Adopt the product map: `mcfinancial.us` (public), `app.` (members), `admin.` (staff, access-gated) with isolated sessions; public-site copy and "mcfinancial" branding reviewed by counsel before launch. **Domain:** `mcfinance.us` confirmed as owned by the club (founder, 2026-09-26); project and domain renamed to **mcfinancial** / `mcfinancial.us` (founder, 2026-10-02). Registering `mcfinancial.us` is still to be confirmed | Approve ([D-17](13-product-map.md#d-17)) | ☑ | ☐ | ☐ |

**Blocking facts to supply with Part A:** the answers to open questions Q-1, Q-2, Q-4, Q-6, Q-7, Q-10, Q-12 and Q-23 ([open questions](12-open-questions.md)).

---

## Part B — Principles for MCC, rewards and UMI

Approving these commits to **principles only**. No token is created, and no contract is written or deployed. Specific parameters return at Gate #2.

| # | Decision | Recommendation | Approve | Amend | Reject |
|---|---|---|:-:|:-:|:-:|
| B1 | **MCC's purpose**: a member reward and recognition instrument, not an investment, not a currency, not a claim on club assets | Approve ([06 §2](06-web3-and-mcc.md#2-mcc-feasibility)) | ☐ | ☐ | ☐ |
| B2 | **Start as MC Points** (off-chain, non-transferable) and decide on an on-chain MCC at Gate #2 using real usage data and legal advice | Approve ([D-10](06-web3-and-mcc.md#d-10)) | ☐ | ☐ | ☐ |
| B3 | **Transferability**: non-transferable at launch; any change requires a new decision and legal review | Approve | ☐ | ☐ | ☐ |
| B4 | **Purchase**: members cannot buy MCC or points | Approve | ☐ | ☐ | ☐ |
| B5 | **Redemption**: points and MCC are never redeemable for cash or at a fixed dollar value; they may be spent on defined member benefits | Approve (§9) | ☐ | ☐ | ☐ |
| B6 | **Secondary trading**: not intended; no liquidity allocation, no listing, no staking | Approve | ☐ | ☐ | ☐ |
| B7 | **Blockchain**: no selection now; shortlist EVM rollups (Base, Arbitrum One, OP Mainnet) for Gate #2 | Approve shortlist ([D-11](06-web3-and-mcc.md#d-11)) | ☐ | ☐ | ☐ |
| B8 | **Custody**: members hold their own keys (embedded non-custodial or external wallets); MC never custodies member tokens | Approve ([06 §6](06-web3-and-mcc.md#6-wallet-architecture-mc-wallet-18--needed-only-after-gate-2)) | ☐ | ☐ | ☐ |
| B9 | **Supply philosophy**: size supply from the reward policy; prefer emissions tied to active members with an immutable annual ceiling (Model C); no large pre-mint; no team token allocation (team paid in fiat) | Approve ([D-13](06-web3-and-mcc.md#d-13)) | ☐ | ☐ | ☐ |
| B10 | **Token contract principles**: minimal, non-upgradeable, minting only via a rate-limited minter, admin via Safe + timelock | Approve ([D-12](06-web3-and-mcc.md#d-12)) | ☐ | ☐ | ☐ |
| B11 | **Treasury governance**: Safe multisig, 3-of-5 hardware signers, one Safe per purpose. **Name candidate signers** | Approve; candidates: ______________ ([D-14](08-treasury.md#d-14)) | ☐ | ☐ | ☐ |
| B12 | **Contributions ↔ MCC**: separate assets and separate accounting events; no automatic conversion; rewards never proportional to the amount contributed | Approve (§9, [06 §5](06-web3-and-mcc.md#5-rewards-architecture)) | ☐ | ☐ | ☐ |
| B13 | **Loans ↔ MCC**: none. Tokens are never collateral, never affect loan eligibility, and are never earned for borrowing | Approve | ☐ | ☐ | ☐ |
| B14 | **Rewards philosophy**: reward tenure, participation, education and service, not money; anti-abuse controls as designed; decide on contribution streaks (Q-19) | Approve; streaks: yes ☐ / no ☐ | ☐ | ☐ | ☐ |
| B15 | **PII and financial data never on-chain**, including hashes and public wallet-to-member mappings | Approve ([D-09](06-web3-and-mcc.md#d-09)) | ☐ | ☐ | ☐ |
| B16 | **UMI definition**: an equal benefit to eligible members funded only by identified external surplus; not a return on contributions; not token issuance | Approve ([07 §1](07-umi.md#1-feasibility-framework)) | ☐ | ☐ | ☐ |
| B17 | **UMI funding model**: none available today; UMI remains research until a funding source meets the go/no-go criteria | Approve ([D-15](07-umi.md#d-15)) | ☐ | ☐ | ☐ |
| B18 | **Membership eligibility principles** (for any benefit): based on active status, tenure, verified identity and good standing; never on wealth, contribution size or token holdings; no membership tiers for now | Approve ([03 §2](03-domain-and-membership.md#2-member-management-architecture)) | ☐ | ☐ | ☐ |

---

## Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Founder | | ☑ **Part A approved as marked** · ☐ Part B pending | 2026-09-26 |
| Treasurer | | ☐ Reviewed | |
| Board representative | | ☐ Reviewed | |

### Decision record — Part A (2026-09-26)

**Unblocked:** Stage 2 (foundation: PostgreSQL everywhere, migration history, test harness, audit log, then RBAC and MFA) and Stage 3 planning.

**Still outstanding (approved in principle, details owed):**

| Item | Owed | Blocks |
|---|---|---|
| A4 | Names of at least three officers for maker/checker, and which role each holds | Replacing the transitional Club Officer role; switching maker/checker on (built; one setting, `MAKER_CHECKER_ENFORCED=true`) |
| A7 | Counsel confirmation of late-fee limits in the club's state | Charging the first late fee (the delinquency job ships with fees switched off until confirmed) |
| A12 | Counsel engagement and budget | Stage 3a legal scoping; Gate #2 |
| A13 | Accountant engagement | Posting the chart of accounts (Stage 3) |
| A14 | Production snapshot and bank statements | Opening balances (migration step M4) |
| A15 | *Done in code:* real data removed from the repository; synthetic data for development. Owed: keep the original data files encrypted outside git (README "Real club data") | — |
| Q-1, Q-2, Q-4, Q-6, Q-7, Q-10, Q-12, Q-23 | Blocking facts ([open questions](12-open-questions.md)) | Stage 3 |

**Part B** (MCC, rewards and UMI principles) is not yet decided. Until it is, no token, contract or UMI work starts.
