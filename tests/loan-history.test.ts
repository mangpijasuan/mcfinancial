// M9 (docs/architecture/11 §1): older loans linked to members by ID, the
// Treasurer's review of shared and unknown names, confirmed balances moving
// still-open loans to the live loans, and no name matching anywhere else.
import { beforeEach, describe, expect, it } from 'vitest'
import { signInAs, signInAsMember, staffId } from './helpers/actors'
import { auditEntriesSince, auditMarker, prisma, resetDatabase } from './helpers/db'
import { createLoan, createMember, createStaffFixtures } from './helpers/factories'
import { callRoute } from './helpers/routes'
import { checkOpening, planOpening } from '@/modules/accounting/opening'
import { BROUGHT_FORWARD_METHOD } from '@/modules/loans/history'
import { cents } from '@/lib/money'

type Older = { borrower: string; cosigner?: string; year?: number; date?: string; end?: string | null; amount?: number; paid?: number; status?: string }
async function older(loanId: string, o: Older) {
  const amount = o.amount ?? 1000
  const paid = o.paid ?? amount
  return prisma.historicalLoan.create({
    data: {
      loanId, year: o.year ?? 2023, borrowerName: o.borrower, cosignerName: o.cosigner ?? null,
      loanDate: new Date(o.date ?? '2023-03-01'), endDate: o.end === null ? null : new Date(o.end ?? '2024-03-01'),
      loanAmount: amount, totalPaid: paid, balanceRemaining: amount - paid, status: o.status ?? (paid >= amount ? 'Paid Off' : 'Active'),
    },
  })
}
const idOf = async (loanId: string) => (await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId } })).id
const link = async (loanId: string, body: Record<string, unknown>) => callRoute('loan-history/[id]/link', 'POST', { params: { id: await idOf(loanId) }, body })
const confirm = async (loanId: string, balance: string, asOf = '2025-12-31') =>
  callRoute('loan-history/[id]/confirm', 'POST', { params: { id: await idOf(loanId) }, body: { balance, asOf } })
const review = async () => (await callRoute('loan-history/review', 'GET')).json

/**
 * Members: Ada (nickname "Ada L"), two Ben Smiths, Cara.
 * Older loans:
 * - H1 2021 Ada (written "ada lovelace (aunt)"), co-signed by "Cara  JONES": both exact.
 * - H2 2023 and H3 2024 "Ben Smith": a shared name. H3 is still Active: $1,000, $600 repaid; co-signed by Ada.
 * - H4, H5 "Dan Gone": no such member.
 * - H6 2025 Ada, Active in the records but repaid in full.
 * - H7 2025 Cara, Active: already copied to the live loans by the old sync script.
 */
beforeEach(async () => {
  await resetDatabase()
  await createStaffFixtures()
  await createMember('A1', { legalName: 'Ada Lovelace', nickname: 'Ada L' })
  await createMember('B1', { legalName: 'Ben Smith' })
  await createMember('B2', { legalName: 'Ben Smith' })
  await createMember('C1', { legalName: 'Cara Jones' })
  await older('H1', { year: 2021, borrower: 'ada lovelace (aunt)', cosigner: 'Cara  JONES' })
  await older('H2', { borrower: 'Ben Smith' })
  await older('H3', { year: 2024, borrower: 'Ben Smith', cosigner: 'Ada Lovelace', date: '2024-06-01', end: '2025-06-01', paid: 600 })
  await older('H4', { year: 2022, borrower: 'Dan Gone' })
  await older('H5', { borrower: 'Dan Gone' })
  await older('H6', { year: 2025, borrower: 'Ada L', date: '2025-01-10', amount: 500, paid: 500, status: 'Active' })
  await older('H7', { year: 2025, borrower: 'Cara Jones', date: '2025-02-01', end: null, amount: 600, paid: 300 })
  await createLoan('H7', 'C1', { loanDate: new Date('2025-02-01'), loanAmount: 600, totalPaid: 300, balanceRemaining: 300, origin: 'legacy_import', notes: 'Synced from HistoricalLoan (2025)' })
  await prisma.loanPayment.create({ data: { paymentId: 'LP-H7-1', loanId: 'H7', borrowerId: 'C1', borrowerName: 'Cara Jones', paymentDate: new Date('2026-02-10'), amount: 50 } })
})

describe('the review queue', () => {
  it('counts exact matches and lists shared and unknown names for the Treasurer', async () => {
    signInAs('auditor')
    const r = await review()
    expect(r).toMatchObject({ total: 7, linked: 0, exactAvailable: 5, activeToConfirm: 3, openingPosted: false })
    expect(r.toReview.map((i: any) => `${i.loanId}:${i.role}:${i.candidates.length}:${i.sameName}`)).toEqual([
      'H4:borrower:0:1', 'H2:borrower:2:1', 'H5:borrower:0:1', 'H3:borrower:2:1',
    ])
    const h7 = r.activeLoans.find((a: any) => a.loanId === 'H7')
    expect(h7).toMatchObject({ recordBalanceCents: 300_00, liveLoan: { balanceCents: 300_00, repaidCents: 50_00 }, confirmed: null, blocker: 'Link the borrower first.' })
    expect(r.activeLoans.find((a: any) => a.loanId === 'H3').cosigner).toMatchObject({ name: 'Ada Lovelace', memberId: null })
  })

  it('links every exact match, once, for the Treasurer only', async () => {
    signInAs('loan_officer')
    expect((await callRoute('loan-history/review/link-exact', 'POST')).status).toBe(403)
    signInAs('treasurer')
    const marker = await auditMarker()
    expect((await callRoute('loan-history/review/link-exact', 'POST')).json).toEqual({ linked: 5 })
    expect((await callRoute('loan-history/review/link-exact', 'POST')).json).toEqual({ linked: 0 })
    expect((await auditEntriesSince(marker)).map((a) => a.action)).toEqual(['loan_history.link_exact'])
    expect(await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId: 'H1' } })).toMatchObject({ borrowerId: 'A1', borrowerLink: 'exact', cosignerId: 'C1', cosignerLink: 'exact' })
    expect(await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId: 'H3' } })).toMatchObject({ borrowerId: null, borrowerLink: null, cosignerId: 'A1' })
    expect((await review()).linked).toBe(3) // H1, H6, H7
  })
})

describe('the Treasurer links a name', () => {
  beforeEach(() => signInAs('treasurer'))

  it('to one member on one loan when several share the name', async () => {
    expect((await link('H3', { role: 'borrower', memberId: 'B1', sameName: true })).status).toBe(422)
    expect((await link('H3', { role: 'borrower', memberId: 'B1' })).json).toEqual({ linked: 1 })
    expect(await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId: 'H3' } })).toMatchObject({ borrowerId: 'B1', borrowerLink: 'reviewed' })
    expect(await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId: 'H2' } })).toMatchObject({ borrowerLink: null })
    // A correction before the loan moves to the live loans.
    expect((await link('H3', { role: 'borrower', memberId: 'B2' })).status).toBe(200)
    expect(await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId: 'H3' } })).toMatchObject({ borrowerId: 'B2' })
  })

  it('as no member record, on every loan waiting with that name', async () => {
    const marker = await auditMarker()
    expect((await link('H4', { role: 'borrower', memberId: null, sameName: true })).json).toEqual({ linked: 2 })
    for (const loanId of ['H4', 'H5']) {
      expect(await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId } })).toMatchObject({ borrowerId: null, borrowerLink: 'no_member' })
    }
    const [entry] = await auditEntriesSince(marker)
    expect(entry).toMatchObject({ action: 'loan_history.link', entityId: 'H4', after: { name: 'Dan Gone', memberId: null, link: 'no_member', loans: ['H4:borrower', 'H5:borrower'] } })
  })

  it('refuses what cannot be linked', async () => {
    expect((await link('H2', { role: 'cosigner', memberId: 'B1' })).status).toBe(400) // no co-signer
    expect((await link('H2', { role: 'borrower', memberId: 'NOPE' })).status).toBe(400)
    expect((await link('H2', { role: 'lender', memberId: 'B1' })).status).toBe(400)
    expect((await link('H2', { role: 'borrower', memberId: '' })).status).toBe(400)
    expect((await link('H2', { role: 'borrower' })).status).toBe(400)
    expect((await callRoute('loan-history/[id]/link', 'POST', { params: { id: 'missing' }, body: { role: 'borrower', memberId: null } })).status).toBe(404)
    expect((await callRoute('loan-history/[id]/link', 'POST', { params: { id: await idOf('H2') }, rawBody: 'nope' })).status).toBe(400)
    signInAs('board')
    expect((await link('H2', { role: 'borrower', memberId: 'B1' })).status).toBe(403)
  })
})

describe('confirming an Active loan', () => {
  beforeEach(async () => {
    signInAs('treasurer')
    await callRoute('loan-history/review/link-exact', 'POST')
  })

  it('moves a balance still owed to the live loans, opening at exactly that balance', async () => {
    expect((await confirm('H3', '400')).json.error).toBe('Link the borrower first.')
    await link('H3', { role: 'borrower', memberId: 'B1' })
    const marker = await auditMarker()
    expect((await confirm('H3', '400')).json).toEqual({ loanId: 'H3', balanceCents: 400_00, broughtForwardCents: 600_00 })

    const loan = await prisma.loan.findUniqueOrThrow({ where: { loanId: 'H3' }, include: { payments: true } })
    expect(loan).toMatchObject({
      origin: 'legacy_import', borrowerId: 'B1', borrowerName: 'Ben Smith', cosignerId: 'A1', cosignerName: 'Ada Lovelace',
      termMonths: 12, loanAmount: 1000, monthlyDue: 83.33, totalPaid: 600, balanceRemaining: 400, status: 'Active', lifecycle: 'disbursed', principalCents: null,
    })
    expect(loan.payments).toEqual([expect.objectContaining({ amount: 600, paymentMethod: BROUGHT_FORWARD_METHOD, source: 'legacy_import', paymentDate: new Date('2025-12-31') })])
    expect(await prisma.member.findUniqueOrThrow({ where: { id: 'B1' } })).toMatchObject({ activeAsBorrower: 1, currentLoanBalance: 400 })
    expect(await prisma.member.findUniqueOrThrow({ where: { id: 'A1' } })).toMatchObject({ activeAsCosigner: 1 })
    expect(await prisma.historicalLoan.findUniqueOrThrow({ where: { loanId: 'H3' } })).toMatchObject({
      confirmedBalanceCents: BigInt(400_00), balanceAsOf: new Date('2025-12-31'), balanceConfirmedBy: staffId('treasurer'), importedLoanId: 'H3',
    })
    expect((await auditEntriesSince(marker)).map((a) => a.action)).toEqual(['loan_history.confirm_balance'])

    // Once only; its names are now fixed; the opening balances see it as an open loan.
    expect((await confirm('H3', '400')).status).toBe(409)
    expect((await link('H3', { role: 'borrower', memberId: 'B2' })).status).toBe(409)
    const plan = await prisma.$transaction((tx) => planOpening(tx, { cutover: '2026-01-01', bankBalanceCents: cents(0), confirmedLoanBalances: {} }))
    expect(plan.report.loansAtCutover).toContainEqual(expect.objectContaining({ loanId: 'H3', balanceCents: 400_00 }))

    const r = await review()
    expect(r.activeLoans.find((a: any) => a.loanId === 'H3').confirmed).toMatchObject({ balanceCents: 400_00, asOf: '2025-12-31', by: staffId('treasurer'), importedLoanId: 'H3' })
  })

  it('records a loan repaid in full without a live loan', async () => {
    expect((await confirm('H6', '0')).json).toEqual({ loanId: null, balanceCents: 0, broughtForwardCents: 0 })
    expect(await prisma.loan.findUnique({ where: { loanId: 'H6' } })).toBeNull()
  })

  it('brings a loan the old sync script copied up to the confirmed balance', async () => {
    // $600 loan, nothing recorded up to 31 Dec, $50 repaid in February 2026; $250 owed on 31 Dec.
    expect((await confirm('H7', '250')).json).toEqual({ loanId: 'H7', balanceCents: 250_00, broughtForwardCents: 350_00 })
    const loan = await prisma.loan.findUniqueOrThrow({ where: { loanId: 'H7' } })
    expect(loan).toMatchObject({ totalPaid: 400, balanceRemaining: 200, status: 'Active', origin: 'legacy_import' })
    expect(loan.notes).toMatch(/^Synced from HistoricalLoan \(2025\) Moved from the 2021–2025 records/)
  })

  it('creates a loan owed in full with no brought-forward repayment, and closes a copied loan confirmed repaid', async () => {
    await older('H8', { year: 2025, borrower: 'Cara Jones', date: '2025-05-01', amount: 300, paid: 0 })
    await link('H8', { role: 'borrower', memberId: 'C1' })
    expect((await confirm('H8', '300')).json).toEqual({ loanId: 'H8', balanceCents: 300_00, broughtForwardCents: 0 })
    expect(await prisma.loanPayment.count({ where: { loanId: 'H8' } })).toBe(0)
    expect(await prisma.loan.findUniqueOrThrow({ where: { loanId: 'H8' } })).toMatchObject({ balanceRemaining: 300, cosignerId: null, cosignerName: null })

    // H7 repaid in full by 31 Dec: the February payment makes it overpaid, and it closes.
    expect((await confirm('H7', '0')).json).toMatchObject({ loanId: 'H7', broughtForwardCents: 600_00 })
    expect(await prisma.loan.findUniqueOrThrow({ where: { loanId: 'H7' } })).toMatchObject({ balanceRemaining: 0, status: 'Paid Off', lifecycle: 'paid_off', nextDueDate: null })
  })

  it('refuses a balance it cannot stand behind', async () => {
    await link('H3', { role: 'borrower', memberId: 'B1' })
    expect((await confirm('H3', '1000.01')).status).toBe(422)
    expect((await confirm('H3', '-1')).status).toBe(422)
    expect((await confirm('H3', 'ten')).status).toBe(400)
    expect((await confirm('H3', '400', '2024-05-31')).status).toBe(422) // before the loan
    expect((await confirm('H3', '400', '2999-01-01')).status).toBe(422) // in the future
    expect((await confirm('H3', '400', '31/12/2025')).status).toBe(400)
    expect((await confirm('H2', '0')).status).toBe(409) // not marked Active
    expect((await callRoute('loan-history/[id]/confirm', 'POST', { params: { id: 'missing' }, body: { balance: '0', asOf: '2025-12-31' } })).status).toBe(404)
    expect((await callRoute('loan-history/[id]/confirm', 'POST', { params: { id: await idOf('H3') }, rawBody: 'nope' })).status).toBe(400)

    // Repayments already recorded by that day exceed the loan less the balance.
    await prisma.loanPayment.create({ data: { paymentId: 'LP-H7-0', loanId: 'H7', borrowerId: 'C1', borrowerName: 'Cara Jones', paymentDate: new Date('2025-06-01'), amount: 500 } })
    expect((await confirm('H7', '250')).json.error).toMatch(/already total \$500\.00/)

    // A co-signer still to decide; a borrower with no member record still owing.
    await older('H9', { year: 2025, borrower: 'Ada Lovelace', cosigner: 'Somebody Else', date: '2025-03-01', amount: 200, paid: 100 })
    await callRoute('loan-history/review/link-exact', 'POST')
    expect((await confirm('H9', '100')).json.error).toBe('Link the co-signer first.')
    expect((await link('H9', { role: 'cosigner', memberId: null })).json).toEqual({ linked: 1 }) // a co-signer who was never a member
    expect((await confirm('H9', '100')).json).toMatchObject({ loanId: 'H9', broughtForwardCents: 100_00 })
    expect(await prisma.loan.findUniqueOrThrow({ where: { loanId: 'H9' } })).toMatchObject({ borrowerId: 'A1', cosignerId: null, cosignerName: 'Somebody Else' })
    await older('H10', { year: 2025, borrower: 'Nobody Known', date: '2025-03-01', amount: 200, paid: 100 })
    await link('H10', { role: 'borrower', memberId: null })
    expect((await confirm('H10', '100')).json.error).toMatch(/must belong to a member/)
    expect((await confirm('H10', '0')).json).toMatchObject({ loanId: null }) // repaid: no member needed

    // A live loan under the same ID for someone else.
    await older('H11', { year: 2025, borrower: 'Ada Lovelace', date: '2025-03-01', amount: 200, paid: 100 })
    await createLoan('H11', 'C1')
    await callRoute('loan-history/review/link-exact', 'POST')
    expect((await confirm('H11', '100')).status).toBe(409)

    signInAs('finance')
    expect((await confirm('H6', '0')).status).toBe(403)
  })

  it('blocks opening balances until every Active loan is confirmed, as of a day before the cutover', async () => {
    const inputs = { cutover: '2026-01-01', bankBalanceCents: cents(5000_00), confirmedLoanBalances: {} }
    await expect(prisma.$transaction((tx) => checkOpening(tx, inputs))).rejects.toThrow(/still marked Active first \(M9\): H3, H6, H7/)
    await link('H3', { role: 'borrower', memberId: 'B1' })
    await confirm('H3', '400')
    await confirm('H6', '0')
    await confirm('H7', '250', '2026-01-15')
    const plan = await prisma.$transaction((tx) => planOpening(tx, inputs))
    expect(plan.report.anomalies.map((a) => a.code)).toContain('historical_loans_confirmed_late')
    await expect(prisma.$transaction((tx) => checkOpening(tx, inputs))).rejects.toThrow(/as of the cutover or later.*: H7/)
    // A cutover after that date is fine.
    await expect(prisma.$transaction((tx) => checkOpening(tx, { ...inputs, cutover: '2026-02-01' }))).rejects.toThrow(/chart of accounts/)
  })

  it('shows who confirmed it, even if their staff account is gone', async () => {
    await confirm('H6', '0')
    await prisma.historicalLoan.update({ where: { loanId: 'H6' }, data: { balanceConfirmedBy: 'staff-removed' } })
    expect((await review()).activeLoans.find((a: any) => a.loanId === 'H6').confirmed.by).toBe('staff-removed')
  })
})

describe('no name matching anywhere else', () => {
  beforeEach(async () => {
    signInAs('treasurer')
    await callRoute('loan-history/review/link-exact', 'POST')
    await link('H3', { role: 'borrower', memberId: 'B1' })
  })

  it('shows a member only the older loans linked to them, not those of someone with the same name', async () => {
    signInAsMember('B2')
    const b2 = (await callRoute('portal/history', 'GET')).json
    expect([...b2.historicalLoansAsBorrower, ...b2.historicalLoansAsCosigner]).toEqual([])
    signInAsMember('B1')
    expect((await callRoute('portal/history', 'GET')).json.historicalLoansAsBorrower.map((l: any) => l.loanId)).toEqual(['H3'])
    signInAsMember('A1')
    const a1 = (await callRoute('portal/history', 'GET')).json
    expect(a1.historicalLoansAsBorrower.map((l: any) => l.loanId)).toEqual(['H6']) // H1 is from 2021: the portal shows 2024 on
    expect(a1.historicalLoansAsCosigner.map((l: any) => l.loanId)).toEqual(['H3'])
  })

  it('on the member page and in the Loan History, by member ID', async () => {
    signInAs('auditor')
    const a1 = (await callRoute('members/[id]', 'GET', { params: { id: 'A1' } })).json
    expect(a1.historicalLoansAsBorrower.map((l: any) => l.loanId)).toEqual(['H6', 'H1'])
    expect(a1.historicalLoansAsCosigner.map((l: any) => l.loanId)).toEqual(['H3'])
    const b2 = (await callRoute('members/[id]', 'GET', { params: { id: 'B2' } })).json
    expect(b2.historicalLoansAsBorrower).toEqual([])

    const history = (await callRoute('loan-history', 'GET')).json
    expect(history.loans).toHaveLength(7)
    const bens = history.leaderboard.filter((r: any) => r.borrowerName === 'Ben Smith')
    expect(bens.map((r: any) => [r.borrowerId, r._count.id])).toEqual(expect.arrayContaining([['B1', 1], [null, 1]]))
  })
})
