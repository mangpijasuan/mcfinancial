# 15–17. Universal Member Income (UMI) — Feasibility, Funding and Simulation

> **Research only.** Nothing here proposes paying UMI. The purpose is to define what would have to be true before UMI could be responsibly offered, and to show where the money would have to come from.

## 1. Feasibility framework

### Working definition

**UMI** is a recurring, equal benefit paid to eligible members from an identified **surplus**. It is:

- **not** Universal Basic Income (it is limited to members and conditional on funding);
- **not** a return on contributions (not proportional to what a member paid in; see §22);
- **not** a withdrawal (a withdrawal returns a member's own capital);
- **not** token issuance (newly minted MCC is not income; §20, §51).

### How UMI differs from other ways value reaches members

| Mechanism | Basis | Funded by | Main legal lens |
|---|---|---|---|
| Withdrawal | member's own capital | that member's balance | contract / club rules |
| Dividend / patronage distribution | proportional to capital or usage | club surplus | securities, tax, entity type |
| Rewards (MC Points) | activity | rewards budget | consumer protection, tax |
| **UMI** | equal per eligible member | surplus from external revenue | **securities, tax, money transmission, entity type** |
| Hardship / mutual aid | need | donations, reserve | charitable / nonprofit rules |

### Go / no-go criteria — all must hold before any UMI pilot

1. **Funding coverage ≥ 1.0 for 24 trailing months**: recurring *external* revenue (not contributions, not token sales) ≥ total UMI cost including overhead.
2. **Reserve** ≥ 12 months of UMI cost, held separately from member capital and loan liquidity.
3. **Liquidity is unaffected**: member withdrawal and loan capacity are modelled with UMI running (see [treasury](08-treasury.md)).
4. **A written legal opinion** on securities, tax reporting, money transmission and entity implications (§32, D-16).
5. **Eligibility** is equal and non-discriminatory, is not pay-more-get-more, and does not require buying MCC.
6. **Anti-fraud controls** are in place and tested (below).
7. **Administration cost** is under 15% of the benefit paid.
8. **Board approval**, and a member vote if the club's governing documents require one.

## 2. Funding-source analysis

| Source | Is it income to the club? | Realistic size today | Constraints | Flags |
|---|---|---|---|---|
| Member contributions | **No**; members' own money | $25,120 in 2025 | Paying UMI from contributions returns members' money minus overhead. It is not income | Misrepresentation risk if called "income" |
| Loan application fees | Yes | ≈ $1,200/yr (estimated; not recorded) | Tiny; grows only with lending volume | Fees are finance charges for lending-law purposes. **LEGAL REVIEW REQUIRED** |
| Late fees | Yes | $0 (never applied) | Should never be a funding source; it would reward delinquency | — |
| Loan interest | Yes, if charged | $0; loans are interest-free | Changes the club's character; usury, disclosure and licensing | **LEGAL REVIEW REQUIRED** |
| Interest on idle cash (bank / treasury bills) | Yes | Depends on cash on hand, unknown until the ledger exists (A-3) | Competes with loan liquidity | Low risk |
| Investment returns on a dedicated endowment | Yes | $0 | Needs capital; investment risk; fiduciary duties | **LEGAL REVIEW REQUIRED** (investment company / securities) |
| Sponsorships and partners | Yes | $0 | Independence; disclosure | Contract review |
| Marketplace fees (§26) | Yes | $0 | Needs a marketplace at scale | Payments / consumer protection |
| Grants and donations | Yes (restricted) | $0 | Usually requires nonprofit status and restricted use | Entity / tax status |
| **MCC issuance** | **No**; dilution, not revenue | — | Explicitly excluded (§21, §51) | — |
| Selling MCC from the treasury | Proceeds, not operating income | — | Turns MCC into a sold asset | **Securities: LEGAL REVIEW REQUIRED**; excluded from UMI funding |

**Conclusion:** the club has **no source today** that can fund UMI. The only external revenue is about $1,200 a year in fees. UMI becomes a question only after an external revenue line (interest on reserves, sponsorships, a marketplace, grants) exists and is measured in the ledger.

<a id="d-15"></a>
### D-15 — UMI remains research only

**DECISION:** Do not build or promise UMI. Keep it as a research track. Any future UMI is funded solely by identified external revenue that meets the go/no-go criteria above.
**WHY:** Funded today, it would redistribute members' own contributions at a loss (overhead) while being described as income.
**ALTERNATIVES:** A symbolic pilot funded from contributions; fund it with MCC (rejected by §21).
**BENEFITS:** Protects member capital and the club's credibility; avoids the highest-risk legal framing.
**RISKS:** Disappoints members expecting a benefit. The mitigation is to communicate UMI as a research goal with published criteria.
**REVERSIBILITY:** easy
**REQUIRES LEGAL REVIEW:** yes
**REQUIRES FOUNDER APPROVAL:** yes

## 3. Sustainability simulation

### Preliminary results

From [`scripts/models/umi.mjs`](../../scripts/models/umi.mjs). Annual requirement = N × B × 12, plus payout cost ($0.30 per payout), administration (8%), fraud losses (2%) and identity re-verification ($1.50 per member per year). All cost parameters are placeholders to be replaced with real quotes.

| Members | Benefit/mo | Monthly payout | Annual benefit | Annual overhead | Annual funding needed | Reserve | Endowment @4% |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | $5 | $500 | $6,000 | $1,110 | $7,110 | $3,000 | $177,750 |
| 100 | $10 | $1,000 | $12,000 | $1,710 | $13,710 | $6,000 | $342,750 |
| 100 | $25 | $2,500 | $30,000 | $3,510 | $33,510 | $15,000 | $837,750 |
| 1,000 | $5 | $5,000 | $60,000 | $11,100 | $71,100 | $30,000 | $1,777,500 |
| 1,000 | $10 | $10,000 | $120,000 | $17,100 | $137,100 | $60,000 | $3,427,500 |
| 1,000 | $25 | $25,000 | $300,000 | $35,100 | $335,100 | $150,000 | $8,377,500 |
| 10,000 | $5 | $50,000 | $600,000 | $111,000 | $711,000 | $300,000 | $17,775,000 |
| 10,000 | $10 | $100,000 | $1,200,000 | $171,000 | $1,371,000 | $600,000 | $34,275,000 |
| 10,000 | $25 | $250,000 | $3,000,000 | $351,000 | $3,351,000 | $1,500,000 | $83,775,000 |
| 100,000 | $5 | $500,000 | $6,000,000 | $1,110,000 | $7,110,000 | $3,000,000 | $177,750,000 |
| 100,000 | $10 | $1,000,000 | $12,000,000 | $1,710,000 | $13,710,000 | $6,000,000 | $342,750,000 |
| 100,000 | $25 | $2,500,000 | $30,000,000 | $3,510,000 | $33,510,000 | $15,000,000 | $837,750,000 |
| 1,000,000 | $5 | $5,000,000 | $60,000,000 | $11,100,000 | $71,100,000 | $30,000,000 | $1,777,500,000 |
| 1,000,000 | $10 | $10,000,000 | $120,000,000 | $17,100,000 | $137,100,000 | $60,000,000 | $3,427,500,000 |
| 1,000,000 | $25 | $25,000,000 | $300,000,000 | $35,100,000 | $335,100,000 | $150,000,000 | $8,377,500,000 |

Current club (114 active members) against its own inflows:

| Benefit/mo | Annual funding needed | % of 2025 contributions | Years of estimated fee revenue |
|---:|---:|---:|---:|
| $5 | $8,105 | 32% | 6.8 |
| $10 | $15,629 | 62% | 13.0 |
| $25 | $38,201 | 152% | 31.8 |

Estimated non-contribution revenue: 24 loans × $50 average application fee ≈ $1,200/yr (loans are interest-free).

**Reading the table:** every $1 per member per month of UMI for 1,000 members costs about $13,700 a year after overhead. To fund it sustainably from investment returns alone would require an endowment of about $340,000 at a 4% real yield. For the club as it is today, even $5 a month would consume about a third of annual contributions.

### Requirements for the full simulation (Phase 11)

**Inputs (all parameterised):** member count and growth curve; churn; benefit amount and frequency; eligibility rate (share of members who qualify); payout method cost; administration cost (fixed and per member); verification cost; fraud rate; reserve policy; each funding source as an independent stochastic series (mean, volatility, correlation with membership); yield on the reserve; inflation.

**Outputs, per month over 10 years:** benefit paid; overhead; funding received by source; reserve balance; coverage ratio (funding ÷ cost); months of reserve remaining; probability of reserve depletion; cost per eligible member; share of the benefit lost to overhead and fraud.

**Scenarios:** member counts of 100, 1,000, 10,000, 100,000 and 1,000,000 (§21) × benefit levels × funding mixes.

**Stress tests:** funding falls 50% for 12 months; membership doubles in 6 months (Sybil wave); fraud rate at 5× baseline; payout provider cost triples; a simultaneous run on member withdrawals.

**Acceptance criteria:** probability of reserve depletion within 10 years < 1% under the base case and < 10% under combined stress; coverage ratio ≥ 1.0 in the base case without drawing on reserves.

**Engineering requirements:** deterministic with a seed; integer cents; versioned assumptions file; output reproducible in CI; every chart traceable to a run ID.

### Eligibility principles (§22) — for the record, not for implementation

Candidate factors: active status, minimum tenure (e.g. 12 months), verified identity, good standing (no delinquency), programme rules. **Excluded:** contribution size, loan size, token holdings or purchases, and anything proportional to money paid in.

### Anti-fraud requirements (§23)

| Threat | Control |
|---|---|
| Duplicate accounts / fake identities | Identity verification at enrolment; one person, one membership; manual review queue |
| Sybil waves | Minimum tenure before eligibility; enrolment rate alerts |
| Referral farming | No referral component in UMI |
| Wallet farming | UMI (if ever paid in anything other than USD) goes to a verified member's linked wallet only; one wallet per member |
| Collusion by officers | Maker/checker on eligibility overrides; officers cannot approve their own household |
| API abuse | Authenticated, rate-limited endpoints; idempotent distribution runs |
| Privacy | Verification results are stored, raw documents are deleted after verification, and nothing goes on-chain |
