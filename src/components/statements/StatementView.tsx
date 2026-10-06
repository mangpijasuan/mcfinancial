'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatUSD, type Cents } from '@/lib/money'
import { fmtDate } from '@/lib/utils'
import type { Statement, StatementPeriod } from '@/modules/accounting/statements'

const usd = (c: number) => formatUSD(c as Cents)
const signed = (c: number) => (c > 0 ? `+${usd(c)}` : c < 0 ? `−${usd(-c)}` : usd(0))

/**
 * A member's statement for a month or a year, from the club's ledger. Used
 * by the member portal and, for the same member, by staff (`api` is the
 * statements endpoint of either).
 */
export default function StatementView({ api, historyHref }: { api: string; historyHref?: string }) {
  const [periods, setPeriods] = useState<StatementPeriod[] | null | undefined>(undefined)
  const [period, setPeriod] = useState('')
  const [statement, setStatement] = useState<Statement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(api)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { periods: StatementPeriod[] | null }) => {
        setPeriods(data.periods)
        // Open on the last full month when there is one, else this month.
        const months = (data.periods ?? []).filter((p) => p.kind === 'month')
        setPeriod((months[1] ?? months[0])?.period ?? '')
      })
      .catch(() => setFailed(true))
  }, [api])

  useEffect(() => {
    if (!period) return
    setStatement(null)
    fetch(`${api}/${period}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setStatement)
      .catch(() => setFailed(true))
  }, [api, period])

  if (failed) return <p className="text-sm text-red-700">The statement could not be loaded. Please reload the page.</p>
  if (periods === undefined) return <div className="h-8 bg-gray-200 rounded-sm w-48 animate-pulse" />
  if (periods === null) {
    return (
      <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6 text-sm text-gray-600">
        Statements start once the club&apos;s books are kept in its ledger, from the first month after the changeover.
        {historyHref && <> Until then, the yearly totals are on <Link href={historyHref} className="text-indigo-600 underline">Payment History</Link>.</>}
      </div>
    )
  }

  const months = periods.filter((p) => p.kind === 'month')
  const years = periods.filter((p) => p.kind === 'year')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <label htmlFor="statement-period" className="text-xs font-semibold uppercase tracking-wide text-gray-500">Statement for</label>
          <select
            id="statement-period" value={period} onChange={(e) => setPeriod(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          >
            <optgroup label="Months">{months.map((p) => <option key={p.period} value={p.period}>{p.label}</option>)}</optgroup>
            <optgroup label="Years">{years.map((p) => <option key={p.period} value={p.period}>{p.label}</option>)}</optgroup>
          </select>
        </div>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
          Print
        </button>
      </div>

      {!statement ? <div className="h-40 bg-gray-100 rounded-xl animate-pulse" /> : (
        <article className="bg-white rounded-xl shadow-xs border border-gray-200 print:border-none print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <img src="/brand/mc-logo.svg" alt="" width={56} height={30} />
              <div>
                <h2 className="text-lg font-bold text-gray-900">Statement · {statement.label}</h2>
                <p className="text-sm text-gray-600">{statement.memberName} · {statement.memberId}</p>
                <p className="text-xs text-gray-500">{fmtDate(statement.from)} – {fmtDate(statement.to)}</p>
              </div>
            </div>
            {statement.final
              ? <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">Final</span>
              : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800" title="The month is not closed yet, so entries can still be added.">Provisional</span>}
          </header>

          <div className="divide-y divide-gray-100">
            {statement.sections.map((s) => (
              <section key={s.loanId ?? s.key} className="px-5 py-4 space-y-2" aria-label={s.title}>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">{s.title}</h3>
                  <p className="text-xs text-gray-500">{s.note}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-1.5 pr-3 font-semibold">Date</th>
                        <th className="py-1.5 pr-3 font-semibold">Description</th>
                        <th className="py-1.5 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      <tr className="text-gray-600">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(statement.from)}</td>
                        <td className="py-1.5 pr-3">Balance at the start</td>
                        <td className="py-1.5 text-right font-medium">{usd(s.openingCents)}</td>
                      </tr>
                      {s.lines.length === 0 && (
                        <tr><td colSpan={3} className="py-1.5 text-gray-400">No movements in this period.</td></tr>
                      )}
                      {s.lines.map((l) => (
                        <tr key={l.entryNumber}>
                          <td className="py-1.5 pr-3 whitespace-nowrap align-top">{fmtDate(l.date)}</td>
                          <td className="py-1.5 pr-3">
                            {l.description}
                            <span className="block font-mono text-xs text-gray-500">{l.entryNumber}</span>
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap align-top">{signed(l.amountCents)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold text-gray-900 border-t border-gray-200">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(statement.to)}</td>
                        <td className="py-1.5 pr-3">Balance at the end</td>
                        <td className="py-1.5 text-right">{usd(s.closingCents)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
            From the club&apos;s ledger. A statement for a closed month is final; until the month is closed, entries can still be added.
          </p>
        </article>
      )}
    </div>
  )
}
