// Treasury (Gate #1 A10, docs/architecture/08 §1): the cash figure, the
// minimum reserve, and loans approved only within the lending capacity.
// The ledger-based cash figure (after opening balances) is covered in
// opening-balances.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signInAs, staffId } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createMember, recordBankBalance } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { treasuryPosition } from '@/modules/treasury'

const enforce = (on: boolean) => { process.env.MAKER_CHECKER_ENFORCED = on ? 'true' : '' }
const approve = (id: string) => callRoute('approvals/[id]/approve', 'POST', { params: { id }, body: {} })
const newLoan = (borrowerId: string, loanAmount: string, termMonths: number) =>
  callRoute('loans', 'POST', { body: { borrowerId, cosignerId: `${borrowerId}-C`, loanAmount, termMonths, loanDate: '2026-09-20' } })

let seq = 0
const contribution = (memberId: string, date: string, cents: number, reversed = false) => prisma.contribution.create({
  data: {
    transactionId: `CON-TR${++seq}`, memberId, memberName: memberId, paymentDate: new Date(date), monthYear: 'x',
    amount: cents / 100, amountCents: BigInt(cents), source: 'test', ...(reversed ? { reversedAt: new Date(), reversedBy: 'x', reversalReason: 'mistake' } : {}),
  },
})
const withdrawal = (memberId: string, date: string, amount: number) => prisma.withdrawal.create({
  data: { withdrawalId: `WD-TR${++seq}`, memberId, memberName: memberId, amount, withdrawalDate: new Date(date) },
})

beforeEach(async () => {
  await resetDatabase()
  // Two older loans made 2026-01-15 (paid out on their loan date), staff for every role.
  await createBaseFixtures()
  // $10,000 of member capital → a $1,500 reserve.
  await createMember('MC-CAPITAL', { overallContributions: 10_000 })
  await createMember('MC-BORROW', { monthsActive: 24, archiveLifetime: 2000, contributions2026: 180 })
  await createMember('MC-BORROW2', { monthsActive: 24, archiveLifetime: 2000, contributions2026: 180 })
  await createMember('MC-BORROW-C', { monthsActive: 24 })
  await createMember('MC-BORROW2-C', { monthsActive: 24 })
})
afterEach(() => enforce(false))

describe('before any bank balance is recorded', () => {
  it('the lending capacity is unknown and no loan can be approved', async () => {
    signInAs('loan_officer')
    const res = await callRoute('treasury', 'GET')
    expect(res.status).toBe(200)
    expect(res.json.cash).toEqual({ source: 'unknown', cents: null })
    expect(res.json.capacityCents).toBeNull()
    expect(res.json.reserve.cents).toBe(1_500_00)
    expect(res.json.warnings[0]).toMatch(/No bank balance has been recorded/)

    const refused = await newLoan('MC-BORROW', '1000', 10)
    expect(refused.status).toBe(409)
    expect(refused.json.code).toBe('lending_capacity_unknown')
    expect(await prisma.loan.count({ where: { borrowerId: 'MC-BORROW' } })).toBe(0)

    // Not queued for approval either.
    enforce(true)
    expect((await newLoan('MC-BORROW', '1000', 10)).status).toBe(409)
    expect(await prisma.approvalRequest.count()).toBe(0)
  })
})

describe('recording the bank balance', () => {
  it('validates, records with an audit entry, and never changes afterwards', async () => {
    signInAs('treasurer')
    const record = (body: Record<string, unknown>) => callRoute('treasury/bank-balance', 'POST', { body })
    expect((await record({ statementDate: '2999-01-01', balance: '100' })).status).toBe(400)
    expect((await record({ statementDate: 'yesterday', balance: '100' })).status).toBe(400)
    expect((await record({ statementDate: '2026-02-01', balance: '12.345' })).status).toBe(400)
    expect((await record({ statementDate: '2026-02-01', balance: '-5' })).status).toBe(400)
    expect((await callRoute('treasury/bank-balance', 'POST', { rawBody: 'not json' })).status).toBe(400)

    const marker = await auditMarker()
    const res = await record({ statementDate: '2026-02-01', balance: '$48,250.00', note: '  February statement  ' })
    expect(res.status).toBe(201)
    expect(res.json).toMatchObject({ balanceCents: 48_250_00, note: 'February statement', recordedBy: staffId('treasurer'), approvedBy: null })
    const audit = await auditEntriesSince(marker)
    expect(audit.map((a) => a.action)).toEqual(['treasury.bank_balance.record'])

    await expect(prisma.treasuryBankBalance.update({ where: { balanceId: res.json.balanceId }, data: { balanceCents: BigInt(1) } })).rejects.toThrow(/cannot be changed or deleted/)
    await expect(prisma.treasuryBankBalance.delete({ where: { balanceId: res.json.balanceId } })).rejects.toThrow(/cannot be changed or deleted/)

    // A later statement supersedes it; an earlier one recorded afterwards does not.
    expect((await record({ statementDate: '2026-03-01', balance: '50000' })).status).toBe(201)
    expect((await record({ statementDate: '2026-02-15', balance: '1' })).status).toBe(201)
    const position = await treasuryPosition(prisma, '2026-03-01')
    expect(position.cash.source === 'bank_balance' && position.cash.balance.balanceCents).toBe(50_000_00)
  })

  it('needs a Board member to confirm it once maker/checker is on', async () => {
    enforce(true)
    signInAs('treasurer')
    await recordBankBalance(40_000_00, '2026-02-01')
    const queued = await callRoute('treasury/bank-balance', 'POST', { body: { statementDate: '2026-03-01', balance: '45000' } })
    expect(queued.status).toBe(202)
    expect(queued.json.approvalRequest.summary).toMatch(/\$45,000\.00 at the end of 2026-03-01 \(previous: \$40,000\.00 at 2026-02-01\)/)
    expect(await prisma.treasuryBankBalance.count()).toBe(1)

    expect((await approve(queued.json.approvalRequest.id)).json.code).toBe('maker_is_checker')
    signInAs('finance') // no checker permission
    expect((await approve(queued.json.approvalRequest.id)).status).toBe(403)
    signInAs('board')
    expect((await approve(queued.json.approvalRequest.id)).status).toBe(200)
    const recorded = await prisma.treasuryBankBalance.findFirstOrThrow({ where: { statementDate: new Date('2026-03-01') } })
    expect({ by: recorded.recordedBy, checker: recorded.approvedBy }).toEqual({ by: staffId('treasurer'), checker: staffId('board') })
  })
})

describe('the cash figure before the ledger holds cash', () => {
  it('is the latest bank balance carried forward with the money recorded since', async () => {
    await recordBankBalance(10_000_00, '2026-03-31')
    await contribution('MC-CAPITAL', '2026-03-31', 99_00) // on the statement day: already in the balance
    await contribution('MC-CAPITAL', '2026-04-05', 20_00)
    await contribution('MC-CAPITAL', '2026-04-06', 500_00, true) // reversed: never received
    await prisma.loanPayment.create({ data: { paymentId: 'LP-TR1', loanId: 'LN-TEST-A', borrowerId: 'MC-TEST-A', borrowerName: 'x', paymentDate: new Date('2026-04-10'), amount: 100 } })
    await withdrawal('MC-CAPITAL', '2026-04-15', 500)
    await prisma.loan.create({ // on the loan engine, paid out net of the fee
      data: {
        loanId: 'LN-ENG', borrowerId: 'MC-BORROW', borrowerName: 'B', loanDate: new Date('2026-04-18'), termMonths: 10, loanAmount: 1000,
        monthlyDue: 100, balanceRemaining: 1000, lifecycle: 'disbursed', principalCents: BigInt(1000_00), applicationFeeCents: BigInt(30_00),
        disbursedOn: new Date('2026-04-20'), disbursedAmountCents: BigInt(970_00),
      },
    })
    await prisma.loan.create({ // made before the loan engine: paid out on its loan date
      data: { loanId: 'LN-OLD', borrowerId: 'MC-BORROW2', borrowerName: 'B2', loanDate: new Date('2026-04-25'), termMonths: 3, loanAmount: 300, monthlyDue: 100, balanceRemaining: 300 },
    })
    await contribution('MC-CAPITAL', '2026-05-02', 1_000_00) // after "today": not yet

    const p = await treasuryPosition(prisma, '2026-05-01')
    expect(p.cash.source).toBe('bank_balance')
    if (p.cash.source !== 'bank_balance') throw new Error('unreachable')
    expect(p.cash.since).toEqual({
      contributions: { count: 1, cents: 20_00 },
      loanRepayments: { count: 1, cents: 100_00 },
      loanPayouts: { count: 2, cents: 1_270_00 },
      withdrawals: { count: 1, cents: 500_00 },
    })
    expect(p.cash.cents).toBe(10_000_00 + 20_00 + 100_00 - 1_270_00 - 500_00)
    expect(p.cash.balance).toMatchObject({ statementDate: '2026-03-31', ageDays: 31 })

    // Member capital: stored totals less withdrawals since the cutover.
    expect(p.memberCapitalCents).toBe(10_000_00 - 500_00)
    expect(p.reserve).toEqual({ cents: 1_425_00, byCapitalCents: 1_425_00, byWithdrawalsCents: 125_00, basis: 'capital' })
    expect(p.recentWithdrawals).toEqual({ from: '2025-05-01', cents: 500_00 })
    expect(p.capacityCents).toBe(p.cash.cents - 1_425_00)
    expect(p.warnings).toEqual([])
  })

  it('places a payment confirmed at a moment on its club calendar day (America/Chicago)', async () => {
    await recordBankBalance(10_000_00, '2026-03-31')
    // 11:30 pm in Chicago on the statement day: already in that day's balance.
    await contribution('MC-CAPITAL', '2026-04-01T04:30:00Z', 40_00)
    // 10 pm in Chicago on 1 May (already 2 May in UTC): counted on May 1st.
    await contribution('MC-CAPITAL', '2026-05-02T03:00:00Z', 60_00)
    // The next club day: not yet.
    await contribution('MC-CAPITAL', '2026-05-02T15:00:00Z', 80_00)
    const p = await treasuryPosition(prisma, '2026-05-01')
    expect(p.cash.source === 'bank_balance' && p.cash.since.contributions).toEqual({ count: 1, cents: 60_00 })
  })

  it('warns when the balance is stale or cash is below the reserve', async () => {
    await recordBankBalance(1_000_00, '2026-02-01')
    const p = await treasuryPosition(prisma, '2026-04-30')
    expect(p.warnings).toEqual([
      expect.stringMatching(/The bank balance is 88 days old/),
      expect.stringMatching(/Cash is below the minimum reserve by \$500\.00/),
    ])
    expect(p.capacityCents).toBe(-500_00)
  })

  it('counts the last 12 months of withdrawals, and a month-end date falls back to the shorter month', async () => {
    await recordBankBalance(100_000_00, '2026-01-01')
    await withdrawal('MC-CAPITAL', '2025-02-28', 9_000) // just outside the window
    await withdrawal('MC-CAPITAL', '2025-03-01', 12_000)
    const p = await treasuryPosition(prisma, '2026-02-28')
    expect(p.recentWithdrawals).toEqual({ from: '2025-02-28', cents: 12_000_00 })
    expect(p.reserve.byWithdrawalsCents).toBe(3_000_00)
    const leap = await treasuryPosition(prisma, '2028-02-29')
    expect(leap.recentWithdrawals.from).toBe('2027-02-28')
    const monthEnd = await treasuryPosition(prisma, '2026-03-31')
    expect(monthEnd.recentWithdrawals.from).toBe('2025-03-31')
  })
})

describe('approving loans within the lending capacity', () => {
  beforeEach(async () => {
    // $2,000 after the older loans' payouts; less the $1,500 reserve → $500 to lend.
    await recordBankBalance(2_000_00, '2026-02-01')
  })

  it('refuses a loan whose payout does not fit, and counts approved loans as committed', async () => {
    signInAs('loan_officer')
    const tooBig = await newLoan('MC-BORROW', '1000', 10) // pays out $970
    expect(tooBig.status).toBe(409)
    expect(tooBig.json).toMatchObject({ code: 'over_lending_capacity', capacityCents: 500_00, payoutCents: 970_00, shortfallCents: 470_00 })
    expect(tooBig.json.error).toMatch(/pays out \$970\.00, but the lending capacity is \$500\.00/)

    const fits = await newLoan('MC-BORROW', '500', 5) // pays out $470
    expect(fits.status).toBe(201)
    const res = await callRoute('treasury', 'GET')
    expect(res.json.committed).toEqual({ cents: 470_00, loans: [{ loanId: fits.json.loanId, borrowerName: expect.any(String), lifecycle: 'approved', payoutCents: 470_00 }] })
    expect(res.json.capacityCents).toBe(30_00)

    // The next one no longer fits.
    expect((await newLoan('MC-BORROW2', '500', 5)).json.code).toBe('over_lending_capacity')
  })

  it('counts an odd approved record without its fee, or without cents, in full', async () => {
    const odd = (loanId: string, borrowerId: string, extra: Record<string, unknown>) => prisma.loan.create({
      data: { loanId, borrowerId, borrowerName: borrowerId, loanDate: new Date('2026-09-01'), termMonths: 5, loanAmount: 200, monthlyDue: 40, balanceRemaining: 200, lifecycle: 'approved', ...extra },
    })
    await odd('LN-NOFEE', 'MC-BORROW', { principalCents: BigInt(200_00) })
    await odd('LN-NOCENTS', 'MC-BORROW2', {})
    const p = await treasuryPosition(prisma, '2026-09-20')
    expect(p.committed.loans.map((l) => [l.loanId, l.payoutCents])).toEqual([['LN-NOCENTS', 200_00], ['LN-NOFEE', 200_00]])
    expect(p.capacityCents).toBe(500_00 - 400_00)
  })

  it('re-checks when a queued loan is approved', async () => {
    enforce(true)
    signInAs('loan_officer')
    const queued = await newLoan('MC-BORROW', '500', 5)
    expect(queued.status).toBe(202)
    // Meanwhile a withdrawal is paid out.
    await withdrawal('MC-CAPITAL', '2026-09-21', 100)
    signInAs('board')
    const refused = await approve(queued.json.approvalRequest.id)
    expect(refused.status).toBe(409)
    expect(refused.json.error).toMatch(/lending capacity is \$415\.00/)
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: queued.json.approvalRequest.id } })).status).toBe('pending')
    expect(await prisma.loan.count({ where: { borrowerId: 'MC-BORROW' } })).toBe(0)
  })
})
