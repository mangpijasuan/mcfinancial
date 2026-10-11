# 18. Treasury Architecture

Two treasuries, strictly separated:

| | **Fiat treasury** | **MCC treasury** (only after Gate #2) |
|---|---|---|
| Holds | the club's real money: member capital, loan repayments, fees | MCC not yet distributed |
| Where | bank account(s); Stripe balance; cash in transit with collectors | Safe multisig wallets on the chosen chain |
| Record | the fiat ledger (D-04) | the chain (authoritative), mirrored read-only into the platform |
| Risk today | **High**: exists now, no dual control recorded in the system | none (does not exist) |

They never net against each other, share an account, or fund each other automatically.

## 1. Fiat treasury

### Liquidity: the risk the club already carries

Members can withdraw their capital (`Partial` / `Full Exit` withdrawals exist), while that capital is lent out to other members for up to 24 months. That is a liquidity mismatch: if enough members ask for their money at once, the cash may not be there.

| Figure | Value |
|---|---:|
| Member capital recorded | $171,960 |
| Live loan principal outstanding | $26,860 |
| Historical loans still marked Active | $70,343 (to be reconciled, A-2) |
| Cash on hand | **unknown** at the time of the assessment (F-4, F-11). *Now:* the Treasury page computes it from a recorded bank balance carried forward, and from the ledger once opening balances are posted (A10, below) |

**Liquidity policy** (founder / board decision; numbers are starting points). Items 1 and 2 were approved as Gate #1 A10 and are **built** (`src/modules/treasury`, *Money → Treasury*): the reserve and capacity are shown on the Treasury page and the new-loan form, and a loan whose payout does not fit is refused, at proposal and again at approval. Until the ledger holds the club's cash, the cash figure is the Treasurer's latest recorded bank balance carried forward with the money recorded since; without one, no loan can be approved. Items 3–5 are not built yet.

1. **Minimum cash reserve** = the greater of 15% of member capital or 3 months of historical withdrawals. It is never lent out.
2. **Lending capacity** = cash − reserve − approved but undisbursed loans. The loan approval screen shows it and blocks approvals beyond it.
3. **Withdrawal notice**: partial withdrawals above a threshold, and full exits, are paid within *N* days, not instantly. Written into the membership terms (legal review).
4. **Concentration limit**: exposure to any one member (as borrower plus co-signer) is at most the existing $5,000 policy cap.
5. **Monthly treasury report** to the board: cash by account, reserve coverage, lending capacity, delinquency, collector cash aging, reconciliation status.

### Controls

| Control | Detail |
|---|---|
| Bank signatories | At least two; dual authorisation for outbound transfers above a threshold (bank-side setting) |
| Separation | The person who records a payment is not the person who reconciles the bank statement |
| Collector cash | Recorded at collection; deposit within *N* days; aging alert ([contributions](04-contributions-loans-ledger.md#1-contribution-management)) |
| Stripe | Payouts only to the club bank account; Stripe dashboard access requires MFA; restricted API keys |
| Disbursements | Treasurer proposes, a board member approves (D-06); paid only to the borrower's verified account |
| Reconciliation | Monthly bank, daily Stripe; the period cannot close with unreconciled items above a tolerance. *Built:* monthly bank reconciliation and month-end close with a zero tolerance (*Money → Reconciliation*); Stripe is reconciled by recording each payout until its balance transactions are imported |

## 2. MCC treasury (design for Phase 12+)

<a id="d-14"></a>
### D-14 — Safe multisigs, 3-of-5 hardware signers, one Safe per purpose

**DECISION:** All MCC held by the club sits in Safe multisig wallets. Each Safe has 5 signers and requires 3 approvals. Signers use hardware wallets. There is one Safe per purpose (below).
**WHY:** §16: never one ordinary wallet. 3-of-5 tolerates two lost keys and two compromised keys.
**ALTERNATIVES:** 2-of-3 (fewer people needed, less resilient); MPC custody provider (vendor dependency, possible custody implications); a single hardware wallet (rejected).
**BENEFITS:** No single person can move tokens; every movement is public and attributable.
**RISKS:** It needs 5 trustworthy, available people and signer discipline. Coordination latency.
**REVERSIBILITY:** moderate (signers and threshold can change through the Safe itself)
**REQUIRES LEGAL REVIEW:** yes (custody and fiduciary responsibilities of signers)
**REQUIRES FOUNDER APPROVAL:** yes (who the signers are)

### Safes

| Safe | Purpose | Threshold | Notes |
|---|---|---|---|
| Treasury (admin) | Admin of the token timelock and rewards minter; holds treasury MCC | 3 of 5 | Highest security; used rarely |
| Community / rewards ops | Community programme budget, released per approved programme | 3 of 5 (or 2 of 3 with a spending limit) | Funded in tranches from the Treasury Safe |
| Liquidity | **Not created** unless secondary trading is approved | — | — |
| Reserve | Only if a model with a reserve is chosen | 4 of 5 | Timelocked |

### Signer policy

- **Signers:** 5 named people, no more than 2 from the same household. Each holds a hardware wallet bought new from the manufacturer, with a PIN, and a seed phrase stored offline in two separate locations. No seed is ever typed into a computer or phone.
- **Signer replacement:** triggered by resignation, lost device or suspected compromise. The remaining signers execute a Safe owner swap within 72 hours, recorded in the board minutes.
- **Key rotation:** annual review; immediate rotation on any suspected compromise.
- **Approval limits:** spending-limit modules for routine community payouts; anything larger needs the full threshold.
- **Transaction hygiene:** every transaction is simulated before signing; the calldata is decoded and read aloud or cross-checked by a second signer; no blind signing.

### Emergency procedures

| Event | Response |
|---|---|
| One signer key compromised | Remaining signers swap the owner immediately; review recent proposals |
| Minter misbehaving | Pause the minter (Safe); investigate; replace through the timelock |
| Suspicious timelocked role change | Signers cancel within the delay window; board notified |
| Chain outage / sequencer down | No action required: MCC is a rewards token and nothing time-critical depends on it |

### Monitoring and reporting

- Alerts on any Safe proposal, execution, owner change, minter pause, timelock queue event, and on mints above X% of the period ceiling.
- A quarterly public treasury report: balances per Safe, mints versus ceiling, distributions by programme. Aggregates only; no member data.
