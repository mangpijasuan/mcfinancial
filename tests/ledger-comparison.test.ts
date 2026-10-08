// Migration step M5 (docs/architecture/11 §1): money events post to the
// ledger in the transaction that records them (dual-write), and a nightly
// job compares the ledger with the old records.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signInAs, staffId } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createLoan, createMember } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { approveAccounts } from '@/modules/accounting/ledger'
import { checkOpening, postOpeningBalances } from '@/modules/accounting/opening'
import { postLegacyLoanNow, postWithdrawalNow } from '@/modules/accounting/legacyActivity'
import { compareLedger, comparisonStatus, runLedgerComparison } from '@/modules/accounting/comparison'
import { serviceDues } from '@/modules/contributions'
import { cents } from '@/lib/money'
import { sendEmail } from '@/lib/email'

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: vi.fn(async () => ({ ok: true })),
}))

const TODAY = '2026-09-30'

async function openLedger() {
  const codes = (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code)
  await prisma.$transaction((tx) => approveAccounts(tx, { codes, approvedBy: staffId('treasurer'), note: 'test chart approval' }))
  const inputs = { cutover: '2026-01-01', bankBalanceCents: cents(5000_00), confirmedLoanBalances: {} }
  const plan = await prisma.$transaction((tx) => checkOpening(tx, inputs))
  await prisma.$transaction((tx) => postOpeningBalances(tx, { ...inputs, bankBalanceCents: cents(5000_00), openingHash: plan.openingHash },
    { maker: { id: staffId('treasurer'), email: '' }, checker: { id: staffId('board'), email: '' } },
    { actorType: 'system', actorId: null, actorLabel: 'test', ip: null, userAgent: null, requestId: null } as never), { timeout: 60_000 })
}

let seq = 0
const contribution = (date: string, cents: number, extra: Record<string, unknown> = {}) => prisma.contribution.create({
  data: { transactionId: `CON-C${++seq}`, memberId: 'M1', memberName: 'M1', paymentDate: new Date(date), monthYear: 'x', amount: cents / 100, amountCents: BigInt(cents), source: 'outside', ...extra },
})

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures() // two loans made before the loan engine, 2026-01-15, $1,000 each
  await createMember('M1', { archiveLifetime: 1000, overallContributions: 1000 })
  delete process.env.LEDGER_ALERT_EMAIL
  delete process.env.SECURITY_ALERT_EMAIL
  vi.mocked(sendEmail).mockClear()
})
afterEach(() => {
  delete process.env.LEDGER_ALERT_EMAIL
  delete process.env.SECURITY_ALERT_EMAIL
})

describe('before opening balances', () => {
  it('there is nothing to compare', async () => {
    expect(await compareLedger(prisma, TODAY)).toBeNull()
    expect(await runLedgerComparison(prisma, TODAY)).toBeNull()
    signInAs('auditor')
    expect((await callRoute('ledger/comparison', 'GET')).json).toEqual({ started: false, target: 30 })
    signInAs('treasurer')
    expect((await callRoute('ledger/comparison', 'POST')).status).toBe(409)
  })

  it('withdrawals and repayments are not posted yet (they are part of the opening balances)', async () => {
    signInAs('finance')
    const w = await callRoute('withdrawals', 'POST', { body: { memberId: 'M1', amount: '50', withdrawalDate: '2026-09-20' } })
    expect(w.status).toBe(201)
    expect(w.json.journalEntry).toBeNull()
    expect((await callRoute('loan-payments', 'POST', { body: { loanId: 'LN-TEST-A', amount: 100, paymentDate: '2026-09-20' } })).status).toBe(201)
    expect(await prisma.journalEntry.count()).toBe(0)
  })
})

describe('dual-write', () => {
  beforeEach(async () => {
    // An older loan the loan engine cannot take over (a term over 30 years), so it stays on the old rules.
    await createLoan('LN-ODD', 'M1', { loanDate: new Date('2026-02-01'), loanAmount: 600, termMonths: 400, balanceRemaining: 600, monthlyDue: 1.5 })
    await openLedger()
  })

  it('posts a withdrawal and a repayment on an older loan in the same transaction', async () => {
    expect((await compareLedger(prisma, TODAY))!.ok).toBe(true)

    signInAs('finance')
    const w = await callRoute('withdrawals', 'POST', { body: { memberId: 'M1', amount: '50', withdrawalDate: '2026-09-20' } })
    expect(w.status).toBe(201)
    expect(w.json.journalEntry).toMatch(/^JE-/)
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { entryNumber: w.json.journalEntry }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
    expect(entry.lines.map((l) => [l.accountCode, Number(l.debitCents), Number(l.creditCents), l.memberId])).toEqual([['2000', 5000, 0, 'M1'], ['1000', 0, 5000, null]])

    expect((await callRoute('loan-payments', 'POST', { body: { loanId: 'LN-TEST-A', amount: 100, paymentDate: '2026-09-21', paymentMethod: 'Zelle' } })).status).toBe(201)
    const payment = await prisma.loanPayment.findFirstOrThrow({ where: { loanId: 'LN-TEST-A' } })
    expect(payment.journalEntry).toMatch(/^JE-/)

    // An older loan still on the old rules: posted the same way the daily job would.
    expect((await prisma.loan.findUniqueOrThrow({ where: { loanId: 'LN-ODD' } })).principalCents).toBeNull()
    const odd = await callRoute('loan-payments', 'POST', { body: { loanId: 'LN-ODD', amount: 100, paymentDate: '2026-09-22', paymentMethod: 'Cash' } })
    expect(odd.status).toBe(201)
    expect(odd.json.journalEntry).toMatch(/^JE-/)
    const oddPayment = await prisma.loanPayment.findFirstOrThrow({ where: { loanId: 'LN-ODD' } })
    const oddEntry = await prisma.journalEntry.findUniqueOrThrow({ where: { entryNumber: oddPayment.journalEntry! }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
    expect(oddEntry.idempotencyKey).toBe(`m4:loan-payment:${oddPayment.paymentId}`)
    expect(oddEntry.lines.map((l) => [l.accountCode, Number(l.debitCents), Number(l.creditCents)])).toEqual([['1030', 10000, 0], ['1100', 0, 10000]])

    // LN-TEST-A moved onto the loan engine with the opening balances: not an older loan any more.
    expect(await prisma.$transaction((tx) => postLegacyLoanNow(tx, 'LN-TEST-A'))).toEqual([])

    // A withdrawal dated before the cutover would be in neither the opening
    // balances (already posted) nor the capital since, so it is refused.
    const early = await callRoute('withdrawals', 'POST', { body: { memberId: 'M1', amount: '10', withdrawalDate: '2025-12-20' } })
    expect(early.status).toBe(400)
    expect(early.json.error).toMatch(/dated from the cutover \(2026-01-01\)/)
    // One that arrives some other way (a data import) is still never posted twice.
    await prisma.withdrawal.create({ data: { withdrawalId: 'WD-IMPORTED', memberId: 'M1', memberName: 'M1', amount: 10, withdrawalDate: new Date('2025-12-20') } })
    expect(await prisma.$transaction((tx) => postWithdrawalNow(tx, 'WD-IMPORTED'))).toBeNull()
    await prisma.withdrawal.delete({ where: { withdrawalId: 'WD-IMPORTED' } })

    // The records and the ledger agree; the daily job finds nothing left to post.
    const result = await compareLedger(prisma, TODAY)
    expect(result).toMatchObject({ ok: true, differences: 0 })
    expect((await serviceDues(TODAY)).journalEntries).toEqual([])
  })
})

describe('the nightly comparison', () => {
  beforeEach(openLedger)

  it('finds a record made outside the app until the daily job posts it, and alerts', async () => {
    await prisma.withdrawal.create({ data: { withdrawalId: 'WD-OUT', memberId: 'M1', memberName: 'M1', amount: 25, withdrawalDate: new Date('2026-09-25') } })
    process.env.SECURITY_ALERT_EMAIL = 'board@example.test'
    const run = await runLedgerComparison(prisma, TODAY)
    expect(run).toMatchObject({ ok: false, differences: 2, emailedTo: 'board@example.test' })
    expect(run!.details.memberCapital).toEqual([{ memberId: 'M1', name: 'Test Member M1', ledgerCents: 100000, legacyCents: 97500, differenceCents: 2500 }])
    expect(run!.details.unposted).toEqual([{ kind: 'withdrawal', id: 'WD-OUT', date: '2026-09-25', cents: 2500 }])
    expect(sendEmail).toHaveBeenCalledWith('board@example.test', 'Ledger comparison: 2 difference(s) on 2026-09-30', expect.stringContaining('Not in the ledger: withdrawal WD-OUT'))

    await serviceDues(TODAY)
    expect((await runLedgerComparison(prisma, TODAY))).toMatchObject({ ok: true, differences: 0, emailedTo: null })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('lists every kind of money record missing from the ledger, from the cutover to today', async () => {
    await contribution('2026-09-10', 20_00)
    await contribution('2025-12-20', 20_00) // before the cutover: in the opening balances
    await contribution('2026-12-01', 20_00) // after today: not yet
    await contribution('2026-09-11', 30_00, { journalEntry: 'JE-OUTSIDE', reversedAt: new Date('2026-09-12T15:00:00Z'), reversedBy: 'x', reversalReason: 'mistake' })
    await contribution('2025-11-11', 30_00, { journalEntry: 'JE-OLD', reversedAt: new Date('2025-11-12T15:00:00Z'), reversedBy: 'x', reversalReason: 'mistake' }) // before the cutover
    // Recorded and reversed before either reached the ledger: both are missing.
    await contribution('2026-09-18', 15_00, { reversedAt: new Date('2026-09-19T15:00:00Z'), reversedBy: 'x', reversalReason: 'duplicate' })
    // An older loan made and repaid outside the app after the cutover: both balances are zero, but the payout is missing.
    await createLoan('LN-OUTSIDE', 'M1', { loanDate: new Date('2026-09-05'), loanAmount: 300, termMonths: 3, balanceRemaining: 0, status: 'Paid Off', lifecycle: 'paid_off' })
    await prisma.loanPayment.create({ data: { paymentId: 'LP-OUT', loanId: 'LN-TEST-B', borrowerId: 'MC-TEST-B', borrowerName: 'B', paymentDate: new Date('2026-09-13'), amount: 40 } })
    const engine = (loanId: string, data: Record<string, unknown>) => prisma.loan.create({
      data: { loanId, borrowerId: 'M1', borrowerName: 'M1', loanDate: new Date('2026-09-01'), termMonths: 5, loanAmount: 500, monthlyDue: 100, balanceRemaining: 500, principalCents: BigInt(500_00), applicationFeeCents: BigInt(30_00), ...data },
    })
    await engine('LN-PAID', { lifecycle: 'disbursed', disbursedOn: new Date('2026-09-14') })
    await engine('LN-OFF', { lifecycle: 'charged_off', chargedOffOn: new Date('2026-09-15'), disbursementEntry: 'JE-X' })
    await prisma.loanFee.create({ data: { feeId: 'FEE-1', loanId: 'LN-OFF', installmentNumber: 1, amountCents: BigInt(5_00), assessedOn: new Date('2026-09-16') } })
    await prisma.loanFee.create({ data: { feeId: 'FEE-2', loanId: 'LN-OFF', installmentNumber: 2, amountCents: BigInt(5_00), assessedOn: new Date('2026-09-16'), journalEntry: 'JE-Y', status: 'waived', waivedOn: new Date('2026-09-17'), waivedAt: new Date(), waiverReason: 'goodwill' } })

    const result = (await compareLedger(prisma, TODAY))!
    expect(result.details.unposted.map((u) => [u.kind, u.date, u.cents])).toEqual([
      ['loan_payout', '2026-09-05', 30000],
      ['contribution', '2026-09-10', 2000],
      ['contribution_reversal', '2026-09-12', 3000],
      ['loan_payment', '2026-09-13', 4000],
      ['loan_payout', '2026-09-14', 0],
      ['loan_write_off', '2026-09-15', 50000],
      ['loan_fee', '2026-09-16', 500],
      ['loan_fee_waiver', '2026-09-17', 500],
      ['contribution', '2026-09-18', 1500],
      ['contribution_reversal', '2026-09-19', 1500],
    ])
    // The paid-out engine loan has no receivable in the ledger either.
    expect(result.details.loans.map((l) => l.loanId)).toEqual(['LN-PAID'])
    expect(result.differences).toBe(11)
    process.env.LEDGER_ALERT_EMAIL = 'treasurer@example.test'
    await runLedgerComparison(prisma, TODAY)
    expect(vi.mocked(sendEmail).mock.calls[0][2]).toContain('Loan LN-PAID (M1): ledger 0, records 500')
  })

  it('caps the alert at 50 items, and records the run even when the alert cannot be sent', async () => {
    for (let i = 0; i < 51; i++) await contribution(`2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, 1_00)
    process.env.LEDGER_ALERT_EMAIL = 'treasurer@example.test'
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: 'mail down' })
    const run = await runLedgerComparison(prisma, TODAY)
    expect(run).toMatchObject({ ok: false, differences: 51, emailedTo: null })
    expect(vi.mocked(sendEmail).mock.calls[0][2]).toContain('…and 1 more')
    expect(await prisma.ledgerComparison.count()).toBe(1)
    // Without an address, nobody is emailed.
    delete process.env.LEDGER_ALERT_EMAIL
    await runLedgerComparison(prisma, TODAY)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps every run as evidence and counts clean days', async () => {
    expect(await comparisonStatus(prisma, TODAY)).toMatchObject({ started: true, latest: null, history: [], streak: { days: 0 } })
    // Nightly runs, each made on its own day (06:45 in Chicago).
    for (const day of ['2026-09-28', '2026-09-29', '2026-09-30']) {
      await prisma.ledgerComparison.create({ data: { runDate: new Date(day), ranAt: new Date(`${day}T11:45:00Z`), ok: true, differences: 0, details: {} } })
    }
    // Backdated with --as-of today: shown, but proves nothing about that day.
    await runLedgerComparison(prisma, '2026-09-27')
    const status = await comparisonStatus(prisma, TODAY)
    expect(status).toMatchObject({ started: true, cutover: '2026-01-01', target: 30, streak: { days: 3, from: '2026-09-28', includesMonthEnd: true, met: false } })
    expect(status.started && status.latest).toMatchObject({ runDate: '2026-09-30', ok: true, differences: 0 })
    expect(status.started && status.history.map((h) => [h.runDate, h.backdated])).toEqual([['2026-09-30', false], ['2026-09-29', false], ['2026-09-28', false], ['2026-09-27', true]])
    const row = await prisma.ledgerComparison.findFirstOrThrow()
    await expect(prisma.ledgerComparison.update({ where: { id: row.id }, data: { ok: false } })).rejects.toThrow(/cannot be changed or deleted/)
    await expect(prisma.ledgerComparison.delete({ where: { id: row.id } })).rejects.toThrow(/cannot be changed or deleted/)
    await expect(prisma.$executeRawUnsafe('TRUNCATE "LedgerComparison"')).rejects.toThrow(/cannot be changed or deleted/)
  })

  it('can be run from the Ledger page by someone who manages the books, and is audited', async () => {
    signInAs('treasurer')
    const marker = await auditMarker()
    const res = await callRoute('ledger/comparison', 'POST')
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ started: true, latest: { ok: true } })
    expect((await auditEntriesSince(marker)).map((a) => a.action)).toEqual(['ledger.comparison.run'])
    signInAs('auditor')
    expect((await callRoute('ledger/comparison', 'GET')).json.history).toHaveLength(1)
  })
})
