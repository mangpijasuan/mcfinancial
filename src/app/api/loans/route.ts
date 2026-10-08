import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/modules/auth'
import { cents, formatUSD, parseDollars, subtract, toLegacyDollars } from '@/lib/money'
import { calcApplicationFee } from '@/lib/loanPolicy'
import { operationErrorResponse } from '@/lib/operationError'
import { submitOrExecute } from '@/modules/approvals'
import { checkLoan, type LoanInput } from '@/modules/loans/create'
import { checkLendingCapacity } from '@/modules/treasury'
import { badRequest, parseDate, readJsonObject, requiredString } from '@/lib/http'
import { withLoanBalances } from '@/modules/accounting/reads'

export async function GET(req: NextRequest) {
  const auth = await requirePermission('loans.read')
  if (auth.error) return auth.error

  const s = new URL(req.url).searchParams
  const search = s.get('search') || ''
  const status = s.get('status') || ''

  const where: any = {}
  if (search) where.OR = [
    { borrowerName: { contains: search, mode: 'insensitive' } },
    { borrowerId:   { contains: search, mode: 'insensitive' } },
    { loanId:       { contains: search, mode: 'insensitive' } },
  ]
  if (status) where.status = status

  const loans = await prisma.loan.findMany({
    where, orderBy: [{ overdue: 'desc' }, { loanDate: 'desc' }],
    include: {
      payments:  { orderBy: { paymentDate: 'desc' }, take: 3 },
      agreement: { select: { agreementId: true, status: true } },
    },
  })
  return NextResponse.json(await withLoanBalances(prisma, loans))
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('loans.create')
  if (auth.error) return auth.error

  const body = await readJsonObject(req)
  if (!body) return badRequest('Invalid request body.')
  const borrowerId = requiredString(body.borrowerId)
  if (!borrowerId) return badRequest('A borrower must be selected.')
  const cosignerId = requiredString(body.cosignerId)
  if (cosignerId === borrowerId) return badRequest('The borrower cannot co-sign their own loan.')
  let amountCents: number
  try {
    amountCents = parseDollars(typeof body.loanAmount === 'number' ? body.loanAmount : String(body.loanAmount ?? ''))
  } catch {
    return badRequest('Loan amount must be a dollar amount with at most two decimals.')
  }
  if (amountCents <= 0) return badRequest('Loan amount must be greater than 0.')
  const termMonths = Number(body.termMonths)
  if (!Number.isInteger(termMonths) || termMonths <= 0) return badRequest('Term must be a whole number of months.')
  const loanDate = parseDate(body.loanDate)
  if (!loanDate) return badRequest('A valid loan date is required.')

  const input: LoanInput = {
    borrowerId,
    cosignerId,
    loanAmount: toLegacyDollars(cents(amountCents)),
    termMonths,
    loanDate: loanDate.toISOString(),
    notes: body.notes || null,
    borrowerAddress: body.borrowerAddress || null,
    borrowerCity: body.borrowerCity || null,
    borrowerState: body.borrowerState || null,
  }

  try {
    // Policy is checked now (so an ineligible loan is never queued) and
    // again when it runs.
    const { borrower } = await checkLoan(prisma, input)
    // So is the lending capacity (Gate #1 A10): the payout is the amount
    // less the application fee.
    await checkLendingCapacity(prisma, subtract(cents(amountCents), parseDollars(calcApplicationFee(input.loanAmount, termMonths))))
    const out = await submitOrExecute({
      action: 'loan.create',
      principal: auth.principal,
      req,
      amountCents,
      entityType: 'member',
      entityId: borrowerId,
      summary: `Loan of ${formatUSD(cents(amountCents))} over ${termMonths} months to ${borrower.legalName} (${borrowerId})${cosignerId ? `, co-signed by ${cosignerId}` : ''}`,
      payload: input,
    })
    if ('queued' in out) return NextResponse.json({ approvalRequest: out.queued }, { status: 202 })
    return NextResponse.json(out.result, { status: 201 })
  } catch (err) {
    const res = operationErrorResponse(err)
    if (res) return res
    throw err
  }
}
