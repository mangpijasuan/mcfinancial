# 19. Regulatory / Compliance Decision Matrix

> **This is not legal advice and contains no legal conclusions.** It identifies where the club's current activities and proposed features *may* engage legal regimes, so the right questions reach qualified counsel, tax advisers and accountants. Every row marked **LEGAL REVIEW REQUIRED** is unresolved.

The answers depend on facts not yet recorded anywhere in the system, above all:

- **the club's legal entity and tax status** (unincorporated association, LLC, nonprofit, cooperative);
- **the state(s)** where the club is organised and where members live;
- **the club's governing documents** and any written loan or membership terms.

These are Open Questions Q-1 to Q-3.

## Matrix

Exposure: **Now** = the club does this today; **Planned** = only if a proposed feature is built.

| # | Area | Why it may apply to MC | Exposure | Risk | Action | Status |
|---|---|---|---|---|---|---|
| 1 | Entity & governance | Determines liability of officers, tax treatment, who may approve what, and which rules below apply | Now | High | Confirm entity, governing documents, officer roles; align RBAC roles with them | **LEGAL REVIEW REQUIRED** |
| 2 | Federal consumer credit disclosure (TILA / Reg Z) | MC makes installment loans to individuals, 12–24 monthly payments. Reg Z's definition of "creditor" includes those who regularly extend consumer credit payable in more than four installments, using a "more than 25 times in the preceding calendar year" test. MC made 25 loans in 2021 and 20–24 in the years since. Application fees may be finance charges | Now | High | Counsel to assess creditor status and disclosure duties at current and projected volume | **LEGAL REVIEW REQUIRED** |
| 3 | State lending licensing, usury and fee limits | Many states license consumer lenders regardless of interest charged; fees and late fees may be capped | Now | High | Counsel to assess for the club's state(s) | **LEGAL REVIEW REQUIRED** |
| 4 | Fair lending (ECOA / Reg B) | Eligibility rules decide who gets credit; they must not discriminate on protected characteristics | Now | Medium | Keep eligibility rules objective and versioned (policy engine); counsel review of criteria and adverse-action notices | **LEGAL REVIEW REQUIRED** |
| 5 | E-signature validity (ESIGN / UETA) | Loan agreements are signed by typed name in the portal | Now | Medium | Add consent-to-e-sign, signed-document hash and retention; counsel to confirm enforceability | **LEGAL REVIEW REQUIRED** |
| 6 | Collections | Overdue notices are emailed; any future collection activity | Now | Low–Medium | Keep notices factual; no third-party collectors without review | Review with #3 |
| 7 | Money transmission | MC receives member funds and pays them out (withdrawals, loans). Zelle claims, UMI payouts, or holding value for members could change the analysis | Now / Planned | Medium | Counsel to assess current flows; avoid custodial wallets and stored value in the design | **LEGAL REVIEW REQUIRED** |
| 8 | AML / KYC / OFAC sanctions | Relevant if MC moves value for members at scale, transferable tokens, UMI payouts, or large cash | Planned (low now) | Medium | Identity verification before any payout programme; sanctions screening if tokens are transferable | **LEGAL REVIEW REQUIRED** before Phase 12 |
| 9 | Securities (member capital) | Members pool money that the club deploys; how member capital accounts are characterised matters | Now | Medium | Counsel to review the membership and withdrawal terms | **LEGAL REVIEW REQUIRED** |
| 10 | Securities (MCC) | A token distributed to members of a money-pooling club, especially if transferable, sold, or tied to "income", invites investment-contract analysis | Planned | **High** | Non-transferable, not sold, not redeemable for cash, no price or income claims (D-10, D-13); legal opinion before Gate #2 | **LEGAL REVIEW REQUIRED** |
| 11 | Securities / investment company (UMI, endowment) | Distributions from pooled funds, or investing a reserve to fund benefits | Planned | **High** | UMI stays research (D-15) | **LEGAL REVIEW REQUIRED** |
| 12 | Crypto-specific state rules (e.g. virtual-currency licensing) | Relevant if MC custodies or exchanges tokens for members in certain states | Planned | Medium | Non-custodial wallets only; no exchange function | **LEGAL REVIEW REQUIRED** before Phase 9 |
| 13 | Federal crypto market-structure developments | The US framework has been changing; token classification rules may shift | Planned | Medium | Re-check at each Founder Gate | Monitor |
| 14 | Tax — club | Tax status of the club; treatment of fee income and any surplus | Now | Medium | Accountant review with entity confirmation | **LEGAL / TAX REVIEW REQUIRED** |
| 15 | Tax — members | Rewards, MC Points or MCC, and any UMI may be taxable to recipients; information-reporting duties may fall on MC | Planned | Medium | Tax review of the rewards design before launch; record fair-value data | **TAX REVIEW REQUIRED** |
| 16 | Privacy & data security | MC holds members' identity and financial data. Non-bank lenders may be subject to financial-privacy and safeguards obligations (e.g. GLBA and the FTC Safeguards Rule); state privacy and breach-notification laws apply by residence | Now | High | Privacy architecture ([05](05-security-and-privacy.md#2-privacy-architecture)), written security programme, breach-response plan; counsel to confirm which regimes apply | **LEGAL REVIEW REQUIRED** |
| 17 | Consumer protection / marketing | Words like "Millionaires", "income", "rewards" and "token" in member communications | Now / Planned | Medium | No income, return or price claims (§51); review member-facing copy | Review copy before each launch |
| 18 | Custody | Only if MC ever holds keys or assets for members | Planned | High if custodial | Non-custodial design (§6 of [06](06-web3-and-mcc.md#6-wallet-architecture-mc-wallet-18--needed-only-after-gate-2)) | **LEGAL REVIEW REQUIRED** before Phase 9 |
| 19 | Payment-provider terms | Stripe and bank terms restrict certain businesses (lending, crypto) and uses of consumer P2P services | Now | Medium | Confirm the Stripe account's business category covers member dues and loan repayments; confirm Zelle use for club receipts is permitted | Provider review |
| 20 | Token distribution, staking, secondary trading | Airdrops, staking yields and exchange listings each raise the securities and tax questions above | Planned | High | **Not planned**: no staking, no listing, no liquidity pool unless separately approved | Gate #2 |
| 21 | Record retention | Financial and lending records must be kept for defined periods | Now | Medium | Immutable ledger + retention schedule (D-05); counsel to set periods | **LEGAL REVIEW REQUIRED** |

<a id="d-16"></a>
## D-16 — Legal scoping before tokenomics or UMI proceeds

**DECISION:** Engage counsel experienced in consumer lending, securities and digital assets for a scoping review of rows 1–3, 7, 9–11, 16 and 21 *before* Phases 6–11 (MCC, tokenomics, UMI) produce anything beyond the research in this assessment.
**WHY:** Rows 2 and 3 concern what the club **already does**. Rows 10 and 11 decide whether the Web3 and UMI tracks are viable at all. Doing tokenomics before the answers risks building the wrong thing.
**ALTERNATIVES:** Legal review at Phase 15 only, as in the original prompt. That risks designing features that must be discarded.
**BENEFITS:** It de-risks current operations and sets the boundaries for the token design.
**RISKS:** Cost and time. The mitigation is a fixed-scope engagement using this matrix as the brief.
**REVERSIBILITY:** easy
**REQUIRES LEGAL REVIEW:** yes (it *is* the legal review)
**REQUIRES FOUNDER APPROVAL:** yes (engagement and budget)
