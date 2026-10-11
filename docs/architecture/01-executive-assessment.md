# 1. Executive Architecture Assessment

## The club today, in numbers

| Measure | Value | Source |
|---|---:|---|
| Members | 211 (114 active, 97 inactive) | `Member` table |
| Standard contribution | $20 / month (339 of 350 recorded payments) | `Contribution` table |
| Contributions recorded, all time | $171,960 | sum of `overallContributions` |
| …of which exist only as yearly summary totals, with no transaction detail | $164,790 (95.8%) | `archiveLifetime`, `YearlyTotal` 2014–2025 |
| Contributions in 2025 | $25,120 | `YearlyTotal` |
| Loans issued 2021–2026 | 121 loans, $492,560 | `HistoricalLoan` + `Loan` |
| Loans per year | 20–25 | `HistoricalLoan` |
| Loan interest | none; loans are interest-free by agreement text | `LoanAgreement` template |
| Non-contribution revenue | ≈ $1,200/yr from application fees (estimate; never recorded) | loan policy × volume |
| Live loan balance shown on dashboard | $26,860 (6 loans) | `Loan` table |
| Historical loans still marked "Active" | 30 loans, $70,343 remaining, **not** in the dashboard figure | `HistoricalLoan` |

The club is a small, long-running savings-and-lending circle. Members pay a flat monthly contribution. The pool funds interest-free member loans of up to $5,000. Its financial scale is roughly $25k a year in and $100k a year recycled through loans.

## Verdict

**Keep the application; rebuild its financial core.** The web app works well for a club of this size. It has admin and member portals, loan-policy checks, e-signed agreements, online payments and a usable mobile layout. Those should stay. What cannot stay is how money is represented.

1. **There is no ledger.** Balances such as `contributions2026`, `overallContributions`, `totalPaid` and `balanceRemaining` are editable fields that application code overwrites. They agree with the transaction rows today only because every code path remembers to update them; nothing enforces it.
2. **Money is stored as floating point.** Every amount column is a `Float`. The loan code already over-schedules repayments: a $10,000 loan over 24 months is scheduled as 24 × $416.67 = $10,000.08. Loan L05 in the live data is exactly this case.
3. **Money movements are missing.** Loan disbursements, application fees, late fees, Stripe processing fees and cash handed to collectors are never recorded. The system cannot answer "how much cash does the club hold?"
4. **History can be erased.** Cancelling or deleting a loan agreement deletes the loan and its repayment records. Deleting a member is a hard delete. There is no audit log. *(Fixed in Stage 2: records are kept on cancel, hard deletes removed, append-only audit log added.)*
5. **One person can do anything.** Every admin can record, edit and confirm any financial event alone. A demoted admin keeps their role for up to 30 days, because roles live inside the session token.
6. **There are two sources of truth for loans.** Live `Loan` rows and `HistoricalLoan` rows are linked to members by matching names. Two pairs of members share identical legal names, and 12 of the 66 historical borrower names match no member.

None of this is unusual for a club that grew out of spreadsheets. It is, however, the foundation any token, reward or income programme would sit on, and today that foundation cannot be audited.

## Where Web3 genuinely helps, and where it does not

Applying the test "what problem does putting this on-chain solve?":

- **Contributions, loans, balances and member data:** nothing. They need privacy, correction workflows and legal enforceability, all of which a public chain works against. They stay off-chain permanently (D-09).
- **Member rewards:** a little, later. On-chain settlement gives members a verifiable, portable record of what they have earned. The same programme runs perfectly well as an off-chain points ledger first, with none of the regulatory, custody or key-management risk (D-10).
- **Treasury transparency:** modest. If the club ever holds MCC, a public multisig makes treasury movements visible to members. It says nothing about the fiat treasury, which is where the club's real money is.

**Nothing in the club's current value to members depends on a token.** MCC is optional and can be sequenced last without blocking anything else.

## Universal Member Income, honestly

The club's only non-contribution revenue is about $1,200 a year of loan application fees. A UMI of just $5 a month for today's 114 active members costs about $8,100 a year including overhead. That is 32% of 2025 contributions, or almost seven years of fee revenue. Funded today, UMI would hand members back their own contributions, net of costs. It would not be income. UMI therefore stays a research track until an external, recurring funding source exists (D-15). See [07-umi.md](07-umi.md).

## The largest risk is regulatory, not technical

- **Lending.** The club has made 20–25 installment loans a year, including 25 in 2021, and charges application fees. Federal truth-in-lending rules use a "more than 25 times in the preceding calendar year" test to decide who counts as a creditor. State lending law may apply regardless. **LEGAL REVIEW REQUIRED.**
- **Securities.** A pool of member money, plus a token, plus payments described as "income" is the pattern that invites securities analysis. **LEGAL REVIEW REQUIRED** before MCC or UMI design is finalised (D-16).
- **Entity.** The legal form of MC Financial (association, LLC, nonprofit, cooperative) is not recorded anywhere in the system. It changes almost every answer in the [compliance matrix](09-compliance-matrix.md).

## Recommended sequence

1. **Harden.** Audit log, RBAC with database-backed checks, MFA for staff, encrypted off-site backups.
2. **Ledger.** Integer-cent money, double-entry journal, opening balances migrated from the archive totals, balances derived rather than stored.
3. **Lending and contributions.** Real repayment schedules, recorded disbursements and fees, computed delinquency, maker/checker approvals, reconciliation.
4. **Legal scoping.** Runs in parallel with steps 2–3, and must finish before step 5.
5. **MC Points.** An off-chain, non-transferable rewards ledger that can be settled on-chain later.
6. **MCC on testnet, audit, then mainnet.** Only after Founder Gates #2 and #3.
7. **UMI.** Only if a funding source that passes [the feasibility framework](07-umi.md#1-feasibility-framework) exists.
