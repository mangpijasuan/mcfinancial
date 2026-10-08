import type { Prisma } from '@prisma/client'
import { nextPublicId } from './publicIds'
import { recalcMemberLoanState } from './memberLoanState'
import { OperationError } from './operationError'
import { MoneyError, fromLegacyDollars } from './money'
import { todayIso } from './dates'
import { isEngineLoan, refreshLoan } from '@/modules/loans/state'
import { postPendingLoanEntries } from '@/modules/loans/postings'
import { postLegacyLoanNow } from '@/modules/accounting/legacyActivity'

type Tx = Prisma.TransactionClient

// Contributions live in src/modules/contributions (obligations, receipts).
export { recordContribution, type RecordContributionParams } from '@/modules/contributions'

export type RecordLoanPaymentParams = {
  loanId: string
  amount: number
  paymentDate: Date
  paymentMethod?: string | null
  receivedBy?: string | null
  comments?: string | null
  source: string
  /** Verified money already received externally; excess is held in account 2100. */
  settledExternally?: boolean
}

/** Why a loan cannot take a repayment right now, or null. */
export function repaymentBlocker(loan: { lifecycle: string; principalCents: bigint | null }): string | null {
  switch (loan.lifecycle) {
    case 'cancelled': return 'This loan was cancelled.'
    case 'charged_off': return 'This loan was written off; recording recoveries is not supported yet.'
    case 'paid_off': return isEngineLoan(loan) ? 'This loan is already paid off.' : null
    case 'approved':
    case 'agreement_signed':
      return isEngineLoan(loan) ? 'This loan has not been paid out yet. Record the disbursement first.' : null
    default: return null
  }
}

/**
 * Creates a LoanPayment and updates the loan and borrower/cosigner state.
 * Must run inside a transaction. On a loan with a stored schedule the
 * payment is split by the loan engine (fees, overdue, current, prepay;
 * Gate #1 A6), the balance is derived from the schedule, and the payment
 * posts to the ledger once the chart is approved.
 */
export async function recordLoanPayment(tx: Tx, params: RecordLoanPaymentParams) {
  await tx.$queryRaw`SELECT id FROM "Loan" WHERE "loanId" = ${params.loanId} FOR UPDATE`
  const loan = await tx.loan.findUnique({ where: { loanId: params.loanId } })
  if (!loan) throw new Error('Loan not found')
  const blocked = repaymentBlocker(loan)
  if (blocked && !(params.settledExternally && isEngineLoan(loan) && loan.lifecycle === 'paid_off')) throw new OperationError(409, blocked)
  if (isEngineLoan(loan)) return recordEngineLoanPayment(tx, loan, params)

  const newTotal = loan.totalPaid + params.amount
  const newBalance = Math.max(0, loan.balanceRemaining - params.amount)
  const paidOff = newBalance <= 0
  const paymentId = nextPublicId('LP')
  const nextDue = new Date(params.paymentDate)
  nextDue.setMonth(nextDue.getMonth() + 1)
  const monthYear = `${params.paymentDate.toLocaleString('en-US', { month: 'short' })}-${params.paymentDate.getFullYear()}`

  const createdPayment = await tx.loanPayment.create({
    data: {
      paymentId, loanId: params.loanId,
      borrowerId: loan.borrowerId, borrowerName: loan.borrowerName,
      paymentDate: params.paymentDate, amount: params.amount,
      paymentMethod: params.paymentMethod || null,
      receivedBy: params.receivedBy || null,
      comments: params.comments || null,
      monthYear, source: params.source,
    },
  })

  await tx.loan.update({
    where: { loanId: params.loanId },
    data: {
      totalPaid: newTotal, balanceRemaining: newBalance,
      status: paidOff ? 'Paid Off' : 'Active',
      ...(paidOff && loan.lifecycle === 'disbursed' ? { lifecycle: 'paid_off' } : {}),
      nextDueDate: paidOff ? null : nextDue,
      overdue: false,
    },
  })

  await recalcMemberLoanState(tx, loan.borrowerId)
  if (loan.cosignerId) {
    await recalcMemberLoanState(tx, loan.cosignerId)
  }

  // Dual-write (M5): in the ledger in the same transaction, once opening
  // balances exist. Re-read so the result shows the entry it posted to.
  const journalEntries = await postLegacyLoanNow(tx, params.loanId)
  const stored = await tx.loanPayment.findUniqueOrThrow({ where: { id: createdPayment.id } })
  return { ...stored, journalEntries }
}

async function recordEngineLoanPayment(tx: Tx, loan: { loanId: string; borrowerId: string; borrowerName: string; cosignerId: string | null }, params: RecordLoanPaymentParams) {
  try {
    fromLegacyDollars(params.amount)
  } catch (err) {
    if (err instanceof MoneyError) throw new OperationError(400, 'Amount must be in whole cents.')
    throw err
  }
  const createdPayment = await tx.loanPayment.create({
    data: {
      paymentId: nextPublicId('LP'), loanId: loan.loanId,
      borrowerId: loan.borrowerId, borrowerName: loan.borrowerName,
      paymentDate: params.paymentDate, amount: params.amount,
      paymentMethod: params.paymentMethod || null,
      receivedBy: params.receivedBy || null,
      comments: params.comments || null,
      monthYear: `${params.paymentDate.toLocaleString('en-US', { month: 'short' })}-${params.paymentDate.getFullYear()}`,
      source: params.source,
    },
  })
  await refreshLoan(tx, loan.loanId, todayIso())
  await recalcMemberLoanState(tx, loan.borrowerId)
  if (loan.cosignerId) await recalcMemberLoanState(tx, loan.cosignerId)
  const journalEntries = await postPendingLoanEntries(tx, loan.loanId)
  const stored = await tx.loanPayment.findUniqueOrThrow({ where: { id: createdPayment.id } })
  return { ...stored, journalEntries }
}
