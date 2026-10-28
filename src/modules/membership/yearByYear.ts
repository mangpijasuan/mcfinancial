// A member's money with the club, year by year and month by month: what they
// contributed, what they paid on their loans and what they borrowed. The
// member portal's Payment History and the staff member page show it.
//
// The records differ by period:
// - Contributions recorded one by one (2026 on, and any imported) give each
//   month. The club's yearly totals (2014–2025) give only the year; that
//   year shows its months too when its recorded contributions add up to the
//   club's total.
// - Loan repayments recorded one by one give each month. The 2021–2025 loan
//   records keep only what each loan came to, not when it was repaid, so
//   repayments are unknown (null) in years without recorded ones, and the
//   lump sum brought forward from those records is left out.
// - Borrowed: loans made in this system on their payout date, and the
//   2021–2025 loans on their loan date (a loan moved from those records into
//   this system is counted once, from the records).
import type { Prisma } from '@prisma/client'
import { type Cents, ZERO, add, fromBigInt, sum } from '@/lib/money'
import { isoDateOf, todayIso } from '@/lib/dates'
import { legacyCents } from '@/modules/accounting/legacyActivity'
import { BROUGHT_FORWARD_METHOD } from '@/modules/loans/history'

type Db = Prisma.TransactionClient

export type MonthFigures = {
  /** YYYY-MM */
  month: string
  contributionsCents: Cents
  loanPaymentsCents: Cents
  borrowedCents: Cents
}

export type YearFigures = {
  year: number
  contributionsCents: Cents
  /** Null when the records don't say what was repaid that year. */
  loanPaymentsCents: Cents | null
  borrowedCents: Cents
  /** Newest month first; null when the records keep only the year. */
  months: MonthFigures[] | null
}

export type YearByYear = {
  years: YearFigures[]
  /** Whether the member has ever borrowed or repaid, so screens can leave the loan columns out. */
  hasLoans: boolean
}

type Dated = { date: string; cents: Cents }

export type YearByYearInput = {
  /** The club's yearly totals (dollars). */
  yearlyTotals: { year: number; amount: number }[]
  contributions: { paymentDate: Date; amountCents: bigint; reversedAt: Date | null }[]
  loanPayments: { paymentDate: Date; amount: number; paymentMethod: string | null }[]
  loans: { loanDate: Date; disbursedOn: Date | null; loanAmount: number; origin: string; lifecycle: string }[]
  historicalLoans: { loanDate: Date; loanAmount: number }[]
  today: string
}

/** Loans paid out: those still to be paid out, or cancelled, never were. */
const PAID_OUT = new Set(['disbursed', 'paid_off', 'charged_off'])

/** A stored dollar figure, to the nearest cent (a display never refuses an old record). */
const dollars = (value: number) => legacyCents(value).amount

const byMonth = (rows: Dated[], month: string) => sum(rows.filter((r) => r.date.startsWith(month)).map((r) => r.cents))

export function yearByYear(input: YearByYearInput): YearByYear {
  const contributions: Dated[] = input.contributions
    .filter((c) => !c.reversedAt)
    .map((c) => ({ date: isoDateOf(c.paymentDate), cents: fromBigInt(c.amountCents) }))
  const payments: Dated[] = input.loanPayments
    .filter((p) => p.paymentMethod !== BROUGHT_FORWARD_METHOD)
    .map((p) => ({ date: isoDateOf(p.paymentDate), cents: dollars(p.amount) }))
  const borrowed: Dated[] = [
    ...input.loans
      .filter((l) => l.origin === 'live' && PAID_OUT.has(l.lifecycle))
      .map((l) => ({ date: isoDateOf(l.disbursedOn ?? l.loanDate), cents: dollars(l.loanAmount) })),
    ...input.historicalLoans.map((l) => ({ date: isoDateOf(l.loanDate), cents: dollars(l.loanAmount) })),
  ]
  const clubTotals = new Map(input.yearlyTotals.map((y) => [y.year, dollars(y.amount)]))
  const [thisYear, thisMonth] = input.today.split('-').map(Number)

  const yearOf = (r: Dated) => Number(r.date.slice(0, 4))
  const allYears = new Set([...clubTotals.keys(), ...[...contributions, ...payments, ...borrowed].map(yearOf)])

  const years = [...allYears].sort((a, b) => b - a).map((year): YearFigures => {
    const inYear = (rows: Dated[]) => rows.filter((r) => yearOf(r) === year)
    const yearContributions = inYear(contributions)
    const yearPayments = inYear(payments)
    const yearBorrowed = inYear(borrowed)
    const recorded = sum(yearContributions.map((r) => r.cents))
    const clubTotal = clubTotals.get(year)
    const contributionsCents = clubTotal ?? recorded
    // The club's total stands; the months are shown only when they agree with it.
    const monthly = clubTotal === undefined || (yearContributions.length > 0 && recorded === clubTotal)
    const lastMonth = year === thisYear ? thisMonth : 12
    const months = monthly
      ? Array.from({ length: lastMonth }, (_, i) => {
          const month = `${year}-${String(lastMonth - i).padStart(2, '0')}`
          return {
            month,
            contributionsCents: byMonth(yearContributions, month),
            loanPaymentsCents: byMonth(yearPayments, month),
            borrowedCents: byMonth(yearBorrowed, month),
          }
        })
      : null
    return {
      year,
      contributionsCents,
      loanPaymentsCents: yearPayments.length > 0 || monthly ? sum(yearPayments.map((r) => r.cents)) : null,
      borrowedCents: sum(yearBorrowed.map((r) => r.cents)),
      months,
    }
  })

  return { years, hasLoans: payments.length > 0 || borrowed.length > 0 }
}

/** Totals over the years shown (repayments only where known). */
export function yearByYearTotals(view: YearByYear) {
  return {
    contributionsCents: sum(view.years.map((y) => y.contributionsCents)),
    loanPaymentsCents: sum(view.years.map((y) => y.loanPaymentsCents ?? ZERO)),
    borrowedCents: sum(view.years.map((y) => y.borrowedCents)),
  }
}

/** A month's or a year's total paid in: contributions and loan repayments. */
export const paidIn = (f: { contributionsCents: Cents; loanPaymentsCents: Cents | null }) => add(f.contributionsCents, f.loanPaymentsCents ?? ZERO)

/**
 * A member's year by year from the database. Older loans count when linked
 * to the member by ID (M9), from `olderLoansFrom` on: the member portal
 * lists them from 2024, as its Payment History does.
 */
export async function loadYearByYear(db: Db, memberId: string, { olderLoansFrom = 0, now = new Date() }: { olderLoansFrom?: number; now?: Date } = {}): Promise<YearByYear> {
  const [yearlyTotals, contributions, loanPayments, loans, historicalLoans] = await Promise.all([
    db.yearlyTotal.findMany({ where: { memberId }, select: { year: true, amount: true } }),
    db.contribution.findMany({ where: { memberId }, select: { paymentDate: true, amountCents: true, reversedAt: true } }),
    db.loanPayment.findMany({ where: { borrowerId: memberId }, select: { paymentDate: true, amount: true, paymentMethod: true } }),
    db.loan.findMany({ where: { borrowerId: memberId }, select: { loanDate: true, disbursedOn: true, loanAmount: true, origin: true, lifecycle: true } }),
    db.historicalLoan.findMany({ where: { borrowerId: memberId, year: { gte: olderLoansFrom } }, select: { loanDate: true, loanAmount: true } }),
  ])
  return yearByYear({ yearlyTotals, contributions, loanPayments, loans, historicalLoans, today: todayIso(now) })
}
