// Financial safeguards. The integrity protections always apply. The
// business rules the board has not approved yet (src/modules/policy/
// boardRules.ts) are tested both off (the default: the club's existing
// rules) and on.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBaseFixtures, createLoan, createMember, recordBankBalance } from './helpers/factories'
import { prisma, resetDatabase } from './helpers/db'
import { signInAs, signInAsMember } from './helpers/actors'
import { callRoute } from './helpers/routes'
import { calcApplicationFee, validLoanTerms } from '@/lib/loanPolicy'

const borrower = 'SAFE-B'
const cosigner = 'SAFE-C'
const request = (extra: Record<string, unknown> = {}) => callRoute('loans', 'POST', { body: {
  borrowerId: borrower, cosignerId: cosigner, loanAmount: '500', termMonths: 12, loanDate: '2026-01-15', ...extra,
} })
const withdrawal = (amount: string, type = 'Partial', withdrawalDate = '2026-01-15') =>
  callRoute('withdrawals', 'POST', { body: { memberId: 'SAFE-W', amount, type, withdrawalDate } })

const RULE_SETTINGS = ['LOAN_COSIGNER_REQUIRED', 'LOAN_COSIGNER_ELIGIBILITY', 'LOAN_TERM_BANDS', 'WITHDRAWAL_BLOCKED_BY_LOANS', 'WITHDRAWAL_LIQUIDITY_CHECK', 'FULL_EXIT_WHOLE_BALANCE']
const turnOn = (...settings: string[]) => { for (const s of settings) process.env[s] = 'true' }

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  await createMember(borrower, { monthsActive: 24, archiveLifetime: 2000 })
  await createMember('SAFE-B2', { monthsActive: 24, archiveLifetime: 2000 })
  await createMember(cosigner, { monthsActive: 24 })
  await createMember('SAFE-W', { overallContributions: 100 })
  await recordBankBalance(10000_00, '2025-12-31')
  process.env.MAKER_CHECKER_ENFORCED = 'false'
  signInAs('admin')
})
afterEach(() => {
  process.env.MAKER_CHECKER_ENFORCED = 'false'
  for (const s of RULE_SETTINGS) delete process.env[s]
})

describe('withdrawals: always', () => {
  it('never more than the member\'s capital', async () => {
    expect((await withdrawal('100.01')).status).toBe(409)
    expect((await withdrawal('60')).status).toBe(201)
    expect((await withdrawal('40.01')).status).toBe(409)
    expect((await withdrawal('40')).status).toBe(201)
  })
  it('positive, and dated from the cutover through today', async () => {
    expect((await withdrawal('0')).status).toBe(400)
    expect((await withdrawal('10', 'Partial', '2025-12-31')).status).toBe(400)
    expect((await withdrawal('10', 'Partial', '2999-01-01')).status).toBe(400)
    expect(await prisma.withdrawal.count()).toBe(0)
  })
  it('serializes competing payouts and rechecks the remaining capital', async () => {
    const results = await Promise.all([withdrawal('70'), withdrawal('70')])
    expect(results.map(r => r.status).sort()).toEqual([201, 409])
    expect(await prisma.withdrawal.count()).toBe(1)
  })
  it('a full exit is blocked by a loan obligation (the club\'s rule), even if the stored flags are stale', async () => {
    await createLoan('SAFE-L', 'SAFE-W', { lifecycle: 'disbursed' })
    const exit = await withdrawal('100', 'Full Exit')
    expect(exit.status).toBe(409)
    expect(exit.json.error).toMatch(/cannot fully exit/)
  })
  it('rechecks capital when the checker approves a queued payout', async () => {
    process.env.MAKER_CHECKER_ENFORCED = 'true'
    signInAs('finance')
    const queued = await withdrawal('70')
    expect(queued.status).toBe(202)
    // A different completed payout consumed the member's capital.
    await prisma.withdrawal.create({ data: { withdrawalId: 'WD-SAFE-OLD', memberId: 'SAFE-W', memberName: 'W', amount: 50, withdrawalDate: new Date('2026-01-14') } })
    signInAs('treasurer')
    const id = queued.json.approvalRequest.id
    expect((await callRoute('approvals/[id]/approve', 'POST', { params: { id } })).status).toBe(409)
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe('pending')
    expect(await prisma.withdrawal.count()).toBe(1)
  })
})

describe('withdrawals: rules waiting for the board', () => {
  it('partial withdrawal with a loan obligation: allowed until WITHDRAWAL_BLOCKED_BY_LOANS', async () => {
    await createLoan('SAFE-L', 'SAFE-W', { lifecycle: 'disbursed' })
    expect((await withdrawal('20')).status).toBe(201)
    turnOn('WITHDRAWAL_BLOCKED_BY_LOANS')
    const blocked = await withdrawal('20')
    expect(blocked.status).toBe(409)
    expect(blocked.json.error).toMatch(/cannot withdraw while/)
  })
  it('bank cash: not checked until WITHDRAWAL_LIQUIDITY_CHECK', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "TreasuryBankBalance"')
    expect((await withdrawal('20')).status).toBe(201)
    turnOn('WITHDRAWAL_LIQUIDITY_CHECK')
    expect((await withdrawal('20')).status).toBe(409) // no bank balance recorded
    await recordBankBalance(5_00, '2025-12-31')
    expect((await withdrawal('20')).status).toBe(409) // more than the bank holds
    await recordBankBalance(10000_00, '2026-01-14')
    expect((await withdrawal('20')).status).toBe(201)
  })
  it('a full exit may leave capital until FULL_EXIT_WHOLE_BALANCE', async () => {
    turnOn('FULL_EXIT_WHOLE_BALANCE')
    expect((await withdrawal('50', 'Full Exit')).status).toBe(409)
    delete process.env.FULL_EXIT_WHOLE_BALANCE
    expect((await withdrawal('50', 'Full Exit')).status).toBe(201)
  })
  it('a full exit of the whole balance passes with every rule on', async () => {
    turnOn(...RULE_SETTINGS)
    expect((await withdrawal('100', 'Full Exit')).status).toBe(201)
  })
})

describe('loans: always', () => {
  it('a borrower cannot co-sign their own loan', async () => {
    expect((await request({ cosignerId: borrower })).status).toBeGreaterThanOrEqual(400)
    expect(await prisma.loan.count({ where: { borrowerId: borrower } })).toBe(0)
  })
  it('the borrower has no loan obligation (the club\'s rule), counting loans approved but not yet paid out', async () => {
    await createLoan('SAFE-PENDING', borrower, { lifecycle: 'approved' })
    const res = await request()
    expect(res.status).toBe(422)
    expect(res.json.error).toMatch(/Borrower already has an active loan obligation/)
  })
  it('within the cap, a whole number of months up to 24', async () => {
    for (const termMonths of [0, -1, 25, 1000000, '12garbage', '12.5']) expect((await request({ termMonths })).status).toBeGreaterThanOrEqual(400)
    expect(validLoanTerms(5001, 12)).toBe(false)
    expect(validLoanTerms(2500, 25)).toBe(false)
    expect(() => calcApplicationFee(2000, 25)).toThrow()
    expect([calcApplicationFee(2500, 12), calcApplicationFee(2000, 24), calcApplicationFee(2500.01, 12), calcApplicationFee(5000, 24)]).toEqual([30, 30, 50, 70])
  })
})

describe('loans: rules waiting for the board', () => {
  it('a co-signer is optional until LOAN_COSIGNER_REQUIRED', async () => {
    turnOn('LOAN_COSIGNER_REQUIRED')
    expect((await request({ cosignerId: null })).status).toBe(422)
    delete process.env.LOAN_COSIGNER_REQUIRED
    expect((await request({ cosignerId: null })).status).toBe(201)
  })
  it('co-signer eligibility: checked only with LOAN_COSIGNER_ELIGIBILITY', async () => {
    turnOn('LOAN_COSIGNER_ELIGIBILITY')
    for (const data of [{ status: 'Inactive' }, { status: 'Active', monthsActive: 5 }, { monthsActive: 24, activeAsCosigner: 1 }, { activeAsCosigner: 0, activeAsBorrower: 1 }]) {
      await prisma.member.update({ where: { id: cosigner }, data })
      expect((await request()).status).toBe(422)
    }
    expect(await prisma.loan.count({ where: { borrowerId: borrower } })).toBe(0)
    delete process.env.LOAN_COSIGNER_ELIGIBILITY
    expect((await request()).status).toBe(201)
  })
  it('loans up to $2,500 may run 24 months until LOAN_TERM_BANDS', async () => {
    expect(validLoanTerms(2500, 24)).toBe(true)
    expect(validLoanTerms(2500, 24, true)).toBe(false)
    expect(validLoanTerms(2500.01, 24, true)).toBe(true)
    turnOn('LOAN_TERM_BANDS')
    for (const termMonths of [13, 24]) expect((await request({ termMonths })).status).toBe(422)
    delete process.env.LOAN_TERM_BANDS
    expect((await request({ termMonths: 24 })).status).toBe(201)
  })
  it('with co-signer eligibility on, simultaneous approvals cannot reuse a co-signer', async () => {
    turnOn('LOAN_COSIGNER_ELIGIBILITY')
    const results = await Promise.all([request(), request({ borrowerId: 'SAFE-B2' })])
    expect(results.map(r => r.status).sort()).toEqual([201, 422])
    expect(await prisma.loan.count({ where: { cosignerId: cosigner } })).toBe(1)
  })
  it('with co-signer eligibility on, the co-signer is checked again when an approval executes', async () => {
    turnOn('LOAN_COSIGNER_ELIGIBILITY')
    process.env.MAKER_CHECKER_ENFORCED = 'true'
    signInAs('loan_officer')
    const queued = await request()
    expect(queued.status).toBe(202)
    await prisma.member.update({ where: { id: cosigner }, data: { status: 'Inactive' } })
    signInAs('board')
    const id = queued.json.approvalRequest.id
    expect((await callRoute('approvals/[id]/approve', 'POST', { params: { id } })).status).toBe(422)
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe('pending')
  })
  it('the new-loan form learns which rules are on', async () => {
    signInAs('loan_officer')
    expect((await callRoute('loans/check-policy', 'GET')).json).toEqual({ cosignerRequired: false, loanTermBands: false })
    turnOn('LOAN_COSIGNER_REQUIRED', 'LOAN_TERM_BANDS')
    expect((await callRoute('loans/check-policy', 'GET')).json).toEqual({ cosignerRequired: true, loanTermBands: true })
    const check = await callRoute('loans/check-policy', 'POST', { body: { memberId: borrower, amount: '500', termMonths: '24' } })
    expect(check.json.errors).toContain('Loans up to $2,500 require 1–12 months; larger loans up to $5,000 require 1–24 months.')
  })
  it('every rule is listed with its setting', async () => {
    const { boardRules } = await import('@/modules/policy/boardRules')
    expect(boardRules().map((r) => [r.env, r.on])).toEqual(RULE_SETTINGS.map((s) => [s, false]))
    turnOn('LOAN_TERM_BANDS')
    expect(boardRules().find((r) => r.env === 'LOAN_TERM_BANDS')!.on).toBe(true)
  })
})

describe('agreement integrity', () => {
  it('freezes signed terms through the API and requires matching signatures before payout', async () => {
    const loanId = (await request()).json.loanId
    const agreement = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
    const id = agreement.agreementId
    signInAsMember(borrower)
    expect((await callRoute('agreements/[id]', 'PATCH', { params: { id }, body: { signerType: 'borrower', signatureText: 'Borrower', borrowerCity: 'Tulsa' } })).status).toBe(200)
    signInAs('admin')
    expect((await callRoute('agreements/[id]', 'PATCH', { params: { id }, body: { borrowerCity: 'Dallas' } })).status).toBe(409)
    const signed = await prisma.loanAgreement.findUniqueOrThrow({ where: { agreementId: id } })
    expect(signed.borrowerSignedHash).toBe(signed.termsHash)
    // An old/corrupt fully-signed lifecycle flag is not enough to authorize payout.
    await prisma.loan.update({ where: { loanId }, data: { lifecycle: 'agreement_signed' } })
    signInAs('treasurer')
    expect((await callRoute('loans/[id]/disburse', 'POST', { params: { id: loanId }, body: { method: 'Zelle', disbursedOn: '2026-01-15' } })).status).toBe(409)
  })
  it('database freezes signed terms and recorded signatures', async () => {
    const loanId = (await request()).json.loanId
    const { agreementId: id } = await prisma.loanAgreement.findUniqueOrThrow({ where: { loanId } })
    signInAsMember(borrower)
    expect((await callRoute('agreements/[id]', 'PATCH', { params: { id }, body: { signerType: 'borrower', signatureText: 'Borrower', borrowerCity: 'Tulsa' } })).status).toBe(200)
    await expect(prisma.loanAgreement.update({ where: { agreementId: id }, data: { borrowerCity: 'Dallas' } })).rejects.toThrow(/frozen/)
    await expect(prisma.loanAgreement.update({ where: { agreementId: id }, data: { borrowerSignature: 'Someone else' } })).rejects.toThrow(/cannot be replaced/)
  })

})
