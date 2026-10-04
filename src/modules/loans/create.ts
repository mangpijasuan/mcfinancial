import type { Prisma } from '@prisma/client'
import { POLICY, checkLoanPolicy, calcApplicationFee } from '@/lib/loanPolicy'
import { nextPublicId } from '@/lib/publicIds'
import { OperationError } from '@/lib/operationError'
import { dateOnly, isoDateOf } from '@/lib/dates'
import { fromLegacyDollars, parseDollars, subtract, toBigInt, toLegacyDollars } from '@/lib/money'
import { type AuditContext, recordAudit } from '@/modules/audit'
import type { Actors } from '@/modules/approvals/actors'
import { checkLendingCapacity } from '@/modules/treasury'
import { DEFAULT_DUE_DAY, buildSchedule } from './amortization'
import { agreementTermsHash } from './lifecycle'
import { forLoanPolicy } from '@/modules/accounting/reads'

type Db = Pick<Prisma.TransactionClient, 'member' | 'loan' | 'journalEntry' | '$queryRaw'>


export type LoanInput = {
  borrowerId: string
  cosignerId: string | null
  loanAmount: number // dollars (legacy column)
  termMonths: number
  loanDate: string // ISO
  notes: string | null
  borrowerAddress: string | null
  borrowerCity: string | null
  borrowerState: string | null
}

/** Eligibility and policy checks: before queueing for approval, and again at execution. */
export async function checkLoan(db: Db, input: LoanInput) {
  const borrower = await db.member.findUnique({
    where: { id: input.borrowerId },
    select: {
      id: true, legalName: true, status: true, monthsActive: true,
      archiveLifetime: true, contributions2026: true,
      activeAsBorrower: true, activeAsCosigner: true, eligible: true,
    },
  })
  if (!borrower) throw new OperationError(404, 'Borrower not found')
  const cosigner = input.cosignerId
    ? await db.member.findUnique({ where: { id: input.cosignerId }, select: { id: true, legalName: true } })
    : null
  if (input.cosignerId && !cosigner) throw new OperationError(404, 'Co-signer not found')

  const lastPaidLoan = await db.loan.findFirst({
    where: { borrowerId: input.borrowerId, status: 'Paid Off' },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })
  const check = checkLoanPolicy(await forLoanPolicy(db, borrower), input.loanAmount, input.termMonths, lastPaidLoan?.updatedAt)
  const writtenOff = await db.loan.count({ where: { borrowerId: input.borrowerId, lifecycle: 'charged_off' } })
  if (writtenOff > 0) check.errors.push('Member has a loan that was written off.')
  if (parseDollars(check.applicationFee) >= fromLegacyDollars(input.loanAmount)) {
    check.errors.push('The loan must be larger than the application fee, which is deducted from the payout.')
  }
  if (check.errors.length > 0) {
    throw new OperationError(422, 'Loan application does not meet policy requirements.', { violations: check.errors })
  }
  return { borrower, cosigner }
}

/**
 * Create the loan, its repayment schedule, its agreement and the member
 * flags, together. The loan starts "approved": it is paid out once every
 * party has signed the agreement.
 */
export async function createLoan(tx: Prisma.TransactionClient, input: LoanInput, actors: Actors, ctx: AuditContext) {
  const { borrower, cosigner } = await checkLoan(tx, input)
  const { borrowerId, cosignerId, loanAmount, termMonths } = input
  const loanDay = isoDateOf(new Date(input.loanDate))
  const principal = fromLegacyDollars(loanAmount)
  // Installments fall due on the 10th of each month from the month after
  // the loan date (policy); the last one absorbs any rounding remainder.
  const schedule = buildSchedule({ principal, installments: termMonths, loanDate: loanDay, dueDay: DEFAULT_DUE_DAY })
  const first = schedule.installments[0]
  const last = schedule.installments[schedule.installments.length - 1]
  const applicationFee = calcApplicationFee(loanAmount, termMonths)
  const feeCents = parseDollars(applicationFee)
  const payout = subtract(principal, feeCents)
  const amountPaidOut = toLegacyDollars(payout)
  // Gate #1 A10: within the lending capacity, checked under a lock so two
  // approvals cannot both spend the same room.
  await checkLendingCapacity(tx, payout, { lock: true })
  const monthlyDue = toLegacyDollars(first.principal)
  const loanId = nextPublicId('L')
  const agreementId = nextPublicId('AGR')

  const created = await tx.loan.create({
    data: {
      loanId, borrowerId, borrowerName: borrower.legalName,
      cosignerId, cosignerName: cosigner?.legalName || null,
      loanDate: dateOnly(loanDay), termMonths, loanAmount, monthlyDue,
      totalPaid: 0, balanceRemaining: loanAmount,
      status: 'Active', endDate: dateOnly(last.dueDate), nextDueDate: dateOnly(first.dueDate), overdue: false,
      notes: input.notes,
      lifecycle: 'approved',
      principalCents: toBigInt(principal),
      applicationFeeCents: toBigInt(feeCents),
      policyVersion: schedule.policyVersion,
      dueDay: DEFAULT_DUE_DAY,
      graceDays: POLICY.LATE_FEE_GRACE_DAYS,
      installments: {
        create: schedule.installments.map((it) => ({
          number: it.number, dueDate: dateOnly(it.dueDate), principalCents: toBigInt(it.principal), interestCents: toBigInt(it.interest),
        })),
      },
    },
  })
  const terms = {
    agreementId, loanId, lenderName: 'Millionaires Club',
    borrowerName: borrower.legalName, borrowerId,
    borrowerAddress: input.borrowerAddress,
    borrowerCity: input.borrowerCity,
    borrowerState: input.borrowerState,
    cosignerName: cosigner?.legalName || null,
    cosignerId,
    loanAmount, monthlyPayment: monthlyDue, termMonths,
    startDate: dateOnly(first.dueDate), endDate: dateOnly(last.dueDate), applicationFee, amountPaidOut,
  }
  await tx.loanAgreement.create({ data: { ...terms, termsHash: agreementTermsHash(terms), status: 'pending' } })
  await tx.member.update({
    where: { id: borrowerId },
    data: { activeAsBorrower: 1, currentLoanBalance: loanAmount, eligible: 'NO - Active Loan/Cosign' },
  })
  if (cosignerId) {
    await tx.member.update({ where: { id: cosignerId }, data: { activeAsCosigner: 1, eligible: 'NO - Active Loan/Cosign' } })
  }
  await recordAudit(tx, ctx, {
    action: 'loan.create', entityType: 'loan', entityId: loanId, after: created,
    metadata: {
      agreementId, applicationFee, amountPaidOut, policyVersion: schedule.policyVersion,
      schedule: schedule.installments.map((it) => [it.dueDate, it.principal]),
      maker: actors.maker.id, checker: actors.checker?.id ?? null,
    },
  })
  return { ...created, applicationFee, amountPaidOut, agreementId }
}
