# 26. Open Questions

Grouped by who can answer them. Items marked ★ block the start of the financial-core work (Stage 2–3).

## Legal and governance — Founder, with counsel

| # | Question | Why it matters |
|---|---|---|
| Q-1 ★ | What is MC Financial's legal entity type (association, LLC, nonprofit, cooperative), and who are its officers? | Drives almost every row of the [compliance matrix](09-compliance-matrix.md); maps to RBAC roles |
| Q-2 ★ | Which state(s) is the club organised in, and where do members live? | Lending, privacy and money-transmission rules are state-specific |
| Q-3 | Do written bylaws, membership terms or loan terms exist? Where? | The system should enforce what the documents say, not the reverse |
| Q-4 ★ | Is member capital refundable on request? On what notice, and with what exceptions (e.g. while co-signing)? | Liability vs. equity classification (D-04); liquidity policy ([08](08-treasury.md)) |
| Q-5 | Have members already been told anything about MCTN, rewards or UMI? | Existing expectations shape messaging and consumer-protection risk |

## Finance operations — Treasurer

| # | Question | Why it matters |
|---|---|---|
| Q-6 ★ | Which bank accounts does the club hold, and who are the signatories? | Opening cash balance (M4); dual-authorisation controls |
| Q-7 ★ | How does collector cash flow today: who collects, how often it is deposited, and who checks it? | Cash-custody design (F-11) |
| Q-8 | Are application fees actually collected? Where are they recorded today? | They are missing from the system (F-5); affects the opening surplus |
| Q-9 | Have late fees ever been charged? Should they be? | Policy says $5; the code never applies it |
| Q-10 ★ | What is the true status and balance of the 30 historical loans marked "Active" ($70,343)? Has `sync-active-historical-loans.js` been run in production? | Up to $70k of receivables unaccounted for or double-counted (F-8). *Answered on Loans → 2021–2025 records → Link older loans (M9): the Treasurer confirms each balance before opening balances* |
| Q-11 | Who absorbs Stripe processing fees: the member (surcharge) or the club? | Ledger posting and member-facing price. Surcharging has its own rules |
| Q-12 ★ | Who are the officers for maker/checker? At least three distinct active people are needed (Finance, Treasurer, Board) | D-06 cannot work with fewer |
| Q-13 | Is an accountant engaged, or can one be? | Chart of accounts sign-off; member-capital classification |
| Q-14 | Why are some contributions $30 or $50 instead of $20: double months, catch-up, voluntary extra? *(Stage 3 default: extra covers the next months as credit; staff can record a payment as voluntary instead.)* | Contribution-plan and obligation design |

## Product and members — Founder / Board

| # | Question | Why it matters |
|---|---|---|
| Q-15 | How are new members approved today? | Pending → Active workflow |
| Q-16 | What notice period should apply to withdrawals and full exits? | Liquidity policy |
| Q-17 | Do members actually want a token or crypto, or would they value points, events and discounts equally? A short member survey is suggested | Validates or retires the MCTN track before money is spent on it |
| Q-18 | What could MC Points buy (event tickets, merchandise, fee waivers, recognition)? | Points without a use have no value |
| Q-19 | Should on-time contribution streaks earn points? | Links rewards to contributions; see [rewards](06-web3-and-mctn.md#5-rewards-architecture) |

## Web3 — Founder (only if pursued after Gate #2)

| # | Question | Why it matters |
|---|---|---|
| Q-20 | Who would the five treasury signers be? | D-14 needs five trustworthy, available people |
| Q-21 | What budget exists for an independent smart-contract audit and ongoing monitoring? | Mainnet is blocked without an audit (§35) |
| Q-22 | Is there any intent to let MCTN be transferred or traded in future? | Determines contract design and legal exposure now |

## Technical — Engineering, with Founder approval

| # | Question | Why it matters |
|---|---|---|
| Q-23 ★ | Can engineering get a production database snapshot (under confidentiality) for audit tasks A-1 to A-3? | The migration cannot be planned against seed data alone |
| Q-24 | Budget for off-site encrypted backups and a second environment (staging)? | S-6; safe migration rehearsals |
| Q-25 | Will the repository ever be shared outside the core team? | Decides whether to rewrite git history to remove member PII (S-7) |
