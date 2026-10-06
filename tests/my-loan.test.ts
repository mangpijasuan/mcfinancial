// "My loan" in the member portal (GET /api/portal/loans): a member's own
// loans with the same figures the staff loan page shows, and the loans
// they co-sign. Access by role is in the authorization matrix.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signInAs, signInAsMember } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createLoan, createMember, recordBankBalance } from './helpers/factories'
import { callRoute } from './helpers/routes'

// Members of their own, eligible to borrow (the base fixtures give the test members a loan already).
const BORROWER = 'MC-MYLOAN'
const COSIGNER = 'MC-MYCOSIGN'

async function setToday(date: string) {
  vi.setSystemTime(new Date(`${date}T18:00:00Z`))
  await prisma.staffSession.updateMany({ data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) } })
}

async function engineLoan() {
  signInAs('admin')
  const res = await callRoute('loans', 'POST', { body: { borrowerId: BORROWER, cosignerId: COSIGNER, loanAmount: '1000', termMonths: 3, loanDate: '2026-01-15' } })
  expect(res.status).toBe(201)
  return res.json.loanId as string
}

async function signAndPayOut(loanId: string) {
  const { agreementId } = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
  signInAs('treasurer')
  expect((await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { signerType: 'lender', signatureText: 'Tess Treasurer' } })).status).toBe(200)
  signInAsMember(BORROWER)
  expect((await callRoute('agreements/[id]', 'PATCH', {
    params: { id: agreementId }, body: { signerType: 'borrower', signatureText: 'Test Member', borrowerAddress: '1 Main St', borrowerCity: 'Tulsa', borrowerState: 'OK' },
  })).status).toBe(200)
  signInAsMember(COSIGNER)
  expect((await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { signerType: 'cosigner', signatureText: 'Co Signer' } })).status).toBe(200)
  signInAs('treasurer')
  expect((await callRoute('loans/[id]/disburse', 'POST', { params: { id: loanId }, body: { disbursedOn: '2026-01-15', method: 'Zelle', reference: 'ZL-1' } })).status).toBe(200)
}

const myLoans = async (memberId = BORROWER) => {
  signInAsMember(memberId)
  const res = await callRoute('portal/loans', 'GET')
  expect(res.status).toBe(200)
  return res.json as { loans: any[]; cosigned: any[] }
}

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  await createMember(BORROWER, { monthsActive: 24, archiveLifetime: 2000, contributions2026: 180 })
  await createMember(COSIGNER, { monthsActive: 24, archiveLifetime: 2000 })
  vi.useFakeTimers({ toFake: ['Date'] })
  await setToday('2026-01-15')
  await recordBankBalance(50_000_00, '2026-01-15')
})
afterEach(() => vi.useRealTimers())

describe('a loan on the loan engine', () => {
  it('shows its stage, schedule, payments and payoff, the same as the staff loan page', async () => {
    const loanId = await engineLoan()
    let [loan] = (await myLoans()).loans
    expect(loan).toMatchObject({ loanId, stage: 'awaiting_payout', amountCents: 1000_00, paidCents: 0, nextDue: null, overdue: null, cosigner: expect.any(String) })
    expect(loan.schedule).toHaveLength(3)

    await signAndPayOut(loanId)
    signInAs('finance')
    expect((await callRoute('loan-payments', 'POST', { body: { loanId, amount: loan.schedule[0].amount / 100, paymentDate: '2026-02-15', paymentMethod: 'Cash' } })).status).toBe(201)

    // Two months later the second installment is late.
    await setToday('2026-04-01')
    ;[loan] = (await myLoans()).loans
    signInAs('treasurer')
    const staff = (await callRoute('loans/[id]', 'GET', { params: { id: loanId } })).json.servicing
    expect(loan).toMatchObject({
      stage: 'repaying',
      paidCents: loan.schedule[0].amount,
      outstandingCents: staff.outstandingPrincipalCents,
      payoffCents: staff.payoffCents,
      feesOutstandingCents: staff.feesOutstandingCents,
      schedule: staff.installments,
      nextDue: { date: staff.installments[1].dueDate, amountCents: staff.installments[1].remaining },
      overdue: { amountCents: staff.delinquency.overdueCents, daysPastDue: expect.any(Number) },
    })
    expect(loan.overdue.amountCents).toBeGreaterThan(0)
    expect(loan.payments).toEqual([{ paymentId: expect.any(String), date: '2026-02-15', amountCents: loan.schedule[0].amount, method: 'Cash' }])

    // The co-signer sees it among the loans they answer for, late.
    const cosigner = await myLoans(COSIGNER)
    expect(cosigner.loans).toEqual([])
    expect(cosigner.cosigned).toEqual([{ loanId, borrowerName: expect.any(String), stage: 'repaying', outstandingCents: staff.outstandingPrincipalCents, overdue: true }])

    // Paid in full: paid off, nothing due, and gone from the co-signer's list.
    signInAs('finance')
    expect((await callRoute('loan-payments', 'POST', { body: { loanId, amount: staff.payoffCents / 100, paymentDate: '2026-04-01', paymentMethod: 'Cash' } })).status).toBe(201)
    ;[loan] = (await myLoans()).loans
    expect(loan).toMatchObject({ stage: 'paid_off', outstandingCents: 0, payoffCents: 0, nextDue: null, overdue: null })
    expect((await myLoans(COSIGNER)).cosigned).toEqual([])
  })
})

describe('loans made before the loan engine', () => {
  it('show the figures kept on the loan, current first, and leave out cancelled ones', async () => {
    await createLoan('L-OLD', BORROWER, { loanAmount: 500, totalPaid: 200, balanceRemaining: 300, monthlyDue: 100, nextDueDate: new Date('2026-02-01'), overdue: true, cosignerName: 'A Cosigner', loanDate: new Date('2025-06-01') })
    await createLoan('L-DONE', BORROWER, { status: 'Paid Off', lifecycle: 'paid_off', balanceRemaining: 0, totalPaid: 1000, loanDate: new Date('2026-01-02') })
    await createLoan('L-OFF', BORROWER, { lifecycle: 'charged_off', loanDate: new Date('2025-01-01') })
    await createLoan('L-GONE', BORROWER, { lifecycle: 'cancelled', status: 'Cancelled' })
    await createLoan('L-LAST', BORROWER, { balanceRemaining: 50, monthlyDue: 100, nextDueDate: new Date('2026-02-01'), loanDate: new Date('2025-03-01') })
    await prisma.loanPayment.create({ data: { paymentId: 'LP-OLD-1', loanId: 'L-OLD', borrowerId: BORROWER, borrowerName: 'x', paymentDate: new Date('2025-07-01'), amount: 200 } })

    const { loans, cosigned } = await myLoans()
    expect(cosigned).toEqual([])
    expect(loans.map((l) => [l.loanId, l.stage])).toEqual([['L-OLD', 'repaying'], ['L-LAST', 'repaying'], ['L-DONE', 'paid_off'], ['L-OFF', 'written_off']])
    expect(loans[0]).toMatchObject({
      amountCents: 500_00, paidCents: 200_00, outstandingCents: 300_00, payoffCents: null, feesOutstandingCents: 0, monthlyDueCents: 100_00,
      nextDue: { date: '2026-02-01', amountCents: 100_00 }, overdue: { amountCents: null, daysPastDue: null }, schedule: null, cosigner: 'A Cosigner',
      payments: [{ paymentId: 'LP-OLD-1', date: '2025-07-01', amountCents: 200_00, method: null }],
    })
    // The last payment is only what is left, never more.
    expect(loans[1].nextDue).toEqual({ date: '2026-02-01', amountCents: 50_00 })
    expect(loans[2]).toMatchObject({ nextDue: null, overdue: null })
  })

  it('a co-signed older loan shows its kept balance and late flag', async () => {
    await createLoan('L-CO', COSIGNER, { cosignerId: BORROWER, balanceRemaining: 400, overdue: false })
    await createLoan('L-CO-DONE', COSIGNER, { cosignerId: BORROWER, status: 'Paid Off', balanceRemaining: 0 })
    expect((await myLoans()).cosigned).toEqual([{ loanId: 'L-CO', borrowerName: `Test Member ${COSIGNER}`, stage: 'repaying', outstandingCents: 400_00, overdue: false }])
  })
})

describe('a member without loans', () => {
  it('sees none', async () => {
    expect(await myLoans()).toEqual({ loans: [], cosigned: [] })
  })
})
