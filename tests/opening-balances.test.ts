// Opening balances (migration step M4, docs/architecture/11 §1): the
// report, posting with a second person, the replay of activity since the
// cutover, moving matching older loans onto the loan engine, and the
// catch-up afterwards.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signInAs, staffId } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createLoan, createMember, recordBankBalance } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { accountBalance, approveAccounts, checkInvariants, trialBalance } from '@/modules/accounting/ledger'
import { OPENING_KEYS, checkOpening, ledgerOpening, planOpening, postLegacyActivity, reconcile } from '@/modules/accounting/opening'
import { postPendingLoanEntries } from '@/modules/loans/postings'
import { serviceDues } from '@/modules/contributions'
import { treasuryPosition } from '@/modules/treasury'
import { cents } from '@/lib/money'

const approve = (id: string) => callRoute('approvals/[id]/approve', 'POST', { params: { id }, body: {} })

/** HL-T1, an older loan still marked Active: the Treasurer finds it was repaid (M9). */
async function settleOlderLoan() {
  signInAs('treasurer')
  const hl = await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId: 'HL-T1' } })
  expect((await callRoute('loan-history/[id]/link', 'POST', { params: { id: hl.id }, body: { role: 'borrower', memberId: null } })).status).toBe(200)
  expect((await callRoute('loan-history/[id]/confirm', 'POST', { params: { id: hl.id }, body: { balance: '0', asOf: '2025-12-31' } })).json).toMatchObject({ loanId: null })
}

async function approveChart() {
  const codes = (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code)
  await prisma.$transaction((tx) => approveAccounts(tx, { codes, approvedBy: staffId('treasurer'), note: 'test chart approval' }))
}

let seq = 0
const contribution = (memberId: string, date: string, amount: number) => prisma.contribution.create({
  data: { transactionId: `CON-T${++seq}`, memberId, memberName: memberId, paymentDate: new Date(date), monthYear: 'x', amount, amountCents: BigInt(Math.round(amount * 100)), source: 'import' },
})
const payment = (loanId: string, borrowerId: string, date: string, amount: number, method = 'Cash') => prisma.loanPayment.create({
  data: { paymentId: `LP-T${++seq}`, loanId, borrowerId, borrowerName: borrowerId, paymentDate: new Date(date), amount, paymentMethod: method },
})

/**
 * A small club at the cutover (2026-01-01):
 * - M1: $1,000 archive, two 2026 contributions and one dated in 2027 (F-10).
 * - M2: $500 archive, one 2025 contribution (already in the archive?), a 2026 withdrawal.
 * - LPRE (M1): $1,200 / 12 from 2025-06; six $100 repayments in 2025, two in 2026 → $400 left.
 * - LBAD (M2): $900 / 9 from 2025-09; $100 repaid in 2025, but the record still says $900.
 * - LPOST (M2): $600 / 6 from 2026-02; $100 repaid → $500.
 */
async function club() {
  await createMember('M1', { archiveLifetime: 1000, overallContributions: 1060 })
  await createMember('M2', { archiveLifetime: 500, overallContributions: 520 })
  await contribution('M1', '2026-02-10', 20)
  await contribution('M1', '2026-03-10', 20)
  await contribution('M1', '2027-01-10', 20)
  await contribution('M2', '2025-12-20', 20)
  await prisma.withdrawal.create({ data: { withdrawalId: 'WD-T1', memberId: 'M2', memberName: 'M2', amount: 100, withdrawalDate: new Date('2026-03-01') } })

  await createLoan('LPRE', 'M1', { loanDate: new Date('2025-06-05'), loanAmount: 1200, termMonths: 12, balanceRemaining: 400 })
  for (const m of ['07', '08', '09', '10', '11', '12']) await payment('LPRE', 'M1', `2025-${m}-10`, 100)
  await payment('LPRE', 'M1', '2026-01-10', 100, 'Zelle')
  await payment('LPRE', 'M1', '2026-02-10', 100, 'Zelle')
  await createLoan('LBAD', 'M2', { loanDate: new Date('2025-09-01'), loanAmount: 900, termMonths: 9, balanceRemaining: 900 })
  await payment('LBAD', 'M2', '2025-10-10', 100)
  await createLoan('LPOST', 'M2', { loanDate: new Date('2026-02-01'), loanAmount: 600, termMonths: 6, balanceRemaining: 500 })
  await payment('LPOST', 'M2', '2026-03-10', 100)
  await createLoan('LOLD', 'M1', { loanDate: new Date('2024-02-01'), loanAmount: 300, termMonths: 3, balanceRemaining: 0, status: 'Paid Off', lifecycle: 'paid_off' })
  await payment('LOLD', 'M1', '2024-05-10', 300)
  await prisma.historicalLoan.create({ data: { loanId: 'HL-T1', year: 2024, borrowerName: 'Somebody', loanDate: new Date('2024-03-01'), loanAmount: 800, balanceRemaining: 300, status: 'Active' } })
}

const inputs = (bank: number | null = 5000) => ({ cutover: '2026-01-01', bankBalanceCents: bank === null ? null : cents(bank * 100), confirmedLoanBalances: {} })

beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures() // adds two loans made 2026-01-15 with nothing repaid
  await club()
})

describe('the report', () => {
  it('shows the opening position, what to review, and the differences with the old records', async () => {
    signInAs('auditor')
    const res = await callRoute('ledger/opening', 'GET', { query: 'bankBalance=5000' })
    expect(res.status).toBe(200)
    const r = res.json
    expect(r).toMatchObject({ cutover: '2026-01-01', openingDate: '2025-12-31', posted: null, bankCents: 500000 })
    expect(r.memberCapital).toEqual({ members: 2, totalCents: 150000 })
    expect(r.loansAtCutover.map((l: any) => [l.loanId, l.balanceCents, l.source])).toEqual([['LBAD', 80000, 'derived'], ['LPRE', 60000, 'derived']])
    expect(r.openingEquityCents).toBe(500000 + 140000 - 150000)
    expect(r.anomalies.map((a: any) => a.code)).toEqual(expect.arrayContaining([
      'contribution_before_cutover', 'contribution_future_dated', 'historical_loans_unconfirmed',
    ]))
    expect(r.checks.loans).toEqual([expect.objectContaining({ loanId: 'LBAD', ledgerCents: 80000, legacyCents: 90000 })])
    // M1: 1000 + 60 = 1060 ✓. M2: 500 − 100 = 400 in the ledger, but the record (520 − 100) counts the 2025 contribution.
    expect(r.checks.memberCapital).toEqual([expect.objectContaining({ memberId: 'M2', ledgerCents: 40000, legacyCents: 42000 })])
    expect(r.adoption.adopt).toEqual(expect.arrayContaining(['LPRE', 'LPOST', 'LN-TEST-A']))
    expect(r.adoption.keepLegacy).toEqual([expect.objectContaining({ loanId: 'LBAD' })])
    expect(r.replay.withdrawals).toEqual({ count: 1, totalCents: 10000 })
    expect(r.replay.loanDisbursements.count).toBe(3) // LPOST and the two base loans
    expect(r.replay.loanRepayments).toEqual({ count: 3, totalCents: 30000 })

    const noBank = (await callRoute('ledger/opening', 'GET')).json
    expect(noBank.anomalies.map((a: any) => a.code)).toContain('bank_balance_missing')
    expect((await callRoute('ledger/opening', 'GET', { query: 'cutover=2026-13-01' })).status).toBe(400)
    expect((await callRoute('ledger/opening', 'GET', { query: 'bankBalance=lots' })).status).toBe(400)
  })

  it('uses a confirmed balance in place of the derived one', async () => {
    const plan = await planOpening(prisma, { ...inputs(), confirmedLoanBalances: { LBAD: cents(90000), NOPE: cents(1) } })
    expect(plan.report.loansAtCutover.find((l) => l.loanId === 'LBAD')).toMatchObject({ balanceCents: 90000, source: 'confirmed', derivedCents: 80000 })
    expect(plan.report.checks.loans).toEqual([])
    expect(plan.report.adoption.keepLegacy[0].reason).toMatch(/confirmed balance differs/)
    expect(plan.report.anomalies.map((a) => a.code)).toContain('confirmed_unknown_loan')
  })
})

describe('posting', () => {
  it('needs an approved chart, the bank balance, confirmation, and a second person', async () => {
    signInAs('treasurer')
    const body = { cutover: '2026-01-01', bankBalance: '5000', confirmLoans: true }
    expect((await callRoute('ledger/opening', 'POST', { body: { ...body, confirmLoans: false } })).status).toBe(400)
    expect((await callRoute('ledger/opening', 'POST', { body: { ...body, bankBalance: '' } })).status).toBe(400)
    expect((await callRoute('ledger/opening', 'POST', { body })).status).toBe(422) // chart still proposed
    await approveChart()
    const older = await callRoute('ledger/opening', 'POST', { body })
    expect(older.status).toBe(422) // HL-T1 marked Active, balance not confirmed (M9)
    expect(older.json.error).toContain('HL-T1')
    await settleOlderLoan()
    const queued = await callRoute('ledger/opening', 'POST', { body })
    expect(queued.status).toBe(202)
    expect(await prisma.journalEntry.count()).toBe(0)
    const { id } = queued.json.approvalRequest
    expect((await approve(id)).json.code).toBe('maker_is_checker')
    signInAs('loan_officer')
    expect((await approve(id)).status).toBe(403)
    signInAs('board')
    expect((await approve(id)).json.status).toBe('approved')

    // The books: balanced, invariants hold, 9000 holds (cash + loans) − capital.
    expect((await trialBalance(prisma)).balanced).toBe(true)
    expect(await checkInvariants(prisma)).toEqual({ ok: true, problems: [] })
    expect((await accountBalance(prisma, '9000')).balance).toBe(490000)
    expect(await ledgerOpening(prisma)).toMatchObject({ cutover: '2026-01-01' })
    // Older loans had to be confirmed before: afterwards it is refused (M9).
    const late = await prisma.historicalLoan.create({ data: { loanId: 'HL-T2', year: 2025, borrowerName: 'Test Member M1', borrowerId: 'M1', borrowerLink: 'reviewed', loanDate: new Date('2025-01-01'), loanAmount: 100, balanceRemaining: 100, status: 'Active' } })
    signInAs('treasurer')
    expect((await callRoute('loan-history/[id]/confirm', 'POST', { params: { id: late.id }, body: { balance: '100', asOf: '2025-12-31' } })).status).toBe(409)
    expect((await callRoute('loan-history/review', 'GET')).json.openingPosted).toBe(true)
    await prisma.historicalLoan.delete({ where: { id: late.id } })
    const capital = await prisma.journalLine.groupBy({ by: ['memberId'], where: { accountCode: '2000' }, _sum: { creditCents: true, debitCents: true } })
    const net = Object.fromEntries(capital.map((g) => [g.memberId, Number(g._sum.creditCents) - Number(g._sum.debitCents)]))
    expect(net).toMatchObject({ M1: 106000, M2: 40000 })

    // Matching older loans moved onto the engine, with nothing posted twice.
    const lpre = await prisma.loan.findUniqueOrThrow({ where: { loanId: 'LPRE' }, include: { installments: true, payments: true } })
    expect(lpre).toMatchObject({ principalCents: BigInt(120000), policyVersion: 'legacy-import-2026', lifecycle: 'disbursed' })
    expect(lpre.installments).toHaveLength(12)
    expect(lpre.payments.every((p) => p.journalEntry)).toBe(true)
    expect(await prisma.$transaction((tx) => postPendingLoanEntries(tx, 'LPRE'))).toEqual([])
    expect((await prisma.loan.findUniqueOrThrow({ where: { loanId: 'LBAD' } })).principalCents).toBeNull()

    // The report now compares the actual ledger; only the known differences remain.
    signInAs('auditor')
    const after = (await callRoute('ledger/opening', 'GET')).json
    expect(after.posted).toMatchObject({ cutover: '2026-01-01' })
    expect(after.checks.loans.map((c: any) => c.loanId)).toEqual(['LBAD'])
    expect(after.checks.memberCapital.map((c: any) => c.memberId)).toEqual(['M2'])

    signInAs('treasurer')
    expect((await callRoute('ledger/opening', 'POST', { body })).status).toBe(409)
  })

  it('refuses the approval if records before the cutover changed after proposing', async () => {
    await approveChart()
    await settleOlderLoan()
    signInAs('treasurer')
    const { id } = (await callRoute('ledger/opening', 'POST', { body: { bankBalance: '5000', confirmLoans: true } })).json.approvalRequest
    await payment('LBAD', 'M2', '2025-11-10', 100)
    signInAs('board')
    const res = await approve(id)
    expect(res.status).toBe(409)
    expect(res.json.error).toMatch(/changed after this was proposed/)
    expect(await prisma.journalEntry.count()).toBe(0)
  })

  it('keeps posting what happens afterwards, once, from the daily job', async () => {
    await approveChart()
    await settleOlderLoan()
    // A loan already on the loan engine (approved, not paid out yet).
    await createMember('MC-ENG', { monthsActive: 24, archiveLifetime: 2000, overallContributions: 2000 })
    await recordBankBalance(5000_00, '2025-12-31') // the lending capacity before the ledger holds cash (A10)
    const { createLoan: createEngineLoan } = await import('@/modules/loans/create')
    await prisma.$transaction((tx) => createEngineLoan(tx, {
      borrowerId: 'MC-ENG', cosignerId: null, loanAmount: 500, termMonths: 5, loanDate: '2026-09-01', notes: null, borrowerAddress: null, borrowerCity: null, borrowerState: null,
    }, { maker: { id: staffId('treasurer'), email: '' }, checker: null }, { actorType: 'system', actorId: null, actorLabel: 'test' } as never))
    const plan = await prisma.$transaction((tx) => checkOpening(tx, inputs()))
    const { postOpeningBalances } = await import('@/modules/accounting/opening')
    await prisma.$transaction((tx) => postOpeningBalances(tx, { ...inputs(), bankBalanceCents: cents(500000), openingHash: plan.openingHash },
      { maker: { id: staffId('treasurer'), email: '' }, checker: { id: staffId('board'), email: '' } },
      { actorType: 'system', actorId: null, actorLabel: 'test', ip: null, userAgent: null, requestId: null } as never), { timeout: 60_000 })

    await prisma.withdrawal.create({ data: { withdrawalId: 'WD-T2', memberId: 'M1', memberName: 'M1', amount: 50, withdrawalDate: new Date('2026-09-01'), type: 'Full Exit' } })
    // Treasury (A10): the ledger now holds the cash; the withdrawal the
    // daily job has not posted yet already counts as paid out.
    // Dated after the day asked about: not part of that day's position.
    await prisma.withdrawal.create({ data: { withdrawalId: 'WD-T3', memberId: 'M2', memberName: 'M2', amount: 30, withdrawalDate: new Date('2026-12-01') } })
    const before = await treasuryPosition(prisma, '2026-09-20')
    expect(before.cash.source).toBe('ledger')
    if (before.cash.source !== 'ledger') throw new Error('unreachable')
    expect(before.cash.unpostedWithdrawalsCents).toBe(5000)
    // As of that day: the contribution dated 2027 is in the ledger but not yet.
    const ledgerCash = (await Promise.all(['1000', '1010', '1020', '1030'].map((code) => accountBalance(prisma, code, { asOf: '2026-09-20' })))).reduce((t, b) => t + b.balance, 0)
    expect(before.cash.cents).toBe(ledgerCash - 5000)
    expect(before.memberCapitalCents).toBe((await accountBalance(prisma, '2000', { asOf: '2026-09-20' })).balance)
    expect(before.memberCapitalCents).toBe((await accountBalance(prisma, '2000')).balance - 2000)
    expect(before.committed.loans.map((l) => [l.borrowerName, l.payoutCents])).toEqual([[expect.any(String), 50000 - 3000]])

    await payment('LBAD', 'M2', '2026-09-10', 100)
    await payment('LBAD', 'M2', '2026-09-11', 800) // $700 left: $100 beyond the balance
    await payment('LBAD', 'M2', '2026-09-12', 50) // nothing left: all unapplied
    await payment('LBAD', 'M2', '2026-09-13', 0) // ignored
    await contribution('M2', '2026-09-12', 20) // recorded outside the app: no receipt
    const run = await serviceDues()
    expect(run.errors).toEqual([])
    expect(run.journalEntries.length).toBeGreaterThanOrEqual(3)
    expect(await prisma.journalEntry.findUnique({ where: { idempotencyKey: 'withdrawal:WD-T2' } })).not.toBeNull()
    const after = await treasuryPosition(prisma, '2026-09-20')
    expect(after.cash.source === 'ledger' && after.cash.unpostedWithdrawalsCents).toBe(0)
    // WD-T3 is now in the ledger, dated in December: still not in September's cash or capital.
    expect(await prisma.journalEntry.findUnique({ where: { idempotencyKey: 'withdrawal:WD-T3' } })).not.toBeNull()
    const septemberCash = (await Promise.all(['1000', '1010', '1020', '1030'].map((code) => accountBalance(prisma, code, { asOf: '2026-09-20' })))).reduce((t, b) => t + b.balance, 0)
    expect(after.cash.cents).toBe(septemberCash)
    expect(after.memberCapitalCents).toBe((await accountBalance(prisma, '2000', { asOf: '2026-09-20' })).balance)
    expect((await treasuryPosition(prisma, '2026-12-31')).memberCapitalCents).toBe(after.memberCapitalCents - 3000)
    expect((await serviceDues()).journalEntries).toEqual([])
    expect(await prisma.$transaction((tx) => postLegacyActivity(tx))).toEqual([])
    expect(await checkInvariants(prisma)).toEqual({ ok: true, problems: [] })
    expect((await reconcile(prisma))!.loans.map((l) => l.loanId)).toEqual(['LBAD'])
    // The $50 after the loan was cleared (the third-last record created) is all unapplied.
    const overpaid = await prisma.journalEntry.findUniqueOrThrow({ where: { idempotencyKey: `m4:loan-payment:LP-T${seq - 2}` }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
    expect(overpaid.lines.map((l) => [l.accountCode, Number(l.debitCents), Number(l.creditCents)])).toEqual([['1030', 5000, 0], ['2100', 0, 5000]])

    // A failing ledger step is reported, not fatal.
    const original = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((fn: any, opts: any) => (opts ? Promise.reject(new Error('ledger down')) : original(fn))) as never)
    const failed = await serviceDues()
    spy.mockRestore()
    expect(failed.errors).toContainEqual({ memberId: 'ledger', error: 'ledger down' })
  })
})

describe('edge cases', () => {
  it('reports odd records, an overdraft, and refuses when there is nothing to open', async () => {
    await prisma.member.update({ where: { id: 'M2' }, data: { archiveLifetime: -5 } })
    await prisma.member.update({ where: { id: 'M1' }, data: { archiveLifetime: 1000.004 } })
    await payment('LPRE', 'M1', '2025-12-20', 900) // overpaid before the cutover
    await prisma.contribution.create({ data: { transactionId: 'CON-ZERO', memberId: 'M1', memberName: 'M1', paymentDate: new Date('2026-04-01'), monthYear: 'x', amount: 0, amountCents: BigInt(0), source: 'import' } }).catch(() => null)
    await prisma.withdrawal.create({ data: { withdrawalId: 'WD-OLD', memberId: 'M1', memberName: 'M1', amount: 10, withdrawalDate: new Date('2025-11-01') } })
    await payment('LPOST', 'M2', '2026-01-20', 50) // before the loan was made
    await createLoan('LX1', 'M1', { loanAmount: 1000.005, balanceRemaining: 1000.005 })
    await createLoan('LX2', 'M1', { termMonths: 400 })
    await createLoan('LX3', 'M1', {})
    await payment('LX3', 'M1', '2027-02-10', 100)
    await createLoan('LX4', 'M1', {})
    await payment('LX4', 'M1', '2026-02-10', 100.005)
    await createLoan('LX5', 'M1', { balanceRemaining: 0 })
    await payment('LX5', 'M1', '2026-02-10', 1000)
    const plan = await planOpening(prisma, inputs(-250))
    const reasons = Object.fromEntries(plan.report.adoption.keepLegacy.map((k) => [k.loanId, k.reason]))
    expect(reasons).toMatchObject({
      LX1: expect.stringMatching(/whole number of cents/), LX2: expect.stringMatching(/1–360/), LX3: expect.stringMatching(/future/),
      LX4: expect.stringMatching(/positive whole cents/), LX5: expect.stringMatching(/fully repaid/),
    })
    expect(plan.report.anomalies.map((a) => a.code)).toEqual(expect.arrayContaining([
      'archive_negative', 'archive_not_cents', 'loan_overpaid_before_cutover', 'withdrawal_before_cutover', 'loan_payment_before_loan',
    ]))
    const bank = plan.opening.find((e) => e.idempotencyKey === OPENING_KEYS.bank)!
    expect(bank.lines).toEqual([{ account: '9000', debit: 25000 }, { account: '1000', credit: 25000 }])
    expect(plan.report.adoption.keepLegacy.map((k) => k.loanId)).toEqual(expect.arrayContaining(['LPRE']))

    await resetDatabase()
    await createMember('M9')
    await expect(prisma.$transaction((tx) => checkOpening(tx, inputs(0)))).rejects.toMatchObject({ status: 422 })
    await expect(prisma.$transaction((tx) => checkOpening(tx, inputs(null)))).rejects.toMatchObject({ status: 400 })
    expect(await reconcile(prisma)).toBeNull()
  })
})
