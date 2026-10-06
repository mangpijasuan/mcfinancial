// "My loan" in the member portal: the member's own loans, as the staff loan
// page shows them, in cents. A loan on the loan engine shows its stored
// schedule, what is paid, what is late and the amount that pays it off
// today; a loan made before the engine shows the figures kept on it.
// Cancelled loans are left out. Loans the member co-signs are listed
// briefly: the co-signer answers for them too.
import type { Prisma } from '@prisma/client'
import { type Cents, ZERO, fromLegacyDollars, min } from '@/lib/money'
import { type IsoDate, isoDateOf } from '@/lib/dates'
import { withLoanBalances } from '@/modules/accounting/reads'
import { type InstallmentView, LOAN_WITH_HISTORY, isEngineLoan, loanState } from './state'

type Db = Prisma.TransactionClient

export type LoanStage = 'awaiting_payout' | 'repaying' | 'paid_off' | 'written_off'

export type MemberLoan = {
  loanId: string
  loanDate: IsoDate
  termMonths: number
  stage: LoanStage
  cosigner: string | null
  amountCents: Cents
  paidCents: Cents
  /** Principal still owed. */
  outstandingCents: Cents
  /** Late fees owed (late fees are off until counsel confirms, Gate #1 A7). */
  feesOutstandingCents: Cents
  /** What pays the loan off today; null for a loan made before the loan engine. */
  payoffCents: Cents | null
  monthlyDueCents: Cents
  nextDue: { date: IsoDate; amountCents: Cents } | null
  /** Set when a payment is late. A loan made before the loan engine only says so, without an amount. */
  overdue: { amountCents: Cents | null; daysPastDue: number | null } | null
  /** The repayment schedule; null for a loan made before the loan engine. */
  schedule: InstallmentView[] | null
  payments: { paymentId: string; date: IsoDate; amountCents: Cents; method: string | null }[]
}

export type CosignedLoan = { loanId: string; borrowerName: string; stage: LoanStage; outstandingCents: Cents; overdue: boolean }

const AWAITING = ['approved', 'agreement_signed']

function stageOf(loan: { lifecycle: string; status: string }, payoffZero: boolean): LoanStage {
  if (AWAITING.includes(loan.lifecycle)) return 'awaiting_payout'
  if (loan.lifecycle === 'charged_off') return 'written_off'
  if (loan.lifecycle === 'paid_off' || loan.status === 'Paid Off' || payoffZero) return 'paid_off'
  return 'repaying'
}

const ORDER: Record<LoanStage, number> = { repaying: 0, awaiting_payout: 1, paid_off: 2, written_off: 3 }

type LoanRow = Prisma.LoanGetPayload<{ include: typeof LOAN_WITH_HISTORY }>

/** One loan as the member sees it; `balance` is the kept balance from the current source (older loans). */
function viewOf(loan: LoanRow, balance: number, asOf: IsoDate): MemberLoan {
  const payments = [...loan.payments]
    .sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime())
    .map((p) => ({ paymentId: p.paymentId, date: isoDateOf(p.paymentDate), amountCents: fromLegacyDollars(p.amount), method: p.paymentMethod }))
  const base = {
    loanId: loan.loanId, loanDate: isoDateOf(loan.loanDate), termMonths: loan.termMonths, cosigner: loan.cosignerName,
    monthlyDueCents: fromLegacyDollars(loan.monthlyDue), payments,
  }
  if (isEngineLoan(loan)) {
    const state = loanState(loan, asOf)
    const stage = stageOf(loan, loan.lifecycle === 'disbursed' && state.payoff === ZERO)
    const next = state.installments.find((it) => it.remaining > 0)
    const late = stage === 'repaying' && state.delinquency.overdueAmount > 0
    return {
      ...base, stage,
      amountCents: state.schedule.totalPrincipal, paidCents: state.totalPaid,
      outstandingCents: state.outstandingPrincipal, feesOutstandingCents: state.feesOutstanding, payoffCents: state.payoff,
      nextDue: stage === 'repaying' && next ? { date: next.dueDate, amountCents: next.remaining } : null,
      overdue: late ? { amountCents: state.delinquency.overdueAmount, daysPastDue: state.delinquency.daysPastDue } : null,
      schedule: state.installments,
    }
  }
  const stage = stageOf(loan, false)
  const outstanding = fromLegacyDollars(balance)
  return {
    ...base, stage,
    amountCents: fromLegacyDollars(loan.loanAmount), paidCents: fromLegacyDollars(loan.totalPaid),
    outstandingCents: outstanding, feesOutstandingCents: ZERO, payoffCents: null,
    nextDue: stage === 'repaying' && loan.nextDueDate && outstanding > 0
      ? { date: isoDateOf(loan.nextDueDate), amountCents: min(base.monthlyDueCents, outstanding) } : null,
    overdue: stage === 'repaying' && loan.overdue ? { amountCents: null, daysPastDue: null } : null,
    schedule: null,
  }
}

async function viewsOf(db: Db, where: Prisma.LoanWhereInput, asOf: IsoDate): Promise<{ row: LoanRow; view: MemberLoan }[]> {
  const rows = await db.loan.findMany({ where: { ...where, lifecycle: { not: 'cancelled' } }, include: LOAN_WITH_HISTORY, orderBy: { loanDate: 'desc' } })
  // Older loans show their balance from the current source (records, or the ledger once screens read from it).
  const balances = new Map((await withLoanBalances(db, rows)).map((l) => [l.loanId, l.balanceRemaining]))
  return rows.map((row) => ({ row, view: viewOf(row, balances.get(row.loanId)!, asOf) }))
}

export async function memberLoans(db: Db, memberId: string, asOf: IsoDate): Promise<{ loans: MemberLoan[]; cosigned: CosignedLoan[] }> {
  const loans = (await viewsOf(db, { borrowerId: memberId }, asOf)).map((v) => v.view).sort((a, b) => ORDER[a.stage] - ORDER[b.stage])
  // Worked out the same way as the borrower's own view, so both always agree.
  const cosigned = (await viewsOf(db, { cosignerId: memberId }, asOf))
    .filter(({ view }) => view.stage === 'repaying' || view.stage === 'awaiting_payout')
    .map(({ row, view }): CosignedLoan => ({
      loanId: view.loanId, borrowerName: row.borrowerName, stage: view.stage, outstandingCents: view.outstandingCents, overdue: view.overdue !== null,
    }))
  return { loans, cosigned }
}
