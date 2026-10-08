// Maker / checker (D-06): who may propose, who may approve, and what runs
// when. The maker can never approve their own request — enforced by the
// application and by the database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TEST_IDS, signInAs, signInAsMember, staffId } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createMember, recordBankBalance } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { approveAccounts, checkInvariants } from '@/modules/accounting/ledger'

const enforce = (on: boolean) => { process.env.MAKER_CHECKER_ENFORCED = on ? 'true' : '' }

async function zelleClaim(amount: number) {
  signInAsMember(TEST_IDS.member)
  const res = await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'zelle', amount } })
  return res.json.portalPayment as { id: string; publicId: string }
}

const approve = (id: string, note?: string) => callRoute('approvals/[id]/approve', 'POST', { params: { id }, body: { note } })
const reject = (id: string, note?: string) => callRoute('approvals/[id]/reject', 'POST', { params: { id }, body: { note } })

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  // An eligible borrower for loan requests.
  await createMember('MC-BORROW', { monthsActive: 24, archiveLifetime: 2000, contributions2026: 180 })
  // Plenty of room to lend (Gate #1 A10); tests/treasury.test.ts covers the limits.
  await createMember('MC-COSIGN', { monthsActive: 24 })
  await createMember('MC-WITHDRAW', { overallContributions: 250 })
  await prisma.member.update({ where: { id: TEST_IDS.otherMember }, data: { overallContributions: 100 } })
  await recordBankBalance(1_000_000_00)
})
afterEach(() => enforce(false))

describe('switched off (until the officers are named)', () => {
  it('existing actions take effect with one person, as before', async () => {
    enforce(false)
    const claim = await zelleClaim(150)
    signInAs('admin')
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(200)
    expect((await callRoute('withdrawals', 'POST', { body: { memberId: 'MC-WITHDRAW', amount: '40', withdrawalDate: '2026-09-20' } })).status).toBe(201)
    expect((await callRoute('loans', 'POST', { body: { borrowerId: 'MC-BORROW', cosignerId: 'MC-COSIGN', loanAmount: '1000', termMonths: 10, loanDate: '2026-09-20' } })).status).toBe(201)
    expect(await prisma.approvalRequest.count()).toBe(0)
  })
})

describe('Zelle confirmations', () => {
  beforeEach(() => enforce(true))

  it('up to $100 need one person', async () => {
    const claim = await zelleClaim(100)
    signInAs('finance')
    // finance lacks payments.review; the club officer has it
    signInAs('admin')
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(200)
  })

  it('above $100 wait for a second person, who is never the maker', async () => {
    const marker = await auditMarker()
    const claim = await zelleClaim(150)
    signInAs('admin')
    const queued = await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })
    expect(queued.status).toBe(202)
    const request = queued.json.approvalRequest
    expect(request).toMatchObject({ action: 'payment.zelle.confirm', amountCents: 15000, status: 'pending', isMine: true, canDecide: false })
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe('pending')
    expect(await prisma.contribution.count()).toBe(0)

    // It shows as awaiting approval, and cannot be queued twice.
    expect((await callRoute('payments', 'GET')).json.payments[0].awaitingApproval).toBe(request.publicId)
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(409)

    // The maker cannot approve; someone without the checker permission cannot either.
    expect((await approve(request.id)).json.code).toBe('maker_is_checker')
    signInAs('loan_officer')
    expect((await approve(request.id)).status).toBe(403)

    signInAs('treasurer')
    const approved = await approve(request.id, 'matches the bank statement')
    expect(approved.status).toBe(200)
    expect(approved.json).toMatchObject({ status: 'approved', resultRef: claim.publicId })
    expect(await prisma.contribution.count()).toBe(1)

    const actions = (await auditEntriesSince(marker)).map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(['approval.request', 'payment.zelle.confirm', 'approval.approve']))
    const confirm = (await auditEntriesSince(marker)).find((e) => e.action === 'payment.zelle.confirm')!
    expect(confirm.metadata).toMatchObject({ maker: TEST_IDS.admin, checker: staffId('treasurer') })
  })

  it('two checkers approving at once run it once', async () => {
    const claim = await zelleClaim(150)
    signInAs('admin')
    const { id } = (await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).json.approvalRequest
    const results = await Promise.all(['treasurer', 'board', 'super_admin'].map(async (who) => {
      signInAs(who as any)
      return approve(id)
    }))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await prisma.contribution.count()).toBe(1)
  })

  it('a rejection needs a reason and changes nothing', async () => {
    const claim = await zelleClaim(150)
    signInAs('admin')
    const { id } = (await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).json.approvalRequest
    signInAs('treasurer')
    expect((await reject(id)).status).toBe(400)
    expect((await reject(id, 'not in the bank yet')).json).toMatchObject({ status: 'rejected', decisionNote: 'not in the bank yet' })
    expect(await prisma.contribution.count()).toBe(0)
    expect((await approve(id)).status).toBe(409)
  })

  it('rejecting the claim itself closes a pending confirmation', async () => {
    const claim = await zelleClaim(150)
    signInAs('admin')
    const { id } = (await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).json.approvalRequest
    signInAs('treasurer')
    await callRoute('payments/[id]/reject', 'POST', { params: { id: claim.id }, body: { reason: 'duplicate claim' } })
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe('cancelled')
  })

  it('only the maker can withdraw their request', async () => {
    const claim = await zelleClaim(150)
    signInAs('admin')
    const { id } = (await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).json.approvalRequest
    signInAs('treasurer')
    expect((await callRoute('approvals/[id]/cancel', 'POST', { params: { id } })).status).toBe(403)
    signInAs('admin')
    expect((await callRoute('approvals/[id]/cancel', 'POST', { params: { id } })).json.status).toBe('cancelled')
    // …and can then confirm afresh (a new request).
    expect((await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).status).toBe(202)
  })
})

describe('withdrawals and loans', () => {
  beforeEach(() => enforce(true))

  it('a full exit is paid only after the Treasurer approves', async () => {
    await prisma.member.update({ where: { id: TEST_IDS.otherMember }, data: { activeAsBorrower: 1 } })
    signInAs('finance')
    const queued = await callRoute('withdrawals', 'POST', {
      body: { memberId: TEST_IDS.otherMember, amount: '250.00', withdrawalDate: '2026-09-20', type: 'Full Exit' },
    })
    // A member with an active loan cannot fully exit: refused up front, never queued
    expect(queued.status).toBe(409)
    const partial = await callRoute('withdrawals', 'POST', { body: { memberId: 'MC-WITHDRAW', amount: '250.00', withdrawalDate: '2026-09-20', type: 'Full Exit' } })
    expect(partial.status).toBe(202)
    const { id } = partial.json.approvalRequest
    signInAs('board') // no withdrawals.approve
    expect((await approve(id)).status).toBe(403)
    signInAs('treasurer')
    expect((await approve(id)).json.status).toBe('approved')
    expect(await prisma.withdrawal.count({ where: { memberId: 'MC-WITHDRAW' } })).toBe(1)
    expect((await prisma.member.findUniqueOrThrow({ where: { id: 'MC-WITHDRAW' } })).status).toBe('Inactive')
  })

  it('a loan is created only on approval, and re-checked against policy then', async () => {
    signInAs('loan_officer')
    const queued = await callRoute('loans', 'POST', { body: { borrowerId: 'MC-BORROW', cosignerId: 'MC-COSIGN', loanAmount: '1000', termMonths: 10, loanDate: '2026-09-20' } })
    expect(queued.status).toBe(202)
    const { id } = queued.json.approvalRequest
    expect(await prisma.loan.count({ where: { borrowerId: 'MC-BORROW' } })).toBe(0)

    // Meanwhile the borrower became ineligible: approval fails, nothing changes, it stays pending.
    await prisma.member.update({ where: { id: 'MC-BORROW' }, data: { activeAsCosigner: 1 } })
    signInAs('board')
    const refused = await approve(id)
    expect(refused.status).toBe(422)
    expect(refused.json.violations.length).toBeGreaterThan(0)
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe('pending')
    expect(await prisma.approvalDecision.count()).toBe(0)

    await prisma.member.update({ where: { id: 'MC-BORROW' }, data: { activeAsCosigner: 0 } })
    const ok = await approve(id)
    expect(ok.json.status).toBe('approved')
    expect(await prisma.loan.count({ where: { borrowerId: 'MC-BORROW' } })).toBe(1)
    expect(await prisma.loanAgreement.count({ where: { borrowerId: 'MC-BORROW' } })).toBe(1)
  })

  it('an ineligible loan is refused before it is queued', async () => {
    signInAs('loan_officer')
    const res = await callRoute('loans', 'POST', { body: { borrowerId: 'MC-BORROW', cosignerId: 'MC-COSIGN', loanAmount: '9000', termMonths: 10, loanDate: '2026-09-20' } })
    expect(res.status).toBe(422)
    expect(await prisma.approvalRequest.count()).toBe(0)
  })
})

describe('manual journal entries', () => {
  const entry = {
    effectiveDate: '2026-09-20', description: 'Bank charge for September',
    lines: [{ account: '5010', debit: '12.00' }, { account: '1000', credit: '12.00' }],
  }

  it('always need a second person, even with maker/checker switched off', async () => {
    enforce(false)
    signInAs('finance')
    expect((await callRoute('ledger/entries', 'POST', { body: entry })).status).toBe(422) // chart not approved yet
    await prisma.$transaction((tx) => approveAccounts(tx, { codes: ['5010', '1000'], approvedBy: staffId('treasurer'), note: 'test chart approval' }))

    expect((await callRoute('ledger/entries', 'POST', { body: { ...entry, lines: [{ account: '5010', debit: '12.00' }, { account: '1000', credit: '11.00' }] } })).status).toBe(400)
    const queued = await callRoute('ledger/entries', 'POST', { body: entry })
    expect(queued.status).toBe(202)
    expect(await prisma.journalEntry.count()).toBe(0)

    signInAs('treasurer')
    const approved = await approve(queued.json.approvalRequest.id)
    expect(approved.json.resultRef).toMatch(/^JE-2026-/)
    const posted = await prisma.journalEntry.findFirstOrThrow()
    expect(posted).toMatchObject({ createdBy: staffId('finance'), approvedBy: staffId('treasurer'), type: 'adjustment' })
    expect(await checkInvariants(prisma)).toEqual({ ok: true, problems: [] })
  })
})

describe('database backstop', () => {
  it('refuses a decision by the maker even if the application is bypassed', async () => {
    enforce(true)
    const claim = await zelleClaim(150)
    signInAs('admin')
    const { id } = (await callRoute('payments/[id]/confirm', 'POST', { params: { id: claim.id } })).json.approvalRequest
    await expect(prisma.approvalDecision.create({ data: { requestId: id, deciderId: TEST_IDS.admin, decision: 'approve' } }))
      .rejects.toThrow(/Maker and checker must be different/)
  })
})
