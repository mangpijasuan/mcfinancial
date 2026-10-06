// Member statements from the ledger (product map: Finance → Statements):
// a month or a year, the balance at each end and every movement between,
// the same each time it is regenerated, final once its months are closed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_IDS, signInAs, signInAsMember, staffId } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createMember } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { approveAccounts, postEntry } from '@/modules/accounting/ledger'
import { checkOpening, postOpeningBalances } from '@/modules/accounting/opening'
import { cents } from '@/lib/money'

const M1 = 'MC-STMT-1'

async function openLedger() {
  const codes = (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code)
  await prisma.$transaction((tx) => approveAccounts(tx, { codes, approvedBy: staffId('treasurer'), note: 'test chart approval' }))
  const inputs = { cutover: '2026-01-01', bankBalanceCents: cents(5000_00), confirmedLoanBalances: {} }
  const plan = await prisma.$transaction((tx) => checkOpening(tx, inputs))
  await prisma.$transaction((tx) => postOpeningBalances(tx, { ...inputs, openingHash: plan.openingHash },
    { maker: { id: staffId('treasurer'), email: '' }, checker: { id: staffId('board'), email: '' } },
    { actorType: 'system', actorId: null, actorLabel: 'test', ip: null, userAgent: null, requestId: null } as never), { timeout: 60_000 })
}

const mine = async (memberId: string, period?: string) => {
  signInAsMember(memberId)
  return period ? callRoute('portal/statements/[period]', 'GET', { params: { period } }) : callRoute('portal/statements', 'GET')
}
const contribute = (memberId: string, amount: string, paymentDate: string) =>
  callRoute('contributions', 'POST', { body: { memberId, amount, paymentDate, paymentMethod: 'Cash', receivedBy: 'Fin' } })

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  await createMember(M1, { archiveLifetime: 1000, overallContributions: 1000, monthsActive: 24 })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('before opening balances', () => {
  it('there are no statements yet', async () => {
    expect((await mine(M1)).json).toEqual({ periods: null })
    expect((await mine(M1, '2026-09')).status).toBe(404)
  })
})

describe('after opening balances', () => {
  beforeEach(async () => {
    await openLedger()
    await prisma.staffSession.updateMany({ data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) } })
    signInAs('finance')
    expect((await contribute(M1, '20', '2026-08-10')).status).toBe(201)
    expect((await contribute(M1, '20', '2026-09-15')).status).toBe(201)
    expect((await callRoute('withdrawals', 'POST', { body: { memberId: M1, amount: '50', withdrawalDate: '2026-09-20' } })).status).toBe(201)
    // An older loan (base fixtures: LN-TEST-A, $1,000 made 2026-01-15) repaid in part in September.
    expect((await callRoute('loan-payments', 'POST', { body: { loanId: 'LN-TEST-A', amount: '100', paymentDate: '2026-09-10', paymentMethod: 'Cash' } })).status).toBe(201)
  })

  it('offers every month from the cutover and each year, newest first', async () => {
    const { periods } = (await mine(M1)).json
    expect(periods.map((p: any) => p.period)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01', '2026'])
    expect(periods[1]).toEqual({ period: '2026-09', kind: 'month', label: 'September 2026', final: false })
    expect(periods.at(-1)).toEqual({ period: '2026', kind: 'year', label: 'Year 2026 (to date)', final: false })
  })

  it('a month: the balance at each end and every movement between', async () => {
    const res = await mine(M1, '2026-09')
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ memberId: M1, period: '2026-09', label: 'September 2026', from: '2026-09-01', to: '2026-09-30', final: false })
    expect(res.json.sections).toHaveLength(1) // capital only: no loan, fees or held money
    const [capital] = res.json.sections
    expect(capital).toMatchObject({ key: 'capital', title: 'Your capital', openingCents: 1020_00, closingCents: 990_00 })
    expect(capital.lines.map((l: any) => [l.date, l.amountCents])).toEqual([['2026-09-15', 20_00], ['2026-09-20', -50_00]])
    expect(capital.lines[0]).toEqual({ date: '2026-09-15', entryNumber: expect.stringMatching(/^JE-2026-/), description: expect.any(String), amountCents: 20_00 })
  })

  it('a year: from the archive total at the cutover to today', async () => {
    const year = (await mine(M1, '2026')).json
    expect(year).toMatchObject({ from: '2026-01-01', to: '2026-10-15' }) // still running, so it ends today
    expect((await mine(M1, '2026-10')).json).toMatchObject({ from: '2026-10-01', to: '2026-10-15' })
    const [capital] = year.sections
    expect(capital).toMatchObject({ openingCents: 1000_00, closingCents: 990_00 })
    expect(capital.lines.map((l: any) => l.amountCents)).toEqual([20_00, 20_00, -50_00])
  })

  it('a loan: what was owed, the payout and repayments, what is owed', async () => {
    const borrower = TEST_IDS.member
    const january = (await mine(borrower, '2026-01')).json.sections.find((s: any) => s.key === 'loan')
    expect(january).toMatchObject({ title: 'Loan LN-TEST-A', loanId: 'LN-TEST-A', openingCents: 0, closingCents: 1000_00 })
    expect(january.lines.map((l: any) => [l.date, l.amountCents])).toEqual([['2026-01-15', 1000_00]])
    const september = (await mine(borrower, '2026-09')).json.sections.find((s: any) => s.key === 'loan')
    expect(september).toMatchObject({ openingCents: 1000_00, closingCents: 900_00 })
    expect(september.lines.map((l: any) => [l.date, l.amountCents])).toEqual([['2026-09-10', -100_00]])
    // A quiet month still shows the loan, with nothing moving.
    const june = (await mine(borrower, '2026-06')).json.sections.find((s: any) => s.key === 'loan')
    expect(june).toMatchObject({ openingCents: 1000_00, closingCents: 1000_00, lines: [] })
  })

  it('reads the same when regenerated, and is final once its month is closed', async () => {
    const before = (await mine(M1, '2026-09')).json
    signInAs('finance')
    expect((await contribute(M1, '20', '2026-10-05')).status).toBe(201)
    expect((await mine(M1, '2026-09')).json).toEqual(before)

    await prisma.ledgerPeriod.upsert({ where: { period: '2026-09' }, update: { status: 'closed' }, create: { period: '2026-09', status: 'closed', closedAt: new Date() } })
    expect((await mine(M1, '2026-09')).json).toEqual({ ...before, final: true })
    expect((await mine(M1)).json.periods.find((p: any) => p.period === '2026-09').final).toBe(true)
  })

  it('a year is final once it has ended and all its months are closed', async () => {
    vi.setSystemTime(new Date('2027-02-10T18:00:00Z'))
    const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
    await prisma.ledgerPeriod.createMany({ data: months.slice(0, 11).map((period) => ({ period, status: 'closed', closedAt: new Date() })) })
    const year = async () => (await mine(M1)).json.periods.find((p: any) => p.period === '2026')
    expect(await year()).toEqual({ period: '2026', kind: 'year', label: 'Year 2026', final: false })
    await prisma.ledgerPeriod.create({ data: { period: '2026-12', status: 'closed', closedAt: new Date() } })
    expect((await year()).final).toBe(true)
    expect((await mine(M1)).json.periods.find((p: any) => p.period === '2027').label).toBe('Year 2027 (to date)')
  })

  it('staff see exactly what the member sees; nothing outside the offered periods', async () => {
    const member = (await mine(M1, '2026-09')).json
    signInAs('auditor')
    expect((await callRoute('members/[id]/statements/[period]', 'GET', { params: { id: M1, period: '2026-09' } })).json).toEqual(member)
    expect((await callRoute('members/[id]/statements', 'GET', { params: { id: M1 } })).json.periods).toHaveLength(11)
    expect((await callRoute('members/[id]/statements', 'GET', { params: { id: 'MC-NOBODY' } })).status).toBe(404)
    expect((await callRoute('members/[id]/statements/[period]', 'GET', { params: { id: 'MC-NOBODY', period: '2026-09' } })).status).toBe(404)
    for (const period of ['2025-12', '2026-11', '2026-13', '2025', '2027', 'september']) {
      expect((await mine(M1, period)).status, period).toBe(404)
    }
  })

  it('shows fees, held money and withdrawals to be paid only when there are any', async () => {
    // Money held for the member (2100) and a fee charged (1110), as the ledger would post them.
    await prisma.$transaction((tx) => postEntry(tx, {
      effectiveDate: '2026-10-01', type: 'adjustment', description: 'Overpayment held', idempotencyKey: 'test:held',
      // Two lines of one entry on one account show as one movement.
      lines: [{ account: '1000', debit: cents(50_00) }, { account: '2100', credit: cents(30_00), memberId: M1 }, { account: '2100', credit: cents(20_00), memberId: M1 }],
    }))
    await prisma.$transaction((tx) => postEntry(tx, {
      effectiveDate: '2026-10-02', type: 'fee', description: 'Late fee', idempotencyKey: 'test:fee',
      lines: [{ account: '1110', debit: cents(5_00), memberId: M1 }, { account: '4010', credit: cents(5_00) }],
    }))
    const october = (await mine(M1, '2026-10')).json.sections
    expect(october.map((s: any) => s.key)).toEqual(['capital', 'fees', 'held'])
    expect(october.find((s: any) => s.key === 'held')).toMatchObject({ title: 'Payments held for you', openingCents: 0, closingCents: 50_00, lines: [expect.objectContaining({ amountCents: 50_00 })] })
    expect(october.find((s: any) => s.key === 'fees')).toMatchObject({ title: 'Fees you owe', closingCents: 5_00 })
    // In September there were none, so neither shows.
    expect((await mine(M1, '2026-09')).json.sections.map((s: any) => s.key)).toEqual(['capital'])
  })
})
