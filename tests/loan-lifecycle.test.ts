// Loans on the loan engine, end to end (docs/architecture/04 §2): stored
// schedule → signatures → payout with the fee netted (A8) → repayments
// split by the engine (A6) → daily servicing (delinquency; late fees only
// when switched on, A7) → waiver / write-off with checkers (D-06), and the
// ledger postings for each once the chart is approved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signInAs, signInAsMember, staffId } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createMember, recordBankBalance } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { accountBalance, approveAccounts, checkInvariants } from '@/modules/accounting/ledger'
import { agreementTermsHash } from '@/modules/loans/lifecycle'
import { serviceLoans } from '@/modules/loans/servicing'
import { postPendingLoanEntries, receiptAccount } from '@/modules/loans/postings'
import { refreshLoan } from '@/modules/loans/state'

const BORROWER = 'MC-BORROW'
const enforce = (on: boolean) => { process.env.MAKER_CHECKER_ENFORCED = on ? 'true' : '' }
/**
 * The club's date is taken from the clock; tests pin it (only Date is
 * faked). Staff sessions are refreshed so the idle timeout does not end
 * them when the clock jumps ahead.
 */
async function setToday(date: string) {
  vi.setSystemTime(new Date(`${date}T18:00:00Z`))
  await prisma.staffSession.updateMany({ data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) } })
}

const approve = (id: string) => callRoute('approvals/[id]/approve', 'POST', { params: { id }, body: {} })

async function newLoan(amount = '1000', termMonths = 3, loanDate = '2026-01-15', cosignerId = 'MC-COSIGN') {
  signInAs('admin')
  const res = await callRoute('loans', 'POST', { body: { borrowerId: BORROWER, cosignerId, loanAmount: amount, termMonths, loanDate } })
  expect(res.status).toBe(201)
  return res.json.loanId as string
}

async function signAll(loanId: string) {
  const { agreementId } = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
  signInAsMember(BORROWER)
  const res = await callRoute('agreements/[id]', 'PATCH', {
    params: { id: agreementId }, body: { signerType: 'borrower', signatureText: 'Test Member', borrowerAddress: '1 Main St', borrowerCity: 'Tulsa', borrowerState: 'OK' },
  })
  expect(res.status).toBe(200)
  signInAsMember('MC-COSIGN')
  expect((await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { signerType: 'cosigner', signatureText: 'Co Signer' } })).status).toBe(200)
  signInAs('treasurer')
  expect((await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { signerType: 'lender', signatureText: 'Tess Treasurer' } })).status).toBe(200)
  return agreementId
}

async function disburse(loanId: string, disbursedOn = '2026-01-15') {
  signInAs('treasurer')
  return callRoute('loans/[id]/disburse', 'POST', { params: { id: loanId }, body: { disbursedOn, method: 'Zelle', reference: 'ZL-778' } })
}

async function pay(loanId: string, amount: string, paymentDate: string, paymentMethod = 'Cash') {
  signInAs('finance')
  return callRoute('loan-payments', 'POST', { body: { loanId, amount, paymentDate, paymentMethod } })
}

async function paidOutLoan() {
  const loanId = await newLoan()
  await signAll(loanId)
  expect((await disburse(loanId)).status).toBe(200)
  return loanId
}

async function approveChart() {
  const codes = (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code)
  await prisma.$transaction((tx) => approveAccounts(tx, { codes, approvedBy: staffId('treasurer'), note: 'test chart approval' }))
}

const loan = (loanId: string) => prisma.loan.findUniqueOrThrow({ where: { loanId } })
const linesOf = async (entryNumber: string | null) => {
  const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { entryNumber: entryNumber! }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
  return entry.lines.map((l) => [l.accountCode, Number(l.debitCents), Number(l.creditCents)])
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-15T18:00:00Z'))
  await resetDatabase()
  await createBaseFixtures()
  await createMember(BORROWER, { monthsActive: 24, archiveLifetime: 2000, contributions2026: 180 })
  // Plenty of room to lend (Gate #1 A10); tests/treasury.test.ts covers the limits.
  await createMember('MC-COSIGN', { monthsActive: 24 })
  await recordBankBalance(1_000_000_00)
})
afterEach(() => {
  vi.useRealTimers()
  enforce(false)
  delete process.env.LATE_FEES_ENABLED
})

describe('a new loan', () => {
  it('stores its schedule in cents and starts "approved"', async () => {
    const loanId = await newLoan()
    const row = await prisma.loan.findUniqueOrThrow({ where: { loanId }, include: { installments: { orderBy: { number: 'asc' } } } })
    expect(row).toMatchObject({ lifecycle: 'approved', principalCents: BigInt(100000), applicationFeeCents: BigInt(3000), policyVersion: 'loan-policy-2026.1', monthlyDue: 333.33 })
    expect(row.installments.map((i) => [i.dueDate.toISOString().slice(0, 10), Number(i.principalCents)])).toEqual([
      ['2026-02-10', 33333], ['2026-03-10', 33333], ['2026-04-10', 33334],
    ])
    expect(row.nextDueDate?.toISOString().slice(0, 10)).toBe('2026-02-10')
    expect(row.endDate?.toISOString().slice(0, 10)).toBe('2026-04-10')

    const agreement = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
    expect(agreement).toMatchObject({ applicationFee: 30, amountPaidOut: 970, termsHash: agreementTermsHash(agreement) })
    expect(agreement.termsHash).toMatch(/^[0-9a-f]{64}$/)

    // The detail view (BigInt columns and all) serialises.
    const view = await callRoute('loans/[id]', 'GET', { params: { id: loanId } })
    expect(view.status).toBe(200)
    expect(view.json.principalCents).toBe('100000')
    expect(view.json.servicing).toMatchObject({ lifecycle: 'approved', payoffCents: 100000, can: { disburse: false, repay: false, cancel: true } })
    expect(view.json.servicing.installments).toHaveLength(3)
  })

  it('must be larger than the application fee, which is netted from the payout', async () => {
    signInAs('admin')
    const res = await callRoute('loans', 'POST', { body: { borrowerId: BORROWER, cosignerId: 'MC-COSIGN', loanAmount: '30', termMonths: 3, loanDate: '2026-01-15' } })
    expect(res.status).toBe(422)
    expect(res.json.violations).toContain('The loan must be larger than the application fee, which is deducted from the payout.')
  })
})

describe('signatures and payout', () => {
  it('takes no repayment and no payout before everyone has signed', async () => {
    const loanId = await newLoan()
    expect((await pay(loanId, '100', '2026-01-20')).json.error).toMatch(/not been paid out yet/)
    expect((await disburse(loanId)).json.error).toMatch(/signed by every party/)
    signInAsMember(BORROWER)
    expect((await callRoute('portal/payments/checkout', 'POST', { body: { type: 'loan_payment', loanId, method: 'zelle', amount: 100 } })).status).toBe(409)
  })

  it('records the hash of the terms each party signed', async () => {
    const loanId = await newLoan()
    const agreementId = await signAll(loanId)
    const a = await prisma.loanAgreement.findUniqueOrThrow({ where: { agreementId } })
    expect(a.status).toBe('fully_signed')
    // All parties sign the same frozen terms.
    expect(a.lenderSignedHash).toBe(a.termsHash)
    expect(a.borrowerSignedHash).toBe(agreementTermsHash(a))
    expect(a.borrowerSignedHash).toBe(a.termsHash)
    expect((await loan(loanId)).lifecycle).toBe('agreement_signed')
  })

  it('pays out the principal less the fee, and posts once the chart is approved', async () => {
    const loanId = await newLoan()
    await signAll(loanId)
    const marker = await auditMarker()
    const res = await disburse(loanId)
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ paidOutCents: 97000, journalEntries: [] })
    expect(await loan(loanId)).toMatchObject({
      lifecycle: 'disbursed', disbursedAmountCents: BigInt(97000), disbursementMethod: 'Zelle', disbursementEntry: null, delinquency: 'current',
    })
    expect((await disburse(loanId)).status).toBe(409)
    const audit = (await auditEntriesSince(marker)).find((e) => e.action === 'loan.disburse')!
    expect(audit.metadata).toMatchObject({ maker: staffId('treasurer'), checker: null })

    // A repayment while the chart is still proposed: recorded, not posted.
    await setToday('2026-02-05')
    const payment = await pay(loanId, '400', '2026-02-05')
    expect(payment.status).toBe(201)
    expect(payment.json.journalEntries).toEqual([])
    expect(await loan(loanId)).toMatchObject({ totalPaid: 400, balanceRemaining: 600 })
    expect((await loan(loanId)).nextDueDate?.toISOString().slice(0, 10)).toBe('2026-03-10')

    // Approving the chart: the next servicing run posts the backlog, once.
    await approveChart()
    const run = await serviceLoans({ asOf: '2026-02-06' })
    expect(run.journalEntries).toHaveLength(2)
    const after = await loan(loanId)
    expect(await linesOf(after.disbursementEntry)).toEqual([['1100', 100000, 0], ['1000', 0, 97000], ['4000', 0, 3000]])
    const { journalEntry } = await prisma.loanPayment.findFirstOrThrow({ where: { loanId } })
    expect(await linesOf(journalEntry)).toEqual([['1030', 40000, 0], ['1100', 0, 40000]])
    expect((await serviceLoans({ asOf: '2026-02-06' })).journalEntries).toEqual([])

    // From now on each repayment posts straight away.
    const next = await pay(loanId, '100', '2026-02-06', 'Zelle')
    expect(next.json.journalEntries).toHaveLength(1)
    expect(await linesOf(next.json.journalEntries[0])).toEqual([['1020', 10000, 0], ['1100', 0, 10000]])
    expect((await accountBalance(prisma, '1100')).balance).toBe(50000)
    expect(await checkInvariants(prisma)).toEqual({ ok: true, problems: [] })
  })

  it('with maker/checker on, the Board approves the payout', async () => {
    const loanId = await newLoan()
    await signAll(loanId)
    enforce(true)
    const queued = await disburse(loanId)
    expect(queued.status).toBe(202)
    expect(queued.json.approvalRequest).toMatchObject({ action: 'loan.disburse', amountCents: 100000 })
    const { id } = queued.json.approvalRequest
    expect((await approve(id)).json.code).toBe('maker_is_checker')
    signInAs('loan_officer')
    expect((await approve(id)).status).toBe(403)
    signInAs('board')
    expect((await approve(id)).json).toMatchObject({ status: 'approved', resultRef: loanId })
    expect((await loan(loanId)).lifecycle).toBe('disbursed')
  })

  it('refuses overpayments by staff and marks the loan paid off at zero, freeing the co-signer', async () => {
      const loanId = await newLoan('1000', 3, '2026-01-15', 'MC-COSIGN')
    expect((await prisma.member.findUniqueOrThrow({ where: { id: 'MC-COSIGN' } })).activeAsCosigner).toBe(1)
    const { agreementId } = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
    await signAll(loanId)
    signInAsMember('MC-COSIGN')
    await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { signerType: 'cosigner', signatureText: 'Co Signer' } })
    expect((await disburse(loanId)).status).toBe(200)
    expect((await pay(loanId, '1000.01', '2026-01-20')).status).toBe(422)
    expect((await pay(loanId, '10.005', '2026-01-20')).status).toBe(400)
    expect((await pay(loanId, '1000', '2026-01-20')).status).toBe(201)
    expect(await loan(loanId)).toMatchObject({ lifecycle: 'paid_off', status: 'Paid Off', balanceRemaining: 0, nextDueDate: null, delinquency: null })
    expect((await prisma.member.findUniqueOrThrow({ where: { id: BORROWER } })).activeAsBorrower).toBe(0)
    expect((await prisma.member.findUniqueOrThrow({ where: { id: 'MC-COSIGN' } })).activeAsCosigner).toBe(0)
    expect((await pay(loanId, '1', '2026-01-21')).status).toBe(409)
  })
})

describe('daily servicing', () => {
  it('computes delinquency from the schedule; it cannot be set by hand', async () => {
    const loanId = await paidOutLoan()
    const marker = await auditMarker()

    expect((await serviceLoans({ asOf: '2026-02-25' })).changes).toEqual([])
    expect(await loan(loanId)).toMatchObject({ delinquency: 'current', daysPastDue: 15, overdue: false })

    const run = await serviceLoans({ asOf: '2026-02-26' })
    expect(run.changes).toEqual([{ loanId, from: 'current', to: 'delinquent' }])
    expect(run.delinquent).toEqual([expect.objectContaining({ loanId, daysPastDue: 16, overdue: '$333.33' })])
    // Late fees are switched off (A7): reported, not charged.
    expect(run.lateFeesEnabled).toBe(false)
    expect(run.feesNotCharged).toEqual([{ loanId, installments: [1], amount: '$5.00' }])
    expect(await prisma.loanFee.count()).toBe(0)
    expect(await loan(loanId)).toMatchObject({ delinquency: 'delinquent', overdue: true })
    expect((await auditEntriesSince(marker)).map((e) => e.action)).toContain('loan.delinquency.change')

    // A second run the same day changes nothing.
    expect((await serviceLoans({ asOf: '2026-02-26' })).changes).toEqual([])
    // A dry run saves nothing.
    expect((await serviceLoans({ asOf: '2026-03-30', dryRun: true })).dryRun).toBe(true)
    expect((await loan(loanId)).daysPastDue).toBe(16)

    signInAs('treasurer')
    expect((await callRoute('loans/[id]', 'PATCH', { params: { id: loanId }, body: { overdue: false } })).status).toBe(409)
    expect((await callRoute('loans/[id]', 'PATCH', { params: { id: loanId }, body: { status: 'Paid Off' } })).status).toBe(409)
    expect((await callRoute('loans/[id]', 'PATCH', { params: { id: loanId }, body: { notes: 'called the borrower' } })).status).toBe(200)

    // Paying the arrears makes it current straight away.
    await setToday('2026-03-01')
    await pay(loanId, '333.33', '2026-03-01')
    expect(await loan(loanId)).toMatchObject({ delinquency: 'current', overdue: false })
  })

  it('when switched on, charges a late fee at most once per installment; the fee is paid first', async () => {
    const loanId = await paidOutLoan()
    await approveChart()
    const first = await serviceLoans({ asOf: '2026-02-26', chargeFees: true })
    expect(first.feesCharged).toEqual([{ loanId, feeIds: [expect.stringMatching(/^FEE-/)] }])
    expect((await serviceLoans({ asOf: '2026-02-27', chargeFees: true })).feesCharged).toEqual([])
    expect((await serviceLoans({ asOf: '2026-03-26', chargeFees: true })).feesCharged).toEqual([{ loanId, feeIds: [expect.any(String)] }])
    const fees = await prisma.loanFee.findMany({ where: { loanId }, orderBy: { installmentNumber: 'asc' } })
    expect(fees.map((f) => [f.installmentNumber, Number(f.amountCents), f.status])).toEqual([[1, 500, 'charged'], [2, 500, 'charged']])
    expect(await linesOf(fees[0].journalEntry)).toEqual([['1110', 500, 0], ['4010', 0, 500]])

    await setToday('2026-03-27')
    const payment = await pay(loanId, '10', '2026-03-27')
    const view = await callRoute('loans/[id]', 'GET', { params: { id: loanId } })
    expect(view.json.servicing.payments[0].split).toEqual({ fees: 1000, principal: 0, unapplied: 0 })
    expect(await linesOf(payment.json.journalEntries[0])).toEqual([['1030', 1000, 0], ['1110', 0, 1000]])
    expect(view.json.servicing.payoffCents).toBe(100000)

    // Fees are never deleted or re-priced.
    await expect(prisma.loanFee.delete({ where: { id: fees[0].id } })).rejects.toThrow(/cannot be deleted/)
    await expect(prisma.loanFee.update({ where: { id: fees[0].id }, data: { amountCents: BigInt(1) } })).rejects.toThrow(/only be waived/)
  })

  it('a waiver always needs a checker, and a paid fee cannot be waived', async () => {
    const loanId = await paidOutLoan()
    await approveChart()
    await serviceLoans({ asOf: '2026-03-26', chargeFees: true })
    const [fee1, fee2] = await prisma.loanFee.findMany({ where: { loanId }, orderBy: { installmentNumber: 'asc' } })

    await setToday('2026-03-27')
    signInAs('loan_officer')
    expect((await callRoute('loan-fees/[id]/waive', 'POST', { params: { id: fee2.feeId }, body: {} })).status).toBe(400)
    const queued = await callRoute('loan-fees/[id]/waive', 'POST', { params: { id: fee2.feeId }, body: { reason: 'Hospital stay' } })
    expect(queued.status).toBe(202) // even with maker/checker switched off
    const { id } = queued.json.approvalRequest
    expect((await approve(id)).json.code).toBe('maker_is_checker')
    signInAs('board')
    expect((await approve(id)).status).toBe(403)
    signInAs('treasurer')
    expect((await approve(id)).json).toMatchObject({ status: 'approved', resultRef: fee2.feeId })

    const waived = await prisma.loanFee.findUniqueOrThrow({ where: { id: fee2.id } })
    expect(waived).toMatchObject({ status: 'waived', waivedBy: staffId('loan_officer'), waiverReason: 'Hospital stay' })
    expect(await linesOf(waived.waiverEntry)).toEqual([['4010', 500, 0], ['1110', 0, 500]])
    const view = await callRoute('loans/[id]', 'GET', { params: { id: loanId } })
    expect(view.json.servicing).toMatchObject({ feesOutstandingCents: 500, payoffCents: 100500 })

    // Fee 1 gets paid; it can then no longer be waived.
    await pay(loanId, '5', '2026-03-27')
    signInAs('loan_officer')
    const paid = await callRoute('loan-fees/[id]/waive', 'POST', { params: { id: fee1.feeId }, body: { reason: 'late by a day' } })
    expect(paid.status).toBe(409)
    expect((await callRoute('loan-fees/[id]/waive', 'POST', { params: { id: fee2.feeId }, body: { reason: 'again' } })).status).toBe(409)
    expect(await checkInvariants(prisma)).toEqual({ ok: true, problems: [] })
  })
})

describe('write-off', () => {
  it('only for a delinquent loan, after two Board approvals', async () => {
    const loanId = await paidOutLoan()
    await approveChart()
    signInAs('treasurer')
    expect((await callRoute('loans/[id]/write-off', 'POST', { params: { id: loanId }, body: { reason: 'no contact' } })).status).toBe(409)

    await pay(loanId, '100', '2026-01-20')
    await setToday('2026-06-01')
    signInAs('treasurer')
    const queued = await callRoute('loans/[id]/write-off', 'POST', { params: { id: loanId }, body: { reason: 'No contact since February; collection letters sent' } })
    expect(queued.status).toBe(202)
    expect(queued.json.approvalRequest).toMatchObject({ action: 'loan.write_off', approvalsRequired: 2, amountCents: 90000 })
    const { id } = queued.json.approvalRequest

    signInAs('board')
    expect((await approve(id)).json).toMatchObject({ status: 'pending' })
    expect((await approve(id)).status).toBe(409) // the same person cannot approve twice
    expect((await loan(loanId)).lifecycle).toBe('disbursed')
    signInAs('super_admin')
    expect((await approve(id)).json).toMatchObject({ status: 'approved', resultRef: loanId })

    const after = await loan(loanId)
    expect(after).toMatchObject({ lifecycle: 'charged_off', status: 'Charged Off', delinquency: null, overdue: false })
    expect(await linesOf(after.chargeOffEntry)).toEqual([['5100', 90000, 0], ['1100', 0, 90000]])
    expect((await accountBalance(prisma, '1100')).balance).toBe(0)
    expect((await prisma.member.findUniqueOrThrow({ where: { id: BORROWER } })).eligible).toBe('NO - Loan written off')
    expect((await pay(loanId, '10', '2026-06-01')).json.error).toMatch(/written off/)

    // The borrower cannot borrow again.
    signInAs('admin')
    const again = await callRoute('loans', 'POST', { body: { borrowerId: BORROWER, cosignerId: 'MC-COSIGN', loanAmount: '500', termMonths: 5, loanDate: '2026-06-01' } })
    expect(again.status).toBe(422)
  })
})

describe('cancellation and database rules', () => {
  it('cancelling is possible only before payout, and closes a pending payout request', async () => {
    const loanId = await newLoan()
    await signAll(loanId)
    enforce(true)
    const queued = await disburse(loanId)
    expect(queued.status).toBe(202)
    const { agreementId } = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
    signInAs('treasurer')
    expect((await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { action: 'cancel' } })).status).toBe(200)
    expect(await loan(loanId)).toMatchObject({ lifecycle: 'cancelled', status: 'Cancelled' })
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: queued.json.approvalRequest.id } })).status).toBe('cancelled')

    // The borrower is free to borrow again.
    expect((await prisma.member.findUniqueOrThrow({ where: { id: BORROWER } })).activeAsBorrower).toBe(0)
  })

  it('a paid-out loan cannot be cancelled, even with no repayment', async () => {
    const loanId = await paidOutLoan()
    const { agreementId } = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
    signInAs('treasurer')
    const res = await callRoute('agreements/[id]', 'PATCH', { params: { id: agreementId }, body: { action: 'cancel' } })
    expect(res.status).toBe(409)
    expect(res.json.error).toMatch(/paid out/)
  })

  it('the database refuses lifecycle jumps and schedule edits', async () => {
    const loanId = await paidOutLoan()
    await expect(prisma.loan.update({ where: { loanId }, data: { lifecycle: 'approved' } })).rejects.toThrow(/cannot move from disbursed to approved/)
    await expect(prisma.loan.update({ where: { loanId }, data: { lifecycle: 'cancelled' } })).rejects.toThrow(/cannot move/)
    const first = await prisma.loanInstallment.findFirstOrThrow({ where: { loanId } })
    await expect(prisma.loanInstallment.update({ where: { id: first.id }, data: { principalCents: BigInt(1) } })).rejects.toThrow(/cannot be changed/)
    await expect(prisma.loanInstallment.delete({ where: { id: first.id } })).rejects.toThrow(/cannot be changed/)
  })

  it('loans made before the engine keep working the old way', async () => {
    const view = await callRoute('loans/[id]', 'GET', { params: { id: 'LN-TEST-A' } })
    expect(view.json.servicing).toBeNull()
    expect((await callRoute('loans/[id]/disburse', 'POST', { params: { id: 'LN-TEST-A' }, body: { disbursedOn: '2026-01-15', method: 'Zelle' } })).status).toBe(409)
    expect((await pay('LN-TEST-A', '100', '2026-01-15')).status).toBe(201)
    expect((await loan('LN-TEST-A')).balanceRemaining).toBe(900)
  })
})

describe('ledger postings', () => {
  it('money received lands in the clearing account for its method', () => {
    expect(['Card (Stripe)', 'Online', 'Zelle', 'Venmo', 'Bank transfer', 'Cash', 'Check', 'Other', null].map(receiptAccount))
      .toEqual(['1010', '1010', '1020', '1020', '1020', '1030', '1000', '1000', '1000'])
  })

  it('fees, waivers and write-offs also wait for the chart, then post in one run', async () => {
    const loanId = await paidOutLoan()
    await serviceLoans({ asOf: '2026-03-26', chargeFees: true })
    const [fee1] = await prisma.loanFee.findMany({ where: { loanId }, orderBy: { installmentNumber: 'asc' } })
    await setToday('2026-03-26')
    signInAs('loan_officer')
    const waiver = await callRoute('loan-fees/[id]/waive', 'POST', { params: { id: fee1.feeId }, body: { reason: 'first time' } })
    signInAs('treasurer')
    await approve(waiver.json.approvalRequest.id)
    const writeOff = await callRoute('loans/[id]/write-off', 'POST', { params: { id: loanId }, body: { reason: 'moved away' } })
    for (const who of ['board', 'super_admin'] as const) {
      signInAs(who)
      await approve(writeOff.json.approvalRequest.id)
    }
    expect(await loan(loanId)).toMatchObject({ lifecycle: 'charged_off', chargeOffEntry: null, disbursementEntry: null })
    expect(await prisma.journalEntry.count()).toBe(0)

    await approveChart()
    const run = await serviceLoans({ asOf: '2026-03-27' })
    expect(run.journalEntries).toHaveLength(5) // payout, two fees, one waiver, the write-off
    expect(await linesOf((await loan(loanId)).chargeOffEntry)).toEqual([['5100', 100500, 0], ['1100', 0, 100000], ['1110', 0, 500]])
    for (const code of ['1100', '1110']) expect((await accountBalance(prisma, code)).balance).toBe(0)
    expect(await checkInvariants(prisma)).toEqual({ ok: true, problems: [] })
  })

  it('loans made before the engine are never posted or refreshed', async () => {
    expect(await prisma.$transaction((tx) => postPendingLoanEntries(tx, 'LN-TEST-A'))).toEqual([])
    expect(await prisma.$transaction((tx) => postPendingLoanEntries(tx, 'no-such-loan'))).toEqual([])
    await expect(prisma.$transaction((tx) => refreshLoan(tx, 'LN-TEST-A', '2026-01-15'))).rejects.toThrow(/not on the loan engine/)
  })
})
