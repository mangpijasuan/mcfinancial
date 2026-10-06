// Financial reports from the ledger (product map: Admin → Reports): the
// balance sheet and loan portfolio as of a date, the income statement and
// cash flow for a range. Access by role is in the authorization matrix.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signInAs, signInAsMember, staffId } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createMember, recordBankBalance } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { type LineInput, approveAccounts, postEntry } from '@/modules/accounting/ledger'
import { checkOpening, postOpeningBalances } from '@/modules/accounting/opening'
import { reportDate, reportRange } from '@/modules/accounting/reports'
import { cents } from '@/lib/money'

const BORROWER = 'MC-RPT-B'
const COSIGNER = 'MC-RPT-C'

async function setToday(date: string) {
  vi.setSystemTime(new Date(`${date}T18:00:00Z`))
  await prisma.staffSession.updateMany({ data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) } })
}

async function openLedger() {
  const codes = (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code)
  await prisma.$transaction((tx) => approveAccounts(tx, { codes, approvedBy: staffId('treasurer'), note: 'test chart approval' }))
  const inputs = { cutover: '2026-01-01', bankBalanceCents: cents(5000_00), confirmedLoanBalances: {} }
  const plan = await prisma.$transaction((tx) => checkOpening(tx, inputs))
  await prisma.$transaction((tx) => postOpeningBalances(tx, { ...inputs, openingHash: plan.openingHash },
    { maker: { id: staffId('treasurer'), email: '' }, checker: { id: staffId('board'), email: '' } },
    { actorType: 'system', actorId: null, actorLabel: 'test', ip: null, userAgent: null, requestId: null } as never), { timeout: 60_000 })
}

const post = (key: string, effectiveDate: string, type: 'expense' | 'fee' | 'adjustment' | 'deposit', lines: LineInput[]) =>
  prisma.$transaction((tx) => postEntry(tx, { effectiveDate, type, description: key, idempotencyKey: `test:${key}`, lines }))

const report = async (name: string, query: string) => {
  signInAs('auditor')
  const res = await callRoute(`reports/${name}`, 'GET', { query })
  expect(res.status, `${name}?${query}`).toBe(200)
  return res.json
}
const line = (rows: any[], code: string) => rows.find((r: any) => r.code === code)?.amountCents

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  await createMember(BORROWER, { monthsActive: 24, archiveLifetime: 2000, contributions2026: 180 })
  await createMember(COSIGNER, { monthsActive: 24, archiveLifetime: 2000 })
  vi.useFakeTimers({ toFake: ['Date'] })
  await setToday('2026-01-15')
  await recordBankBalance(50_000_00, '2026-01-15')
  await openLedger()
})
afterEach(() => vi.useRealTimers())

describe('dates', () => {
  it('as of today unless a date is given; a range defaults to the year to date', async () => {
    expect(reportDate(null, '2026-05-01')).toBe('2026-05-01')
    expect(reportDate('2026-03-31', '2026-05-01')).toBe('2026-03-31')
    expect(reportDate('soon', '2026-05-01')).toBeNull()
    expect(reportRange(null, null, '2026-05-01')).toEqual({ from: '2026-01-01', to: '2026-05-01' })
    expect(reportRange(null, '2025-06-30', '2026-05-01')).toEqual({ from: '2025-01-01', to: '2025-06-30' })
    expect(reportRange('2026-02-01', '2026-02-28', '2026-05-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(reportRange('2026-03-01', '2026-02-01', '2026-05-01')).toBeNull()
    expect(reportRange('march', null, '2026-05-01')).toBeNull()
    expect(reportRange(null, 'march', '2026-05-01')).toBeNull()

    signInAs('auditor')
    for (const [name, query] of [['balance-sheet', 'asOf=2026-13-01'], ['loan-portfolio', 'asOf=today'], ['income-statement', 'from=2026-03-01&to=2026-02-01'], ['cash-flow', 'to=soon']]) {
      expect((await callRoute(`reports/${name}`, 'GET', { query })).status, name).toBe(400)
    }
    expect((await callRoute('reports/cash-flow', 'GET')).json).toMatchObject({ from: '2026-01-01', to: '2026-01-15' })
  })
})

describe('balance sheet and income statement', () => {
  beforeEach(async () => {
    await setToday('2026-03-01')
    await post('hosting', '2026-01-20', 'expense', [{ account: '5010', debit: cents(30_00) }, { account: '1000', credit: cents(30_00) }])
    await post('late-fee', '2026-01-21', 'fee', [{ account: '1110', debit: cents(5_00), memberId: BORROWER }, { account: '4010', credit: cents(5_00) }])
    await post('allowance', '2026-01-22', 'adjustment', [{ account: '5100', debit: cents(100_00) }, { account: '1190', credit: cents(100_00) }])
  })

  it('at the cutover: the opening balances, assets equal to liabilities and equity', async () => {
    const sheet = await report('balance-sheet', 'asOf=2025-12-31')
    expect(sheet).toMatchObject({ asOf: '2025-12-31', balanced: true })
    expect(line(sheet.assets, '1000')).toBe(5000_00)
    expect(line(sheet.liabilities, '2000')).toBeGreaterThan(0)
    expect(sheet.equity.find((r: any) => r.code === '')).toBeUndefined() // no income or expenses yet
    expect(sheet.totalAssetsCents).toBe(sheet.totalLiabilitiesCents + sheet.totalEquityCents)
  })

  it('later: income less expenses shows as surplus, and an allowance reduces the assets', async () => {
    const before = await report('balance-sheet', 'asOf=2026-01-19')
    const after = await report('balance-sheet', 'asOf=2026-01-31')
    expect(after.balanced).toBe(true)
    expect(line(after.assets, '1190')).toBe(-100_00)
    expect(line(after.assets, '1110')).toBe(5_00)
    expect(line(after.assets, '1000')).toBe(line(before.assets, '1000') - 30_00)
    expect(after.equity.at(-1)).toEqual({ code: '', name: 'Surplus to date (income less expenses)', amountCents: -125_00 })
    expect(after.totalAssetsCents).toBe(before.totalAssetsCents - 125_00)
  })

  it('the income statement covers only its range', async () => {
    expect(await report('income-statement', 'from=2026-01-01&to=2026-01-31')).toEqual({
      from: '2026-01-01', to: '2026-01-31',
      income: [{ code: '4010', name: expect.any(String), amountCents: 5_00 }],
      expenses: [{ code: '5010', name: expect.any(String), amountCents: 30_00 }, { code: '5100', name: expect.any(String), amountCents: 100_00 }],
      totalIncomeCents: 5_00, totalExpensesCents: 130_00, surplusCents: -125_00,
    })
    expect(await report('income-statement', 'from=2026-01-21&to=2026-02-28')).toMatchObject({ totalIncomeCents: 5_00, totalExpensesCents: 100_00, surplusCents: -95_00 })
    expect(await report('income-statement', 'from=2026-02-01&to=2026-02-28')).toMatchObject({ income: [], expenses: [], surplusCents: 0 })
  })
})

describe('cash flow', () => {
  it('from the cash at the start, every kind of money in and out, to the cash at the end', async () => {
    const opening = await report('cash-flow', 'from=2025-12-01&to=2025-12-31')
    expect(opening).toMatchObject({ openingCents: 0, closingCents: 5000_00, netCents: 5000_00, internalMoves: 0 })
    expect(opening.rows).toEqual([{ type: 'opening_balance', label: 'Opening balances (cutover)', entries: 1, inflowCents: 5000_00, outflowCents: 0, netCents: 5000_00 }])

    await setToday('2026-03-01')
    signInAs('finance')
    expect((await callRoute('contributions', 'POST', { body: { memberId: BORROWER, amount: '20', paymentDate: '2026-02-10', paymentMethod: 'Cash', receivedBy: 'Fin' } })).status).toBe(201)
    await post('deposit', '2026-02-12', 'deposit', [{ account: '1000', debit: cents(20_00) }, { account: '1030', credit: cents(20_00) }])
    await post('hosting', '2026-02-20', 'expense', [{ account: '5010', debit: cents(30_00) }, { account: '1000', credit: cents(30_00) }])
    await post('interest', '2026-02-21', 'adjustment', [{ account: '1000', debit: cents(7_00) }, { account: '4900', credit: cents(7_00) }])
    await post('fee-in-cash', '2026-02-22', 'fee', [{ account: '1000', debit: cents(2_00) }, { account: '4010', credit: cents(2_00) }])

    const feb = await report('cash-flow', 'from=2026-02-01&to=2026-02-28')
    expect(feb.rows.map((r: any) => [r.label, r.inflowCents, r.outflowCents])).toEqual([
      ['Contributions received', 20_00, 0],
      ['Expenses paid', 0, 30_00],
      // Kinds without a line of their own come last, alphabetically.
      ['Other (adjustment)', 7_00, 0],
      ['Other (fee)', 2_00, 0],
    ])
    expect(feb).toMatchObject({ netCents: -1_00, internalMoves: 1 })
    expect(feb.closingCents).toBe(feb.openingCents + feb.netCents)
    // The cash accounts add up, and match the balance sheet.
    const sheet = await report('balance-sheet', 'asOf=2026-02-28')
    for (const a of feb.accounts) expect(a.closingCents, a.code).toBe(line(sheet.assets, a.code) ?? 0)
    expect(feb.accounts.find((a: any) => a.code === '1030')).toMatchObject({ openingCents: 0, closingCents: 0 })
  })
})

describe('loan portfolio and aging', () => {
  async function engineLoan() {
    signInAs('admin')
    const res = await callRoute('loans', 'POST', { body: { borrowerId: BORROWER, cosignerId: COSIGNER, loanAmount: '1000', termMonths: 3, loanDate: '2026-01-15' } })
    expect(res.status).toBe(201)
    const loanId = res.json.loanId as string
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
    return loanId
  }

  it('each loan owed on the date, how late it was then, and the totals by lateness', async () => {
    const loanId = await engineLoan()
    const loan = await prisma.loan.findUniqueOrThrow({ where: { loanId }, include: { installments: { orderBy: { number: 'asc' } } } })
    const first = Number(loan.installments[0].principalCents)
    expect(loan.installments[0].dueDate.toISOString().slice(0, 10)).toBe('2026-02-10')

    const portfolio = (asOf: string) => report('loan-portfolio', `asOf=${asOf}`)
    let p = await portfolio('2026-01-31')
    // The base fixtures' older loans were moved onto the loan engine with the opening balances.
    expect(p.loans.map((l: any) => [l.loanId, l.bucket, l.daysPastDue])).toEqual([[loanId, 'current', 0], ['LN-TEST-A', 'current', 0], ['LN-TEST-B', 'current', 0]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    expect(p.loans.find((l: any) => l.loanId === loanId)).toMatchObject({ borrowerId: BORROWER, borrowerName: expect.any(String), loanDate: '2026-01-15', outstandingCents: 1000_00, overdueCents: 0 })
    expect(p.totalOutstandingCents).toBe(line((await report('balance-sheet', 'asOf=2026-01-31')).assets, '1100'))
    expect(p.buckets.map((b: any) => [b.key, b.count])).toEqual([['current', 3], ['d1_30', 0], ['d31_60', 0], ['d61_90', 0], ['d90_plus', 0]])

    // A late fee on the first installment, waived two days later, then the installment is paid.
    await setToday('2026-03-05')
    await prisma.loanFee.create({ data: { feeId: 'FEE-RPTTEST01', loanId, installmentNumber: 1, amountCents: BigInt(5_00), assessedOn: new Date('2026-02-20') } })
    await prisma.loanFee.update({ where: { feeId: 'FEE-RPTTEST01' }, data: { status: 'waived', waivedOn: new Date('2026-02-22'), waivedAt: new Date(), waiverReason: 'test' } })
    signInAs('finance')
    expect((await callRoute('loan-payments', 'POST', { body: { loanId, amount: (first / 100).toFixed(2), paymentDate: '2026-02-25', paymentMethod: 'Cash' } })).status).toBe(201)

    // Each date sees only what had happened by then.
    const engine = async (asOf: string) => (await portfolio(asOf)).loans.find((l: any) => l.loanId === loanId)
    expect(await engine('2026-02-18')).toMatchObject({ bucket: 'd1_30', daysPastDue: 8, overdueCents: first })
    expect(await engine('2026-02-21')).toMatchObject({ daysPastDue: 11, overdueCents: first }) // charged, not yet waived
    expect(await engine('2026-02-23')).toMatchObject({ daysPastDue: 13, overdueCents: first }) // waived, not yet paid
    p = await portfolio('2026-02-26')
    expect(p.loans.find((l: any) => l.loanId === loanId)).toMatchObject({ bucket: 'current', daysPastDue: 0, overdueCents: 0, outstandingCents: 1000_00 - first })
    expect(p.totalOutstandingCents).toBe(line((await report('balance-sheet', 'asOf=2026-02-26')).assets, '1100'))

    // Months later nothing more has been paid.
    await setToday('2026-06-30')
    p = await portfolio('2026-06-30')
    // The latest lead the list: the fixtures' loans fell due earlier than this one's second installment.
    expect(p.loans.map((l: any) => l.bucket)).toEqual(['d90_plus', 'd90_plus', 'd90_plus'])
    expect(p.loans.at(-1)).toMatchObject({ loanId, daysPastDue: 112 })
    expect(p.buckets.find((b: any) => b.key === 'd90_plus')).toMatchObject({ count: 3, outstandingCents: p.totalOutstandingCents })
  })

  it('31–60 and 61–90 days late', async () => {
    const loanId = await engineLoan()
    await setToday('2026-06-30')
    const bucket = async (asOf: string) => (await report('loan-portfolio', `asOf=${asOf}`)).loans.find((l: any) => l.loanId === loanId)
    expect(await bucket('2026-03-20')).toMatchObject({ bucket: 'd31_60', daysPastDue: 38 })
    expect(await bucket('2026-04-20')).toMatchObject({ bucket: 'd61_90', daysPastDue: 69 })
  })
})
