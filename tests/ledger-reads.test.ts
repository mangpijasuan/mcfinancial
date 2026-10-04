// Migration step M6 (docs/architecture/11 §1): with LEDGER_READS on and
// opening balances posted, dashboards, statements, eligibility and loan
// balances read from the ledger; otherwise from the stored figures. The
// side-by-side report shows every figure the switch changes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TEST_IDS, signInAs, signInAsMember, staffId } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createBaseFixtures, createLoan, createMember } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { approveAccounts } from '@/modules/accounting/ledger'
import { checkOpening, postOpeningBalances } from '@/modules/accounting/opening'
import { readSource, readsParity } from '@/modules/accounting/reads'
import { cents } from '@/lib/money'

async function openLedger() {
  const codes = (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code)
  await prisma.$transaction((tx) => approveAccounts(tx, { codes, approvedBy: staffId('treasurer'), note: 'test chart approval' }))
  const inputs = { cutover: '2026-01-01', bankBalanceCents: cents(5000_00), confirmedLoanBalances: {} }
  const plan = await prisma.$transaction((tx) => checkOpening(tx, inputs))
  await prisma.$transaction((tx) => postOpeningBalances(tx, { ...inputs, openingHash: plan.openingHash },
    { maker: { id: staffId('treasurer'), email: '' }, checker: { id: staffId('board'), email: '' } },
    { actorType: 'system', actorId: null, actorLabel: 'test', ip: null, userAgent: null, requestId: null } as never), { timeout: 60_000 })
}

const reads = async () => (await callRoute('ledger/reads', 'GET')).json
const ledgerOn = () => { process.env.LEDGER_READS = 'true' }

/**
 * M1: $1,000 archive. LN-TEST-A ($1,000, made 2026-01-15) and LN-TEST-B: the base
 * fixtures' older loans. LOLD (the other member's): repaid in 2024, $0 in the ledger. LAPP (M1's): approved,
 * not paid out, so the ledger holds nothing for it.
 */
beforeEach(async () => {
  delete process.env.LEDGER_READS
  await resetDatabase()
  await createBaseFixtures()
  await createMember('M1', { archiveLifetime: 1000, overallContributions: 1000, monthsActive: 24 })
  await createLoan('LOLD', TEST_IDS.otherMember, { loanDate: new Date('2024-02-01'), loanAmount: 300, termMonths: 3, balanceRemaining: 0, status: 'Paid Off', lifecycle: 'paid_off', updatedAt: new Date('2024-05-10') })
  await prisma.loanPayment.create({ data: { paymentId: 'LP-OLD', loanId: 'LOLD', borrowerId: TEST_IDS.otherMember, borrowerName: 'x', paymentDate: new Date('2024-05-10'), amount: 300 } })
})
afterEach(() => { delete process.env.LEDGER_READS })

describe('before opening balances', () => {
  it('reads the records, even with the switch on, and has nothing to compare', async () => {
    expect(await readSource(prisma)).toMatchObject({ source: 'records', requested: false, cutover: null })
    expect(await readsParity(prisma)).toBeNull()
    ledgerOn()
    expect(await readSource(prisma)).toMatchObject({ source: 'records', requested: true, reason: expect.stringMatching(/not posted yet/) })
    signInAs('auditor')
    expect(await reads()).toMatchObject({ source: { source: 'records' }, parity: null, streak: null })
  })
})

describe('after opening balances', () => {
  beforeEach(async () => {
    await openLedger()
    await createLoan('LAPP', 'M1', { loanDate: new Date('2026-09-01'), loanAmount: 500, balanceRemaining: 500, lifecycle: 'approved' })
    // A withdrawal recorded in the app posts to the ledger as it is saved (M5).
    signInAs('finance')
    expect((await callRoute('withdrawals', 'POST', { body: { memberId: 'M1', amount: '50', withdrawalDate: '2026-09-20' } })).status).toBe(201)
  })

  it('finds the records and the ledger in agreement', async () => {
    signInAs('auditor')
    const r = await reads()
    expect(r.source).toMatchObject({ source: 'records', requested: false, cutover: '2026-01-01' })
    expect(r.streak).toMatchObject({ days: 0, target: 30, met: false })
    expect(r.parity).toMatchObject({
      members: [], loans: [], checked: { members: 3, loans: 3 },
      totals: {
        contributed: { recordsCents: 1000_00, ledgerCents: 1000_00 },
        withdrawn: { recordsCents: 50_00, ledgerCents: 50_00 },
        capital: { recordsCents: 950_00, ledgerCents: 950_00 },
        outstanding: { recordsCents: 2000_00, ledgerCents: 2000_00 },
      },
    })
  })

  describe('when the stored figures drift from the ledger', () => {
    beforeEach(async () => {
      // Someone edits the records outside the app: M1's total, a withdrawal, and one loan's balance.
      await prisma.member.update({ where: { id: 'M1' }, data: { overallContributions: 1200, contributions2026: 200 } })
      await prisma.withdrawal.create({ data: { withdrawalId: 'WD-OUTSIDE', memberId: 'M1', memberName: 'Test Member M1', amount: 30, withdrawalDate: new Date('2026-09-25') } })
      await prisma.loan.update({ where: { loanId: 'LN-TEST-A' }, data: { balanceRemaining: 900 } })
    })

    it('reports each figure that differs', async () => {
      const p = (await readsParity(prisma))!
      expect(p.members).toEqual([
        { memberId: 'M1', name: 'Test Member M1', field: 'contributions', recordsCents: 1200_00, ledgerCents: 1000_00, differenceCents: -200_00 },
        { memberId: 'M1', name: 'Test Member M1', field: 'withdrawals', recordsCents: 80_00, ledgerCents: 50_00, differenceCents: -30_00 },
      ])
      expect(p.loans).toEqual([{ loanId: 'LN-TEST-A', borrower: `Test Member ${TEST_IDS.member}`, recordsCents: 900_00, ledgerCents: 1000_00, differenceCents: 100_00 }])
      expect(p.totals.outstanding).toEqual({ recordsCents: 1900_00, ledgerCents: 2000_00 })
    })

    it('shows the records while the switch is off', async () => {
      signInAs('auditor')
      expect((await callRoute('members/[id]', 'GET', { params: { id: 'M1' } })).json.overallContributions).toBe(1200)
      expect((await callRoute('loans/[id]', 'GET', { params: { id: 'LN-TEST-A' } })).json.balanceRemaining).toBe(900)
      const dash = (await callRoute('dashboard', 'GET')).json
      expect(dash).toMatchObject({ balanceSource: 'records', stats: { outstandingBalance: 2400, totalContributions: 1200 } })
      signInAs('loan_officer')
      expect((await callRoute('loans/check-policy', 'POST', { body: { memberId: 'M1', amount: '100', termMonths: 12 } })).json.maxLoanAmount).toBe(4800)
    })

    it('shows the ledger once the switch is on', async () => {
      ledgerOn()
      signInAs('auditor')
      const m1 = (await callRoute('members/[id]', 'GET', { params: { id: 'M1' } })).json
      expect(m1.overallContributions).toBe(1000)
      // Older loans without an agreement are listed too; the approved one keeps its stored figure.
      expect(m1.loansAsBorrower.map((l: any) => [l.loanId, l.balanceRemaining])).toEqual([['LAPP', 500]])
      const other = (await callRoute('members/[id]', 'GET', { params: { id: TEST_IDS.otherMember } })).json
      expect(other.loansAsBorrower.map((l: any) => [l.loanId, l.balanceRemaining]).sort()).toEqual([['LN-TEST-B', 1000], ['LOLD', 0]])
      expect((await callRoute('loans/[id]', 'GET', { params: { id: 'LN-TEST-A' } })).json.balanceRemaining).toBe(1000)
      expect((await callRoute('loans/[id]', 'GET', { params: { id: 'LAPP' } })).json.balanceRemaining).toBe(500)
      const list = (await callRoute('loans', 'GET', { query: 'status=Active' })).json
      expect(Object.fromEntries(list.map((l: any) => [l.loanId, l.balanceRemaining]))).toMatchObject({ 'LN-TEST-A': 1000, 'LN-TEST-B': 1000, LAPP: 500 })
      const members = (await callRoute('members', 'GET', { query: 'search=M1' })).json.members
      expect(members.map((m: any) => m.overallContributions)).toEqual([1000])
      expect((await callRoute('members', 'GET', { query: 'search=nobody' })).json.members).toEqual([])

      const dash = (await callRoute('dashboard', 'GET')).json
      expect(dash).toMatchObject({ balanceSource: 'ledger', stats: { outstandingBalance: 2500, totalContributions: 1000 } })
      expect(dash.activeLoansDetail.find((l: any) => l.loanId === 'LN-TEST-A').balanceRemaining).toBe(1000)

      // Eligibility: 4 × the ledger's $1,000, not the records' $1,200; nothing in the ledger, nothing to lend on.
      signInAs('loan_officer')
      expect((await callRoute('loans/check-policy', 'POST', { body: { memberId: 'M1', amount: '100', termMonths: 12 } })).json.maxLoanAmount).toBe(4000)
      expect((await callRoute('loans/check-policy', 'POST', { body: { memberId: TEST_IDS.otherMember, amount: '100', termMonths: 12 } })).json.maxLoanAmount).toBe(0)

      // The borrower's portal: the balance and the most they can pay.
      signInAsMember(TEST_IDS.member)
      const me = (await callRoute('portal/me', 'GET')).json
      expect(me.loansAsBorrower.map((l: any) => [l.loanId, l.balanceRemaining])).toEqual([['LN-TEST-A', 1000]])
      const pay = (amount: number) => callRoute('portal/payments/checkout', 'POST', { body: { type: 'loan_payment', loanId: 'LN-TEST-A', amount, method: 'zelle' } })
      expect((await pay(1000.01)).json.error).toBe('Amount exceeds the remaining loan balance.')

      signInAs('auditor')
      expect((await reads()).source).toMatchObject({ source: 'ledger', requested: true })
    })

    it('applies the same rules when a loan is created', async () => {
      ledgerOn()
      const { checkLoan } = await import('@/modules/loans/create')
      const over = { borrowerId: 'M1', cosignerId: null, loanDate: '2026-09-30', termMonths: 12, loanAmount: 4500, notes: null, borrowerAddress: null, borrowerCity: null, borrowerState: null }
      await expect(prisma.$transaction((tx) => checkLoan(tx, over))).rejects.toThrow()
      delete process.env.LEDGER_READS
      await expect(prisma.$transaction((tx) => checkLoan(tx, over))).resolves.toBeTruthy()
    })
  })
})
