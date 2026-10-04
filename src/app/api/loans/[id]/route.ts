import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { auditContext, recordAudit } from '@/modules/audit'
import { badRequest, notFound, parseDate, readJsonObject } from '@/lib/http'
import { fromBigInt } from '@/lib/money'
import { todayIso } from '@/lib/dates'
import { isEngineLoan, loadLoan, loanState } from '@/modules/loans/state'
import { cancellationBlocker, lateFeesEnabled } from '@/modules/loans/lifecycle'
import { repaymentBlocker } from '@/lib/paymentActions'
import { withLoanBalances } from '@/modules/accounting/reads'

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('loans.read')
  if (auth.error) return auth.error

  const { id } = await params
  const loan = await prisma.loan.findUnique({
    where: { loanId: id },
    include: {
      payments: { orderBy: { paymentDate: 'desc' } },
      borrower: { select: { id: true, legalName: true, email: true, status: true } },
    },
  })
  if (!loan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [shown] = await withLoanBalances(prisma, [loan])
  return NextResponse.json({ ...shown, servicing: await servicingView(id) })
}

/** Schedule, fees and what can happen next, for loans on the loan engine (cents). */
async function servicingView(loanId: string) {
  const loan = await loadLoan(prisma, loanId)
  if (!loan || !isEngineLoan(loan)) return null
  const agreement = await prisma.loanAgreement.findUnique({ where: { loanId }, select: { agreementId: true, status: true } })
  const state = loanState(loan, todayIso())
  const splits = Object.fromEntries(state.paymentSplits)
  return {
    lifecycle: loan.lifecycle,
    policyVersion: loan.policyVersion,
    principalCents: fromBigInt(loan.principalCents!),
    applicationFeeCents: fromBigInt(loan.applicationFeeCents ?? BigInt(0)),
    disbursement: loan.disbursedOn ? {
      on: loan.disbursedOn, amountCents: fromBigInt(loan.disbursedAmountCents!), method: loan.disbursementMethod,
      reference: loan.disbursementReference, journalEntry: loan.disbursementEntry,
    } : null,
    installments: state.installments,
    fees: loan.fees.map((f) => ({
      feeId: f.feeId, installmentNumber: f.installmentNumber, kind: f.kind, amountCents: fromBigInt(f.amountCents),
      assessedOn: f.assessedOn, status: f.status, waivedOn: f.waivedOn, waiverReason: f.waiverReason, journalEntry: f.journalEntry,
    })),
    payments: loan.payments.map((p) => ({ paymentId: p.paymentId, journalEntry: p.journalEntry, split: splits[p.paymentId] ?? null })),
    outstandingPrincipalCents: state.outstandingPrincipal,
    feesOutstandingCents: state.feesOutstanding,
    payoffCents: state.payoff,
    unappliedCents: state.unapplied,
    delinquency: { status: loan.delinquency, daysPastDue: loan.daysPastDue, servicedOn: loan.servicedOn, overdueCents: state.delinquency.overdueAmount },
    chargedOffOn: loan.chargedOffOn,
    chargeOffEntry: loan.chargeOffEntry,
    agreement,
    lateFeesEnabled: lateFeesEnabled(),
    can: {
      disburse: loan.lifecycle === 'agreement_signed',
      repay: repaymentBlocker(loan) === null && loan.lifecycle === 'disbursed',
      writeOff: loan.lifecycle === 'disbursed' && state.delinquency.status === 'delinquent',
      cancel: cancellationBlocker(loan) === null,
    },
  }
}

// Status changes only through payments, cancellation and write-off, so it
// always agrees with the loan's lifecycle.
const EDITABLE_LOAN_FIELDS = ['notes', 'overdue'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('loans.update')
  if (auth.error) return auth.error

  const { id } = await params
  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const existing = await prisma.loan.findUnique({ where: { loanId: id } })
  if (!existing) return notFound()

  // On the loan engine, status, overdue and the next due date follow from
  // the schedule and the servicing job; they are never set by hand (F-6, F-12).
  if (body.status !== undefined) {
    return NextResponse.json({ error: 'A loan’s status changes only by recording payments, cancelling or writing it off.' }, { status: 409 })
  }
  if (isEngineLoan(existing) && (body.overdue !== undefined || body.nextDueDate !== undefined)) {
    return NextResponse.json({ error: 'Overdue and due dates of this loan are calculated from its schedule. Only notes can be edited.' }, { status: 409 })
  }
  const data: Record<string, unknown> = {}
  for (const field of EDITABLE_LOAN_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field]
  }
  if (data.overdue !== undefined && typeof data.overdue !== 'boolean') return badRequest('overdue must be true or false.')
  if (body.nextDueDate !== undefined) {
    data.nextDueDate = body.nextDueDate ? parseDate(body.nextDueDate) : null
    if (body.nextDueDate && !data.nextDueDate) return badRequest('Invalid next due date.')
  }

  const loan = await prisma.$transaction(async (tx) => {
    const updated = await tx.loan.update({ where: { loanId: id }, data })
    await recordAudit(tx, auditContext(req, auth.principal), {
      action: 'loan.update', entityType: 'loan', entityId: id, before: existing, after: updated,
    })
    return updated
  })
  return NextResponse.json(loan)
}
