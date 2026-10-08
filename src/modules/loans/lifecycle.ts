// Loan lifecycle after approval (docs/architecture/04 §2):
//
//   approved → agreement_signed → disbursed → paid_off | charged_off
//   approved | agreement_signed → cancelled (before disbursement only)
//
// The database refuses any other move (trigger loan_lifecycle). Every
// money event also posts to the ledger once the chart is approved
// (./postings).
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { formatUSD, fromBigInt, subtract } from '@/lib/money'
import { type IsoDate, dateOnly, isoDateOf, todayIso } from '@/lib/dates'
import { nextPublicId } from '@/lib/publicIds'
import { OperationError } from '@/lib/operationError'
import { recalcMemberLoanState } from '@/lib/memberLoanState'
import { POLICY } from '@/lib/loanPolicy'
import { type AuditContext, recordAudit } from '@/modules/audit'
import type { Actors } from '@/modules/approvals/actors'
import { isEngineLoan, loadLoan, loanState, refreshLoan } from './state'
import { postPendingLoanEntries } from './postings'
import { waiveFee } from './amortization'

type Tx = Prisma.TransactionClient

export const DISBURSEMENT_METHODS = ['Zelle', 'Bank transfer', 'Check', 'Cash'] as const

// ── Agreement ──────────────────────────────────────────────────────────

/** Bump when the agreement wording changes, so old hashes stay explainable. */
export const AGREEMENT_TEMPLATE_VERSION = 'mc-loan-agreement-2026.1'

type AgreementTerms = Pick<Prisma.LoanAgreementGetPayload<object>,
  'agreementId' | 'loanId' | 'lenderName' | 'borrowerId' | 'borrowerName' | 'borrowerAddress' | 'borrowerCity' | 'borrowerState'
  | 'cosignerId' | 'cosignerName' | 'loanAmount' | 'applicationFee' | 'amountPaidOut' | 'monthlyPayment' | 'termMonths' | 'startDate' | 'endDate'>

/**
 * SHA-256 of the agreement's terms in a fixed order. Stored when each party
 * signs, so what they signed can be proven later (and any later change to
 * the terms shows up as a different hash).
 */
export function agreementTermsHash(a: AgreementTerms): string {
  const terms = [
    AGREEMENT_TEMPLATE_VERSION, a.agreementId, a.loanId, a.lenderName,
    a.borrowerId, a.borrowerName, a.borrowerAddress ?? '', a.borrowerCity ?? '', a.borrowerState ?? '',
    a.cosignerId ?? '', a.cosignerName ?? '',
    a.loanAmount.toFixed(2), a.applicationFee.toFixed(2), (a.amountPaidOut ?? a.loanAmount - a.applicationFee).toFixed(2),
    a.monthlyPayment.toFixed(2), String(a.termMonths), isoDateOf(a.startDate), isoDateOf(a.endDate),
  ]
  return createHash('sha256').update(JSON.stringify(terms)).digest('hex')
}

/** Once every party has signed, the loan can be paid out. */
export async function onAgreementFullySigned(tx: Tx, loanId: string) {
  const loan = await tx.loan.findUnique({ where: { loanId }, select: { lifecycle: true } })
  if (loan?.lifecycle === 'approved') {
    await tx.loan.update({ where: { loanId }, data: { lifecycle: 'agreement_signed' } })
  }
}

/** Cancelling is only possible before the money is paid out. */
export function cancellationBlocker(loan: { lifecycle: string; principalCents: bigint | null }): string | null {
  if (loan.lifecycle === 'approved' || loan.lifecycle === 'agreement_signed') return null
  if (loan.lifecycle === 'disbursed' && !isEngineLoan(loan)) return null // legacy loan: the no-repayment rule applies
  return loan.lifecycle === 'disbursed'
    ? 'This loan has been paid out, so it cannot be cancelled. It can be paid off or written off.'
    : `This loan is ${loan.lifecycle.replace('_', ' ')} and cannot be cancelled.`
}

// ── Disbursement ───────────────────────────────────────────────────────

export type DisburseInput = { loanId: string; disbursedOn: IsoDate; method: string; reference: string | null }

async function engineLoan(tx: Tx, loanId: string) {
  const loan = await loadLoan(tx, loanId)
  if (!loan) throw new OperationError(404, 'Loan not found.')
  if (!isEngineLoan(loan)) {
    throw new OperationError(409, 'This loan was made before repayment schedules were stored; it is managed the old way until it is migrated.')
  }
  return loan
}

export async function checkDisbursement(tx: Tx, input: DisburseInput) {
  const loan = await engineLoan(tx, input.loanId)
  if (loan.lifecycle === 'approved') throw new OperationError(409, 'The agreement must be signed by every party before the loan is paid out.')
  if (loan.lifecycle !== 'agreement_signed') throw new OperationError(409, `This loan is already ${loan.lifecycle.replace('_', ' ')}.`)
  const agreement = await tx.loanAgreement.findUnique({ where: { loanId: input.loanId } })
  const hash = agreement && agreementTermsHash(agreement)
  if (!agreement || !agreement.borrowerSignature || !agreement.lenderSignature
    || agreement.borrowerSignedHash !== hash || agreement.lenderSignedHash !== hash
    || (agreement.cosignerId && (!agreement.cosignerSignature || agreement.cosignerSignedHash !== hash))) {
    throw new OperationError(409, 'Every party must sign the same current agreement terms before payout.')
  }
  if (input.disbursedOn > todayIso()) throw new OperationError(400, 'The payout date cannot be in the future.')
  return loan
}

/**
 * Record that the money was paid out: the borrower receives the principal
 * minus the application fee (Gate #1 A8) and repays the full principal.
 */
export async function disburseLoan(tx: Tx, input: DisburseInput, actors: Actors, ctx: AuditContext) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('treasury.lending_capacity'))`
  const loan = await checkDisbursement(tx, input)
  const principal = fromBigInt(loan.principalCents!)
  const paidOut = subtract(principal, fromBigInt(loan.applicationFeeCents ?? BigInt(0)))
  const moved = await tx.loan.updateMany({
    where: { loanId: loan.loanId, lifecycle: 'agreement_signed' },
    data: {
      lifecycle: 'disbursed',
      disbursedOn: dateOnly(input.disbursedOn),
      disbursedAmountCents: BigInt(paidOut),
      disbursementMethod: input.method,
      disbursementReference: input.reference,
      disbursedBy: actors.maker.id,
    },
  })
  if (moved.count === 0) throw new OperationError(409, 'This loan was paid out by someone else a moment ago.')
  const { after } = await refreshLoan(tx, loan.loanId, todayIso())
  const posted = await postPendingLoanEntries(tx, loan.loanId)
  await recordAudit(tx, ctx, {
    action: 'loan.disburse', entityType: 'loan', entityId: loan.loanId,
    before: { lifecycle: loan.lifecycle },
    after: { ...after, disbursedOn: input.disbursedOn, paidOutCents: paidOut, method: input.method, reference: input.reference },
    metadata: { journalEntries: posted, maker: actors.maker.id, checker: actors.checker?.id ?? null },
  })
  return { loanId: loan.loanId, paidOutCents: paidOut, journalEntries: posted }
}

// ── Late fees ──────────────────────────────────────────────────────────

/** Late fees are only charged once counsel confirms the state's limits (Gate #1 A7). */
export function lateFeesEnabled(): boolean {
  return process.env.LATE_FEES_ENABLED === 'true'
}

export const LATE_FEE_CENTS = Math.round(POLICY.LATE_FEE * 100)

export type WaiveInput = { feeId: string; reason: string; waivedOn: IsoDate }

export async function checkWaiver(tx: Tx, input: WaiveInput) {
  const fee = await tx.loanFee.findUnique({ where: { feeId: input.feeId } })
  if (!fee) throw new OperationError(404, 'Fee not found.')
  if (fee.status !== 'charged') throw new OperationError(409, 'This fee has already been waived.')
  const loan = await engineLoan(tx, fee.loanId)
  if (loan.lifecycle !== 'disbursed') throw new OperationError(409, `This loan is ${loan.lifecycle.replace('_', ' ')}; its fees can no longer be waived.`)
  if (!input.reason.trim()) throw new OperationError(400, 'Give a reason for the waiver.')
  const state = loanState(loan, todayIso())
  try {
    waiveFee(state.position, fromBigInt(fee.amountCents))
  } catch {
    throw new OperationError(409, 'This fee has already been paid, so it cannot be waived. Refund it instead.')
  }
  return { fee, loan }
}

export async function waiveLateFee(tx: Tx, input: WaiveInput, actors: Actors, ctx: AuditContext) {
  const { fee } = await checkWaiver(tx, input)
  const waived = await tx.loanFee.update({
    where: { id: fee.id },
    data: { status: 'waived', waivedOn: dateOnly(input.waivedOn), waivedAt: new Date(), waivedBy: actors.maker.id, waiverReason: input.reason.trim() },
  })
  const { after } = await refreshLoan(tx, fee.loanId, todayIso())
  const posted = await postPendingLoanEntries(tx, fee.loanId)
  await recordAudit(tx, ctx, {
    action: 'loan.fee.waive', entityType: 'loan_fee', entityId: fee.feeId, before: fee, after: waived,
    metadata: { loanId: fee.loanId, loanAfter: after, reason: input.reason.trim(), journalEntries: posted, maker: actors.maker.id, checker: actors.checker?.id ?? null },
  })
  return { feeId: fee.feeId, journalEntries: posted }
}

/** Charge the late fees that are due as of a date (servicing job). At most one per installment. */
export async function chargeLateFees(tx: Tx, loanId: string, installments: number[], asOf: IsoDate) {
  const created: string[] = []
  for (const number of installments) {
    const feeId = nextPublicId('FEE')
    const row = await tx.loanFee.createMany({
      data: [{ feeId, loanId, installmentNumber: number, kind: 'late_fee', amountCents: BigInt(LATE_FEE_CENTS), assessedOn: dateOnly(asOf) }],
      skipDuplicates: true, // the unique (loan, installment, kind) makes a second run a no-op
    })
    if (row.count === 1) created.push(feeId)
  }
  return created
}

// ── Write-off ──────────────────────────────────────────────────────────

export type WriteOffInput = { loanId: string; reason: string; chargedOffOn: IsoDate }

export async function checkWriteOff(tx: Tx, input: WriteOffInput) {
  const loan = await engineLoan(tx, input.loanId)
  if (loan.lifecycle !== 'disbursed') throw new OperationError(409, `This loan is ${loan.lifecycle.replace('_', ' ')}; only a loan being repaid can be written off.`)
  if (!input.reason.trim()) throw new OperationError(400, 'Give a reason for the write-off.')
  const state = loanState(loan, todayIso())
  if (state.delinquency.status !== 'delinquent') {
    throw new OperationError(409, 'Only a delinquent loan can be written off (after the collection policy has been followed).')
  }
  return { loan, state }
}

export async function writeOffLoan(tx: Tx, input: WriteOffInput, actors: Actors, ctx: AuditContext) {
  const { loan, state } = await checkWriteOff(tx, input)
  await tx.loan.update({
    where: { loanId: loan.loanId },
    data: {
      lifecycle: 'charged_off', status: 'Charged Off', chargedOffOn: dateOnly(input.chargedOffOn),
      delinquency: null, daysPastDue: 0, overdue: false, nextDueDate: null,
    },
  })
  await recalcMemberLoanState(tx, loan.borrowerId)
  if (loan.cosignerId) await recalcMemberLoanState(tx, loan.cosignerId)
  const posted = await postPendingLoanEntries(tx, loan.loanId)
  await recordAudit(tx, ctx, {
    action: 'loan.write_off', entityType: 'loan', entityId: loan.loanId,
    before: { lifecycle: loan.lifecycle, delinquency: loan.delinquency },
    after: { lifecycle: 'charged_off', principalWrittenOffCents: state.outstandingPrincipal, feesWrittenOffCents: state.feesOutstanding },
    metadata: { reason: input.reason.trim(), journalEntries: posted, maker: actors.maker.id, checker: actors.checker?.id ?? null },
  })
  return { loanId: loan.loanId, writtenOff: formatUSD(state.payoff), journalEntries: posted }
}
