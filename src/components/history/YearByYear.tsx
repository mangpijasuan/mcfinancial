'use client'
// A member's money with the club, year by year: each year shows its totals
// and opens into its months, as /api/portal/history and /api/members/[id]
// return them (src/modules/membership/yearByYear.ts). Amounts are in cents.
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type Month = { month: string; contributionsCents: number; loanPaymentsCents: number; borrowedCents: number }
type Year = { year: number; contributionsCents: number; loanPaymentsCents: number | null; borrowedCents: number; months: Month[] | null }
export type YearByYearData = { years: Year[]; hasLoans: boolean }

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (c: number) => usd.format(c / 100)
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
const monthName = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`))

/** An amount, or a dash when it is zero, so the months with activity stand out. */
function Amount({ cents, strong }: { cents: number; strong?: boolean }) {
  return <span className={cn('tabular-nums', cents === 0 ? 'text-gray-400' : strong ? 'font-semibold text-gray-900' : 'text-gray-800')}>{cents === 0 ? '—' : money(cents)}</span>
}

function YearTable({ year, hasLoans }: { year: Year; hasLoans: boolean }) {
  const months = year.months!
  const cell = 'px-2 py-2.5 text-right whitespace-nowrap sm:px-3'
  return (
    // Fits a phone; on a very narrow screen it scrolls, and the keyboard can scroll it too.
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${year.year} month by month`}>
      <table className="w-full text-sm">
        <caption className="sr-only">{year.year} month by month</caption>
        <thead>
          <tr className="bg-gray-50 text-xs font-medium text-gray-500">
            <th scope="col" className="px-2 py-2 text-left sm:px-3">Month</th>
            <th scope="col" className="px-2 py-2 text-right sm:px-3">Contributions</th>
            {hasLoans && <th scope="col" className="px-2 py-2 text-right sm:px-3">Loan payments</th>}
            {hasLoans && <th scope="col" className="px-2 py-2 text-right sm:px-3">Borrowed</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row" className="px-2 py-2.5 text-left font-normal text-gray-700 sm:px-3">{monthName(m.month)}</th>
              <td className={cell}><Amount cents={m.contributionsCents} /></td>
              {hasLoans && <td className={cell}><Amount cents={m.loanPaymentsCents} /></td>}
              {hasLoans && <td className={cell}><Amount cents={m.borrowedCents} /></td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
            <th scope="row" className="px-2 py-2.5 text-left sm:px-3">Total</th>
            <td className={cell}>{money(year.contributionsCents)}</td>
            {hasLoans && <td className={cell}>{money(year.loanPaymentsCents ?? 0)}</td>}
            {hasLoans && <td className={cell}>{money(year.borrowedCents)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function YearByYear({ data, className }: { data: YearByYearData; className?: string }) {
  const { years, hasLoans } = data
  if (years.length === 0) return <p className="px-5 py-8 text-center text-sm text-gray-500">No contributions recorded yet.</p>
  return (
    <ul className={cn('divide-y divide-gray-100', className)}>
      {years.map((y, i) => (
        <li key={y.year}>
          <details className="group" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
              <span className="text-base font-semibold text-gray-900 tabular-nums">{y.year}</span>
              <span className="ml-auto text-right">
                <span className="block text-base font-semibold text-gray-900 tabular-nums">{money(y.contributionsCents)}</span>
                {hasLoans && (y.loanPaymentsCents || y.borrowedCents) ? (
                  <span className="block text-xs text-gray-500 tabular-nums">
                    {[y.loanPaymentsCents ? `${money(y.loanPaymentsCents)} loan payments` : null, y.borrowedCents ? `${money(y.borrowedCents)} borrowed` : null].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
              <ChevronDown size={18} className="shrink-0 text-gray-400 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="px-3 pb-4 sm:px-5">
              {y.months ? <YearTable year={y} hasLoans={hasLoans} /> : (
                <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                  The club&apos;s records for {y.year} keep the year&apos;s total only: {money(y.contributionsCents)} contributed
                  {y.borrowedCents > 0 && <>, {money(y.borrowedCents)} borrowed</>}
                  {y.loanPaymentsCents !== null && y.loanPaymentsCents > 0 && <>, {money(y.loanPaymentsCents)} in loan payments</>}.
                </p>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
