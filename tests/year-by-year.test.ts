// Year by year (src/modules/membership/yearByYear.ts): a member's
// contributions, loan payments and borrowing by year and month, on the
// member portal's Payment History and the staff member page.
import { beforeEach, describe, expect, it } from 'vitest'
import { yearByYear, yearByYearTotals, paidIn, type YearByYearInput } from '@/modules/membership/yearByYear'
import { BROUGHT_FORWARD_METHOD } from '@/modules/loans/history'
import { signInAs, signInAsMember } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { createLoan, createMember, createStaffFixtures } from './helpers/factories'
import { callRoute } from './helpers/routes'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
const input = (o: Partial<YearByYearInput> = {}): YearByYearInput => ({
  yearlyTotals: [], contributions: [], loanPayments: [], loans: [], historicalLoans: [], today: '2026-10-28', ...o,
})
const paid = (date: string, cents: number, reversedAt: Date | null = null) => ({ paymentDate: d(date), amountCents: BigInt(cents), reversedAt })

describe('year by year', () => {
  it('this year: every month so far, newest first, from the recorded contributions', () => {
    const view = yearByYear(input({
      contributions: [paid('2026-01-05', 2000), paid('2026-01-20', 1500), paid('2026-10-01', 2000), paid('2026-03-03', 9900, d('2026-03-04'))],
    }))
    expect(view.hasLoans).toBe(false)
    expect(view.years).toHaveLength(1)
    const [year] = view.years
    expect(year).toMatchObject({ year: 2026, contributionsCents: 5500, loanPaymentsCents: 0, borrowedCents: 0 })
    expect(year.months!.map((m) => m.month)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01'])
    expect(year.months!.find((m) => m.month === '2026-01')!.contributionsCents).toBe(3500)
    // A reversed payment counts for nothing.
    expect(year.months!.find((m) => m.month === '2026-03')!.contributionsCents).toBe(0)
  })

  it('a payment late in the evening counts on its day in the club time zone', () => {
    // 03:30 UTC on Feb 1 is 9:30 pm on Jan 31 in Chicago.
    const view = yearByYear(input({ contributions: [{ paymentDate: new Date('2026-02-01T03:30:00Z'), amountCents: BigInt(2000), reversedAt: null }] }))
    expect(view.years[0].months!.find((m) => m.month === '2026-01')!.contributionsCents).toBe(2000)
  })

  it('older years: the club total stands; months only when the recorded ones agree with it', () => {
    const view = yearByYear(input({
      yearlyTotals: [{ year: 2024, amount: 240 }, { year: 2025, amount: 240 }, { year: 2023, amount: 100.005 }],
      // 2024's recorded contributions add up to the club total; 2025's don't.
      contributions: [paid('2024-01-10', 12000), paid('2024-07-10', 12000), paid('2025-02-10', 2000)],
    }))
    expect(view.years.map((y) => y.year)).toEqual([2025, 2024, 2023])
    const [y2025, y2024, y2023] = view.years
    expect(y2025).toMatchObject({ contributionsCents: 24000, months: null, loanPaymentsCents: null })
    expect(y2024.contributionsCents).toBe(24000)
    expect(y2024.months).toHaveLength(12)
    expect(y2024.months![0].month).toBe('2024-12')
    expect(y2024.loanPaymentsCents).toBe(0)
    // An old figure with a fraction of a cent is shown to the nearest cent, not refused.
    expect(y2023).toMatchObject({ contributionsCents: 10001, months: null })
  })

  it('loans: payouts and repayments by month; older loans on their loan date; the brought-forward sum left out', () => {
    const view = yearByYear(input({
      yearlyTotals: [{ year: 2024, amount: 240 }],
      contributions: [paid('2026-04-02', 2000)],
      loans: [
        { loanDate: d('2026-03-01'), disbursedOn: d('2026-04-15'), loanAmount: 1000, origin: 'live', lifecycle: 'disbursed' },
        { loanDate: d('2026-05-01'), disbursedOn: null, loanAmount: 500, origin: 'live', lifecycle: 'paid_off' },
        { loanDate: d('2026-06-01'), disbursedOn: null, loanAmount: 700, origin: 'live', lifecycle: 'approved' },
        { loanDate: d('2026-06-01'), disbursedOn: null, loanAmount: 800, origin: 'live', lifecycle: 'cancelled' },
        // Moved from the 2021–2025 records: counted once, from the records.
        { loanDate: d('2024-06-01'), disbursedOn: null, loanAmount: 1200, origin: 'legacy_import', lifecycle: 'disbursed' },
      ],
      historicalLoans: [{ loanDate: d('2024-06-01'), loanAmount: 1200 }],
      loanPayments: [
        { paymentDate: d('2026-05-15'), amount: 100, paymentMethod: 'Zelle' },
        { paymentDate: d('2026-06-15'), amount: 100.5, paymentMethod: 'Cash' },
        { paymentDate: d('2025-12-31'), amount: 600, paymentMethod: BROUGHT_FORWARD_METHOD },
      ],
    }))
    expect(view.hasLoans).toBe(true)
    const y2026 = view.years.find((y) => y.year === 2026)!
    expect(y2026).toMatchObject({ contributionsCents: 2000, loanPaymentsCents: 20050, borrowedCents: 150000 })
    const month = (m: string) => y2026.months!.find((x) => x.month === m)!
    expect(month('2026-04')).toEqual({ month: '2026-04', contributionsCents: 2000, loanPaymentsCents: 0, borrowedCents: 100000 })
    expect(month('2026-05')).toMatchObject({ loanPaymentsCents: 10000, borrowedCents: 50000 })
    expect(month('2026-06')).toMatchObject({ loanPaymentsCents: 10050, borrowedCents: 0 })
    // The brought-forward sum is left out, so 2025 has nothing to show.
    expect(view.years.map((y) => y.year)).toEqual([2026, 2024])
    const y2024 = view.years.find((y) => y.year === 2024)!
    expect(y2024).toMatchObject({ borrowedCents: 120000, loanPaymentsCents: null, months: null })

    expect(yearByYearTotals(view)).toEqual({ contributionsCents: 26000, loanPaymentsCents: 20050, borrowedCents: 270000 })
    expect(paidIn(y2026)).toBe(22050)
    expect(paidIn(y2024)).toBe(24000)
  })

  it('repayments recorded in a year the club keeps only as a total still show for that year', () => {
    const view = yearByYear(input({
      yearlyTotals: [{ year: 2025, amount: 240 }],
      loanPayments: [{ paymentDate: d('2025-08-01'), amount: 250, paymentMethod: 'Zelle' }],
    }))
    expect(view.years[0]).toMatchObject({ year: 2025, months: null, loanPaymentsCents: 25000 })
  })

  it('a year with borrowing but no contributions recorded shows its months', () => {
    const view = yearByYear(input({ loans: [{ loanDate: d('2025-03-01'), disbursedOn: null, loanAmount: 400, origin: 'live', lifecycle: 'disbursed' }] }))
    expect(view.years[0]).toMatchObject({ year: 2025, contributionsCents: 0, borrowedCents: 40000 })
    expect(view.years[0].months).toHaveLength(12)
  })

  it('nothing recorded: no years', () => {
    expect(yearByYear(input())).toEqual({ years: [], hasLoans: false })
  })
})

describe('on the screens', () => {
  const MEMBER = 'MC-YBY-01'

  beforeEach(async () => {
    await resetDatabase()
    await createStaffFixtures()
    await createMember(MEMBER)
    await prisma.yearlyTotal.create({ data: { memberId: MEMBER, year: 2023, amount: 240 } })
    await prisma.contribution.create({
      data: { transactionId: 'TX-YBY-1', memberId: MEMBER, memberName: 'Test', paymentDate: d('2026-02-03'), monthYear: 'Feb-2026', amount: 20, amountCents: BigInt(2000) },
    })
    await createLoan('LN-YBY-1', MEMBER, { loanDate: d('2026-03-01'), loanAmount: 600, lifecycle: 'disbursed' })
    await prisma.loanPayment.create({ data: { paymentId: 'LP-YBY-1', loanId: 'LN-YBY-1', borrowerId: MEMBER, borrowerName: 'Test', paymentDate: d('2026-04-01'), amount: 100 } })
    // An older loan from 2023: staff see it; the member portal lists older loans from 2024.
    await prisma.historicalLoan.create({
      data: { loanId: 'HL-YBY-1', year: 2023, borrowerName: 'Test', borrowerId: MEMBER, borrowerLink: 'exact', loanDate: d('2023-05-01'), loanAmount: 900, totalPaid: 900, balanceRemaining: 0 },
    })
  })

  it("the member's Payment History", async () => {
    signInAsMember(MEMBER)
    const res = await callRoute('portal/history', 'GET')
    expect(res.status).toBe(200)
    const { years, hasLoans } = res.json.yearByYear
    expect(hasLoans).toBe(true)
    expect(years.map((y: any) => y.year)).toEqual([2026, 2023])
    expect(years[0]).toMatchObject({ contributionsCents: 2000, loanPaymentsCents: 10000, borrowedCents: 60000 })
    expect(years[1]).toMatchObject({ contributionsCents: 24000, borrowedCents: 0, months: null })
  })

  it('the staff member page', async () => {
    signInAs('auditor')
    const res = await callRoute('members/[id]', 'GET', { params: { id: MEMBER } })
    expect(res.status).toBe(200)
    expect(res.json.yearByYear.years[1]).toMatchObject({ year: 2023, borrowedCents: 90000 })
  })
})
