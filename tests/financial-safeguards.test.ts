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
const withdrawal = (amount: string, type = 'Partial') => callRoute('withdrawals', 'POST', { body: { memberId: 'SAFE-W', amount, type, withdrawalDate: '2026-01-15' } })

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
afterEach(() => { process.env.MAKER_CHECKER_ENFORCED = 'false' })

describe('withdrawal safeguards', () => {
  it('refuses capital overdrafts and full exits that leave capital behind', async () => {
    expect((await withdrawal('100.01')).status).toBe(409)
    expect((await withdrawal('50', 'Full Exit')).status).toBe(409)
    expect(await prisma.withdrawal.count()).toBe(0)
    expect((await withdrawal('100', 'Full Exit')).status).toBe(201)
    expect((await withdrawal('1')).status).toBe(409)
  })
  it('serializes competing payouts and rechecks the remaining capital', async () => {
    const results = await Promise.all([withdrawal('70'), withdrawal('70')])
    expect(results.map(r => r.status).sort()).toEqual([201, 409])
    expect(await prisma.withdrawal.count()).toBe(1)
  })
  it('uses actual loan obligations even if cached member flags are stale', async () => {
    await createLoan('SAFE-L', 'SAFE-W', { lifecycle: 'disbursed' })
    expect((await withdrawal('20')).status).toBe(409)
  })
  it('refuses a payout when bank cash is unknown or insufficient', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "TreasuryBankBalance"')
    expect((await withdrawal('20')).status).toBe(409)
    await recordBankBalance(5_00, '2025-12-31')
    expect((await withdrawal('20')).status).toBe(409)
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

describe('new loan policy', () => {
  it('requires a distinct eligible co-signer', async () => {
    expect((await request({ cosignerId: null })).status).toBe(422)
    expect((await request({ cosignerId: borrower })).status).toBe(400)
    for (const data of [{ status: 'Inactive' }, { status: 'Active', monthsActive: 5 }, { monthsActive: 24, activeAsCosigner: 1 }, { activeAsCosigner: 0, activeAsBorrower: 1 }]) {
      await prisma.member.update({ where: { id: cosigner }, data })
      expect((await request()).status).toBe(422)
    }
    expect(await prisma.loan.count({ where: { borrowerId: borrower } })).toBe(0)
  })
  it('does not accept unsupported terms or a fee fallback', async () => {
    for (const termMonths of [0, -1, 13, 24, 1000000, '12garbage', '12.5']) expect((await request({ termMonths })).status).toBeGreaterThanOrEqual(400)
    expect(validLoanTerms(2500, 12)).toBe(true)
    expect(validLoanTerms(2500, 24)).toBe(false)
    expect(validLoanTerms(2500.01, 24)).toBe(true)
    expect(validLoanTerms(5001, 12)).toBe(false)
    expect(() => calcApplicationFee(2000, 24)).toThrow()
    expect([calcApplicationFee(2500, 12), calcApplicationFee(2500.01, 12), calcApplicationFee(5000, 24)]).toEqual([30, 50, 70])
  })
  it('does not reuse a co-signer in simultaneous loan approvals', async () => {
    const results = await Promise.all([request(), request({ borrowerId: 'SAFE-B2' })])
    expect(results.map(r => r.status).sort()).toEqual([201, 422])
    expect(await prisma.loan.count({ where: { cosignerId: cosigner } })).toBe(1)
  })
  it('rechecks the co-signer when an approval executes', async () => {
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
