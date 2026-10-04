// Opening balances: migration step M4 (docs/architecture/11 §1, recipe).
//
// At a cutover date (default 2026-01-01, where transaction-level records
// begin) the ledger starts from:
//   1. member capital: each member's pre-cutover archive total
//      (Dr 9000 Opening balance equity / Cr 2000 Member capital);
//   2. cash: the bank statement balance the day before the cutover
//      (Dr 1000 Bank / Cr 9000);
//   3. loans: the balance of every loan still open at the cutover, derived
//      from its repayments or confirmed by the Treasurer
//      (Dr 1100 Loans receivable / Cr 9000);
// then replays everything recorded since the cutover that has no ledger
// entry yet (contributions, withdrawals, loans made before the loan engine
// and their repayments). What is left in 9000 is (cash + loans) − member
// capital: the club's historical surplus or shortfall, to be explained to
// the board. That figure is the most important output of the migration.
//
// Nothing is posted until a second person approves (ledger.opening_balances);
// the approval re-checks that the pre-cutover records have not changed
// since the plan was proposed. Afterwards the daily dues job keeps posting
// legacy activity (withdrawals, older loans) until those flows post on
// their own (M5). Older loans whose repayments match their schedule move
// onto the loan engine at the same time.
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { type Cents, ZERO, add, cents, fromBigInt, subtract, sum, toBigInt } from '@/lib/money'
import { type IsoDate, dateOnly, isoDateOf, todayIso } from '@/lib/dates'
import { OperationError } from '@/lib/operationError'
import { historyOpeningBlockers } from '@/modules/loans/history'
import { type AuditContext, recordAudit } from '@/modules/audit'
import type { Actors } from '@/modules/approvals/actors'
import { buildSchedule, outstandingPrincipal, replay } from '@/modules/loans/amortization'
import { postPendingContributionEntries } from '@/modules/contributions'
import { postPendingLoanEntries } from '@/modules/loans/postings'
import { refreshLoan } from '@/modules/loans/state'
import { type EntryInput, type LineInput, postEntry } from './ledger'
import { CASH_ACCOUNTS, OPENING_KEYS, accountsReady, ledgerOpening } from './autoPost'
import { LOANS_RECEIVABLE, MEMBER_CAPITAL, UNAPPLIED, legacyCents, legacyRepayments, postLegacyActivity } from './legacyActivity'

type Tx = Prisma.TransactionClient

export const DEFAULT_CUTOVER: IsoDate = '2026-01-01'
export const OPENING_EQUITY = '9000'
export const LEGACY_POLICY_VERSION = 'legacy-import-2026'

export { OPENING_KEYS, ledgerOpening, postLegacyActivity }

export type OpeningInputs = {
  cutover: IsoDate
  /** The bank statement balance at the end of the day before the cutover. */
  bankBalanceCents: Cents | null
  /** Treasurer-confirmed balances at the cutover, by loan number (overrides the derived ones). */
  confirmedLoanBalances: Record<string, Cents>
}

function addDays(date: IsoDate, days: number): IsoDate {
  const d = dateOnly(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Reading the legacy records ─────────────────────────────────────────

async function loadRecords(db: Tx, cutover: IsoDate) {
  const [members, contributions, withdrawals, loans, history] = await Promise.all([
    db.member.findMany({ select: { id: true, legalName: true, archiveLifetime: true, overallContributions: true }, orderBy: { id: 'asc' } }),
    db.contribution.findMany({
      select: { transactionId: true, memberId: true, amountCents: true, paymentDate: true, reversedAt: true, receiptNumber: true },
    }),
    db.withdrawal.findMany({ orderBy: [{ withdrawalDate: 'asc' }, { withdrawalId: 'asc' }] }),
    db.loan.findMany({
      include: { payments: { orderBy: [{ paymentDate: 'asc' }, { eventSeq: 'asc' }] } },
      orderBy: { loanId: 'asc' },
    }),
    historyOpeningBlockers(db, cutover),
  ])
  return { members, contributions, withdrawals, loans, history }
}

type Records = Awaited<ReturnType<typeof loadRecords>>
type LegacyLoan = Records['loans'][number]

export type Anomaly = { code: string; message: string; count: number; totalCents?: Cents; items?: string[] }

/** Loans made before the loan engine that the migration handles (not cancelled). */
const legacyLoans = (r: Records) => r.loans.filter((l) => l.principalCents === null && l.lifecycle !== 'cancelled')

// ── The plan ───────────────────────────────────────────────────────────

export type LoanAtCutover = {
  loanId: string
  borrower: string
  loanDate: IsoDate
  derivedCents: Cents
  balanceCents: Cents
  source: 'derived' | 'confirmed'
}

export type OpeningReport = {
  cutover: IsoDate
  openingDate: IsoDate
  asOf: IsoDate
  posted: { cutover: IsoDate; entryNumber: string } | null
  memberCapital: { members: number; totalCents: Cents }
  bankCents: Cents | null
  loansAtCutover: LoanAtCutover[]
  loansTotalCents: Cents
  /** What 9000 holds after the opening entries: (cash + loans) − member capital. */
  openingEquityCents: Cents
  replay: Record<'contributions' | 'withdrawals' | 'loanDisbursements' | 'loanRepayments', { count: number; totalCents: Cents }>
  checks: {
    memberCapital: { memberId: string; name: string; ledgerCents: Cents; legacyCents: Cents; differenceCents: Cents }[]
    loans: { loanId: string; borrower: string; ledgerCents: Cents; legacyCents: Cents; differenceCents: Cents }[]
  }
  anomalies: Anomaly[]
  adoption: { adopt: string[]; keepLegacy: { loanId: string; reason: string }[] }
  entries: number
  accounts: string[]
}

export type OpeningPlan = { opening: EntryInput[]; openingHash: string; report: OpeningReport }

export async function planOpening(db: Tx, inputs: OpeningInputs, asOf: IsoDate = todayIso()): Promise<OpeningPlan> {
  const { cutover } = inputs
  const openingDate = addDays(cutover, -1)
  const r = await loadRecords(db, cutover)
  const anomalies: Anomaly[] = []
  const flag = (code: string, message: string, items: { id: string; cents?: Cents }[]) => {
    if (items.length === 0) return
    const withAmounts = items.filter((i) => i.cents !== undefined)
    anomalies.push({
      code, message, count: items.length, items: items.map((i) => i.id).slice(0, 50),
      ...(withAmounts.length ? { totalCents: sum(withAmounts.map((i) => i.cents!)) } : {}),
    })
  }

  // 1. Member capital
  const capitalLines: LineInput[] = []
  const inexact: { id: string }[] = []
  const negativeArchive: { id: string; cents: Cents }[] = []
  for (const m of r.members) {
    const { amount, exact } = legacyCents(m.archiveLifetime)
    if (!exact) inexact.push({ id: m.id })
    if (amount < 0) negativeArchive.push({ id: m.id, cents: amount })
    if (amount > 0) capitalLines.push({ account: MEMBER_CAPITAL, credit: amount, memberId: m.id, memo: 'Archive contributions before the cutover' })
  }
  const capitalTotal = sum(capitalLines.map((l) => l.credit!))
  flag('archive_negative', 'Members with a negative archive total (not posted; correct the record first)', negativeArchive)
  flag('archive_not_cents', 'Archive totals that are not a whole number of cents (rounded)', inexact)

  // 3. Loans open at the cutover
  const loansAtCutover: LoanAtCutover[] = []
  const overpaidBefore: { id: string; cents: Cents }[] = []
  const unknownConfirmed = Object.keys(inputs.confirmedLoanBalances).filter((id) => !r.loans.some((l) => l.loanId === id))
  flag('confirmed_unknown_loan', 'Confirmed balances given for loans that do not exist or were made after the cutover', unknownConfirmed.map((id) => ({ id })))
  for (const loan of legacyLoans(r)) {
    if (isoDateOf(loan.loanDate) >= cutover) continue
    const paidBefore = sum(loan.payments.filter((p) => isoDateOf(p.paymentDate) < cutover).map((p) => legacyCents(p.amount).amount))
    const derived = subtract(legacyCents(loan.loanAmount).amount, paidBefore)
    const confirmed = inputs.confirmedLoanBalances[loan.loanId]
    const balance = confirmed ?? derived
    if (balance < 0) overpaidBefore.push({ id: loan.loanId, cents: balance })
    if (balance <= 0) continue
    loansAtCutover.push({
      loanId: loan.loanId, borrower: loan.borrowerName, loanDate: isoDateOf(loan.loanDate),
      derivedCents: derived, balanceCents: balance, source: confirmed === undefined ? 'derived' : 'confirmed',
    })
  }
  flag('loan_overpaid_before_cutover', 'Loans repaid beyond their amount before the cutover (not posted)', overpaidBefore)
  const loansTotal = sum(loansAtCutover.map((l) => l.balanceCents))
  const borrowerOf = new Map(r.loans.map((l) => [l.loanId, l.borrowerId]))

  const opening: EntryInput[] = []
  const meta = (key: string, description: string, lines: LineInput[]): EntryInput => ({
    effectiveDate: openingDate, type: 'opening_balance', description, reference: `Opening balances at ${openingDate}`,
    source: { type: 'opening_balance', id: cutover }, idempotencyKey: key, lines,
  })
  if (capitalTotal > 0) {
    opening.push(meta(OPENING_KEYS.capital, `Opening member capital at ${openingDate} (archive totals)`, [
      { account: OPENING_EQUITY, debit: capitalTotal }, ...capitalLines,
    ]))
  }
  // 2. Cash
  const bank = inputs.bankBalanceCents
  if (bank === null) {
    anomalies.push({ code: 'bank_balance_missing', message: 'The bank balance at the cutover has not been entered (needed before proposing)', count: 1 })
  } else if (bank !== 0) {
    opening.push(meta(OPENING_KEYS.bank, `Opening bank balance at ${openingDate} (statement)`, bank > 0
      ? [{ account: CASH_ACCOUNTS.bank, debit: bank }, { account: OPENING_EQUITY, credit: bank }]
      : [{ account: OPENING_EQUITY, debit: cents(-bank) }, { account: CASH_ACCOUNTS.bank, credit: cents(-bank) }]))
  }
  if (loansTotal > 0) {
    opening.push(meta(OPENING_KEYS.loans, `Opening loans receivable at ${openingDate}`, [
      ...loansAtCutover.map((l) => ({ account: LOANS_RECEIVABLE, debit: l.balanceCents, memberId: borrowerOf.get(l.loanId)!, loanId: l.loanId, memo: l.source === 'confirmed' ? 'Confirmed by the Treasurer' : 'Loan amount less repayments before the cutover' })),
      { account: OPENING_EQUITY, credit: loansTotal },
    ]))
  }
  const openingHash = createHash('sha256').update(JSON.stringify(opening.map((e) => [e.idempotencyKey, e.effectiveDate, e.lines]))).digest('hex')

  // Anomalies in the records since the cutover
  const live = r.contributions.filter((c) => !c.reversedAt)
  const asItem = (c: (typeof live)[number]) => ({ id: c.transactionId, cents: fromBigInt(c.amountCents) })
  flag('contribution_before_cutover', 'Contributions dated before the cutover (already in the archive totals? not posted)',
    live.filter((c) => isoDateOf(c.paymentDate) < cutover).map(asItem))
  flag('contribution_future_dated', 'Contributions dated after today (F-10; posted on their recorded date)',
    live.filter((c) => isoDateOf(c.paymentDate) > asOf).map(asItem))
  flag('contribution_not_positive', 'Contributions of $0 or less, kept from older records (not posted)',
    live.filter((c) => c.amountCents <= BigInt(0)).map(asItem))
  flag('withdrawal_before_cutover', 'Withdrawals dated before the cutover (are the archive totals gross or net of them? not posted)',
    r.withdrawals.filter((w) => isoDateOf(w.withdrawalDate) < cutover).map((w) => ({ id: w.withdrawalId, cents: legacyCents(w.amount).amount })))
  // Older loans (M9): each one marked Active needs a confirmed balance first.
  flag('historical_loans_unconfirmed',
    'Older loans (2021–2025) marked Active without a confirmed balance: confirm them under Loan History → Link older loans before proposing',
    r.history.unconfirmed.map((h) => ({ id: h.loanId, cents: h.cents })))
  flag('historical_loans_confirmed_late',
    'Older loans confirmed as of the cutover or later: their balance must be as of a day before the cutover',
    r.history.confirmedTooLate.map((id) => ({ id })))

  // Projection: member capital and loan balances once everything is posted
  const capitalBy = new Map<string, Cents>(capitalLines.map((l) => [l.memberId!, l.credit!]))
  const bump = (id: string, delta: Cents) => capitalBy.set(id, add(capitalBy.get(id) ?? ZERO, delta))
  const postedContribs = live.filter((c) => isoDateOf(c.paymentDate) >= cutover && c.amountCents > BigInt(0))
  for (const c of postedContribs) bump(c.memberId, fromBigInt(c.amountCents))
  const postedWithdrawals = r.withdrawals.filter((w) => isoDateOf(w.withdrawalDate) >= cutover && w.amount > 0)
  for (const w of postedWithdrawals) bump(w.memberId, cents(-legacyCents(w.amount).amount))
  const withdrawnAfter = new Map<string, Cents>()
  for (const w of postedWithdrawals) withdrawnAfter.set(w.memberId, add(withdrawnAfter.get(w.memberId) ?? ZERO, legacyCents(w.amount).amount))

  const capitalChecks = r.members.flatMap((m) => {
    const ledger = capitalBy.get(m.id) ?? ZERO
    const legacy = subtract(legacyCents(m.overallContributions).amount, withdrawnAfter.get(m.id) ?? ZERO)
    return ledger === legacy ? [] : [{ memberId: m.id, name: m.legalName, ledgerCents: ledger, legacyCents: legacy, differenceCents: subtract(ledger, legacy) }]
  })

  const cutoverBalance = new Map(loansAtCutover.map((l) => [l.loanId, l.balanceCents]))
  const loanChecks: OpeningReport['checks']['loans'] = []
  const adopt: string[] = []
  const keepLegacy: { loanId: string; reason: string }[] = []
  let disbursements = { count: 0, totalCents: ZERO }
  let repayments = { count: 0, totalCents: ZERO }
  const earlyPayments: { id: string; cents: Cents }[] = []
  for (const loan of legacyLoans(r)) {
    const { splits, balance, startsAfter } = legacyRepayments(loan, cutover, cutoverBalance.get(loan.loanId) ?? ZERO)
    if (startsAfter) {
      disbursements = { count: disbursements.count + 1, totalCents: add(disbursements.totalCents, legacyCents(loan.loanAmount).amount) }
      for (const p of loan.payments) {
        if (isoDateOf(p.paymentDate) < isoDateOf(loan.loanDate)) earlyPayments.push({ id: p.paymentId, cents: legacyCents(p.amount).amount })
      }
    }
    for (const s of splits) repayments = { count: repayments.count + 1, totalCents: add(repayments.totalCents, s.amount) }
    const legacy = legacyCents(loan.balanceRemaining).amount
    if (balance !== legacy) {
      loanChecks.push({ loanId: loan.loanId, borrower: loan.borrowerName, ledgerCents: balance, legacyCents: legacy, differenceCents: subtract(balance, legacy) })
    }
    if (loan.lifecycle === 'disbursed') {
      const reason = adoptionBlocker(loan, balance, legacy, asOf)
      if (reason) keepLegacy.push({ loanId: loan.loanId, reason })
      else adopt.push(loan.loanId)
    }
  }
  flag('loan_payment_before_loan', 'Repayments dated before their loan was made', earlyPayments)

  const withdrawalsTotal = sum(postedWithdrawals.map((w) => legacyCents(w.amount).amount))
  const report: OpeningReport = {
    cutover, openingDate, asOf,
    posted: await ledgerOpening(db),
    memberCapital: { members: capitalLines.length, totalCents: capitalTotal },
    bankCents: bank,
    loansAtCutover,
    loansTotalCents: loansTotal,
    openingEquityCents: subtract(add(bank ?? ZERO, loansTotal), capitalTotal),
    replay: {
      contributions: { count: postedContribs.length, totalCents: sum(postedContribs.map((c) => fromBigInt(c.amountCents))) },
      withdrawals: { count: postedWithdrawals.length, totalCents: withdrawalsTotal },
      loanDisbursements: disbursements,
      loanRepayments: repayments,
    },
    checks: { memberCapital: capitalChecks, loans: loanChecks },
    anomalies,
    adoption: { adopt, keepLegacy },
    entries: opening.length,
    accounts: Array.from(new Set([...opening.flatMap((e) => e.lines.map((l) => l.account)), MEMBER_CAPITAL, LOANS_RECEIVABLE, UNAPPLIED, OPENING_EQUITY, ...Object.values(CASH_ACCOUNTS)])).sort(),
  }
  return { opening, openingHash, report }
}

/** Why an older loan cannot move onto the loan engine yet (null: it can). */
function adoptionBlocker(loan: LegacyLoan, ledgerBalance: Cents, legacyBalance: Cents, asOf: IsoDate): string | null {
  const principal = legacyCents(loan.loanAmount)
  if (!principal.exact || principal.amount <= 0) return 'loan amount is not a positive whole number of cents'
  if (!Number.isInteger(loan.termMonths) || loan.termMonths < 1 || loan.termMonths > 360) return 'term is not 1–360 months'
  if (loan.payments.some((p) => isoDateOf(p.paymentDate) > asOf)) return 'has repayments dated in the future'
  if (loan.payments.some((p) => !legacyCents(p.amount).exact || p.amount <= 0)) return 'has repayments that are not positive whole cents'
  const schedule = buildSchedule({ principal: principal.amount, installments: loan.termMonths, loanDate: isoDateOf(loan.loanDate) })
  const { position, unapplied } = replay(schedule, loan.payments.map((p) => ({ type: 'payment' as const, amount: legacyCents(p.amount).amount, asOf: isoDateOf(p.paymentDate) })))
  if (unapplied > 0) return 'repaid beyond its amount'
  const outstanding = outstandingPrincipal(position)
  if (outstanding !== ledgerBalance) return `schedule leaves ${outstanding / 100} but the ledger will hold ${ledgerBalance / 100} (confirmed balance differs)`
  if (outstanding !== legacyBalance) return `schedule leaves ${outstanding / 100} but the record says ${legacyBalance / 100}`
  if (outstanding === 0) return 'fully repaid (mark it paid off instead)'
  return null
}

// ── Posting ────────────────────────────────────────────────────────────

/**
 * Move an older loan onto the loan engine: store its schedule and link its
 * ledger entries, so the daily loan job services it from now on.
 */
async function adoptLoan(tx: Tx, loanId: string, asOf: IsoDate) {
  const loan = await tx.loan.findUniqueOrThrow({ where: { loanId }, include: { payments: true } })
  const principal = legacyCents(loan.loanAmount).amount
  const schedule = buildSchedule({ principal, installments: loan.termMonths, loanDate: isoDateOf(loan.loanDate) })
  const opening = await tx.journalEntry.findUnique({ where: { idempotencyKey: OPENING_KEYS.loans }, select: { entryNumber: true } })
  const disbursement = await tx.journalEntry.findUnique({ where: { idempotencyKey: `m4:loan-disbursement:${loanId}` }, select: { entryNumber: true } })
  const linkedEntry = (disbursement ?? opening)!.entryNumber
  await tx.loan.update({
    where: { loanId },
    data: {
      principalCents: toBigInt(principal), applicationFeeCents: BigInt(0), policyVersion: LEGACY_POLICY_VERSION,
      dueDay: 10, graceDays: 15,
      disbursedOn: dateOnly(isoDateOf(loan.loanDate)), disbursedAmountCents: toBigInt(principal),
      disbursementMethod: 'Recorded before the loan engine', disbursementEntry: linkedEntry,
      installments: {
        create: schedule.installments.map((it) => ({ number: it.number, dueDate: dateOnly(it.dueDate), principalCents: toBigInt(it.principal) })),
      },
    },
  })
  // Repayments before the cutover are inside the opening balance.
  await tx.loanPayment.updateMany({ where: { loanId, journalEntry: null }, data: { journalEntry: linkedEntry } })
  await refreshLoan(tx, loanId, asOf)
}

export type OpeningPayload = {
  cutover: IsoDate
  bankBalanceCents: Cents
  confirmedLoanBalances: Record<string, Cents>
  openingHash: string
}

/** Check a proposal can go ahead: not posted yet, chart approved, inputs complete. */
export async function checkOpening(tx: Tx, inputs: OpeningInputs) {
  if (await ledgerOpening(tx)) throw new OperationError(409, 'Opening balances have already been posted.')
  if (inputs.bankBalanceCents === null) throw new OperationError(400, 'Enter the bank balance at the cutover (from the statement).')
  const plan = await planOpening(tx, inputs)
  if (plan.opening.length === 0) throw new OperationError(422, 'There is nothing to open: no archive capital, bank balance or open loans.')
  const history = await historyOpeningBlockers(tx, inputs.cutover)
  if (history.unconfirmed.length) {
    throw new OperationError(422, `Confirm the balances of the older loans still marked Active first (M9): ${history.unconfirmed.map((h) => h.loanId).join(', ')}.`)
  }
  if (history.confirmedTooLate.length) {
    throw new OperationError(422, `These older loans were confirmed as of the cutover or later; their balance must be as of a day before it: ${history.confirmedTooLate.join(', ')}.`)
  }
  if (!(await accountsReady(tx, plan.report.accounts))) {
    throw new OperationError(422, 'The chart of accounts must be approved before opening balances can be posted (Gate #1 A13).')
  }
  return plan
}

/**
 * Post the opening balances and everything since the cutover, in one
 * transaction, then move matching older loans onto the loan engine.
 * Runs when the second person approves.
 */
export async function postOpeningBalances(tx: Tx, payload: OpeningPayload, actors: Actors, ctx: AuditContext) {
  const inputs: OpeningInputs = { cutover: payload.cutover, bankBalanceCents: payload.bankBalanceCents, confirmedLoanBalances: payload.confirmedLoanBalances }
  const plan = await checkOpening(tx, inputs)
  if (plan.openingHash !== payload.openingHash) {
    throw new OperationError(409, 'Records from before the cutover changed after this was proposed. Review the report and propose again.')
  }
  const entries: string[] = []
  for (const input of plan.opening) {
    const { entry } = await postEntry(tx, { ...input, createdBy: actors.maker.id, approvedBy: actors.checker!.id })
    entries.push(entry.entryNumber)
  }
  entries.push(...await postLegacyActivity(tx))

  // Everything else waiting for the ledger: contributions and loans on the engine.
  const members = await tx.member.findMany({ select: { id: true } })
  for (const m of members) entries.push(...await postPendingContributionEntries(tx, m.id))
  const engineLoans = await tx.loan.findMany({ where: { principalCents: { not: null } }, select: { loanId: true } })
  for (const l of engineLoans) entries.push(...await postPendingLoanEntries(tx, l.loanId))

  for (const loanId of plan.report.adoption.adopt) await adoptLoan(tx, loanId, plan.report.asOf)

  await recordAudit(tx, ctx, {
    action: 'ledger.opening_balances.post', entityType: 'ledger', entityId: 'opening-balances',
    after: {
      cutover: payload.cutover, bankBalanceCents: payload.bankBalanceCents, memberCapitalCents: plan.report.memberCapital.totalCents,
      loansCents: plan.report.loansTotalCents, openingEquityCents: plan.report.openingEquityCents,
    },
    metadata: { entries: entries.length, adoptedLoans: plan.report.adoption.adopt, maker: actors.maker.id, checker: actors.checker!.id },
  })
  return { cutover: payload.cutover, entries, adoptedLoans: plan.report.adoption.adopt, openingEquityCents: plan.report.openingEquityCents }
}


// ── Reconciliation (after posting; the nightly comparison for M5) ──────

/**
 * The ledger as posted against the old records: each member's capital
 * (2000) against their stored total less withdrawals since the cutover,
 * and each loan's receivable (1100) against its stored balance.
 */
export async function reconcile(db: Tx) {
  const opened = await ledgerOpening(db)
  if (!opened) return null
  const [capital, receivables, members, withdrawals, loans] = await Promise.all([
    db.journalLine.groupBy({ by: ['memberId'], where: { accountCode: MEMBER_CAPITAL }, _sum: { debitCents: true, creditCents: true } }),
    db.journalLine.groupBy({ by: ['loanId'], where: { accountCode: LOANS_RECEIVABLE }, _sum: { debitCents: true, creditCents: true } }),
    db.member.findMany({ select: { id: true, legalName: true, overallContributions: true } }),
    db.withdrawal.findMany({ where: { withdrawalDate: { gte: dateOnly(opened.cutover) }, amount: { gt: 0 } }, select: { memberId: true, amount: true } }),
    // Only loans whose money has moved (not approved-but-unpaid, cancelled or written off).
    db.loan.findMany({ where: { lifecycle: { in: ['disbursed', 'paid_off'] } }, select: { loanId: true, borrowerName: true, balanceRemaining: true } }),
  ])
  const net = (s: { _sum: { debitCents: bigint | null; creditCents: bigint | null } }, creditNormal: boolean) => {
    const d = fromBigInt(s._sum.debitCents!)
    const c = fromBigInt(s._sum.creditCents!)
    return creditNormal ? subtract(c, d) : subtract(d, c)
  }
  const capitalBy = new Map(capital.map((g) => [g.memberId, net(g, true)]))
  const loanBy = new Map(receivables.map((g) => [g.loanId, net(g, false)]))
  const withdrawn = new Map<string, Cents>()
  for (const w of withdrawals) withdrawn.set(w.memberId, add(withdrawn.get(w.memberId) ?? ZERO, legacyCents(w.amount).amount))
  const memberCapital = members.flatMap((m) => {
    const ledger = capitalBy.get(m.id) ?? ZERO
    const legacy = subtract(legacyCents(m.overallContributions).amount, withdrawn.get(m.id) ?? ZERO)
    return ledger === legacy ? [] : [{ memberId: m.id, name: m.legalName, ledgerCents: ledger, legacyCents: legacy, differenceCents: subtract(ledger, legacy) }]
  })
  const loanDiffs = loans.flatMap((l) => {
    const ledger = loanBy.get(l.loanId) ?? ZERO
    const legacy = legacyCents(l.balanceRemaining).amount
    return ledger === legacy ? [] : [{ loanId: l.loanId, borrower: l.borrowerName, ledgerCents: ledger, legacyCents: legacy, differenceCents: subtract(ledger, legacy) }]
  })
  return { cutover: opened.cutover, memberCapital, loans: loanDiffs }
}
