'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarRange, CircleCheck, Handshake, Landmark, PiggyBank, Receipt, Undo2 } from 'lucide-react'
import { cn, fmt$, fmtDate } from '@/lib/utils'
import { plural } from '@/components/ui'
import { PageHeader, PageSkeleton, Panel, Pill, Row, Rows, surface } from '@/components/portal/kit'
import YearByYear from '@/components/history/YearByYear'

function OlderLoan({ l, who }: { l: any; who: string }) {
  return (
    <Row icon={Landmark} tone={l.balanceRemaining > 0 ? 'amber' : 'gray'}
      title={<>{l.loanId} · {l.year}</>}
      meta={<>{who} · {new Date(l.loanDate).toLocaleDateString('en-US')}</>}
      end={<>
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmt$(l.loanAmount)}</span>
        {l.balanceRemaining > 0 ? <Pill tone="amber">Balance {fmt$(l.balanceRemaining)}</Pill> : <Pill tone="green">Repaid</Pill>}
      </>}
    />
  )
}

export default function PortalHistory() {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    fetch('/api/portal/history').then(r => r.json()).then(setData)
  }, [])

  if (!data) return <PageSkeleton />

  const { yearlyTotals, contributions2026 } = data
  const historicalBorrower = data.historicalLoansAsBorrower || []
  const historicalCosigner = data.historicalLoansAsCosigner || []

  // This year's total from the live contributions
  const total2026 = contributions2026.filter((c: any) => !c.reversedAt).reduce((s: number, c: any) => s + c.amount, 0)

  // Every year: the archive's yearly totals, then this year
  const allYears: { year: number; amount: number; live: boolean }[] = [
    ...yearlyTotals.map((y: any) => ({ year: y.year, amount: y.amount, live: false })),
    ...(total2026 > 0 ? [{ year: 2026, amount: total2026, live: true }] : []),
  ]

  const totalLifetime = allYears.reduce((s, y) => s + y.amount, 0)
  const paidYears     = allYears.filter(y => y.amount > 0).length

  return (
    <div className="space-y-6">
      <PageHeader title="Payment History" sub={`${plural(paidYears, 'year')} of contributions · ${fmt$(totalLifetime)} in total`} />

      {/* The three figures side by side, on phones too. */}
      <dl className={cn(surface, 'grid grid-cols-3 divide-x divide-gray-100')}>
        {[
          { icon: PiggyBank, label: 'In total', value: fmt$(totalLifetime), hint: 'All years' },
          { icon: CircleCheck, label: 'This year', value: fmt$(total2026), hint: plural(contributions2026.filter((c: any) => !c.reversedAt).length, 'payment') },
          { icon: CalendarRange, label: 'Years', value: String(paidYears), hint: 'contributing' },
        ].map(({ icon: Icon, label, value, hint }) => (
          <div key={label} className="min-w-0 px-3 py-3 sm:px-5 sm:py-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><Icon size={14} aria-hidden className="hidden sm:block" /> {label}</dt>
            <dd className="mt-1 truncate text-lg font-semibold tracking-tight text-gray-900 tabular-nums sm:text-2xl">{value}</dd>
            <dd className="text-xs text-gray-500">{hint}</dd>
          </div>
        ))}
      </dl>

      <Panel title="Year by year" icon={CalendarRange} sub={data.yearByYear.hasLoans ? 'Contributions, loan payments and borrowing. Open a year for its months.' : 'Open a year for its months.'} flush>
        <YearByYear data={data.yearByYear} className="border-t border-gray-100" />
      </Panel>

      {contributions2026.length > 0 && (
        <Panel title="2026 payments" icon={CircleCheck} sub="Each payment, with its receipt" flush>
          <Rows>
            {contributions2026.map((c: any) => (
              <Row key={c.id}
                icon={c.reversedAt ? Undo2 : CircleCheck} tone={c.reversedAt ? 'gray' : 'green'}
                title={c.reversedAt ? 'Reversed' : c.category === 'voluntary' ? 'Voluntary contribution' : (c.receiptCovers || c.monthYear)}
                meta={<>{fmtDate(c.paymentDate)}{c.paymentMethod ? ` · ${c.paymentMethod}` : ''}</>}
                end={<>
                  <span className={cn('text-sm font-semibold tabular-nums', c.reversedAt ? 'text-gray-400 line-through' : 'text-gray-900')}>{fmt$(c.amount)}</span>
                  {c.receiptNumber && (
                    <Link href={`/portal/receipts/${c.transactionId}`}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-navy/[0.05] px-2 py-0.5 font-mono text-[11px] text-navy ring-1 ring-inset ring-navy/15 hover:bg-navy/10">
                      <Receipt size={11} aria-hidden /><span className="sr-only">Receipt </span>{c.receiptNumber}
                    </Link>
                  )}
                </>}
              />
            ))}
            <div className="flex justify-between bg-gray-50/70 px-5 py-3 text-sm">
              <span className="text-gray-600">2026 total</span>
              <span className="font-semibold text-gray-900 tabular-nums">{fmt$(total2026)}</span>
            </div>
          </Rows>
        </Panel>
      )}

      {(historicalBorrower.length > 0 || historicalCosigner.length > 0) && (
        <Panel title="Older loans (2021–2025)" icon={Handshake} sub="From the club's records before this system" flush>
          {historicalBorrower.length > 0 && (
            <>
              <p className="border-t border-gray-100 bg-gray-50/70 px-5 py-2 text-xs font-medium text-gray-500">As borrower</p>
              <Rows>{historicalBorrower.map((l: any) => <OlderLoan key={`hb-${l.id}`} l={l} who={`Co-signer: ${l.cosignerName || '—'}`} />)}</Rows>
            </>
          )}
          {historicalCosigner.length > 0 && (
            <>
              <p className="border-t border-gray-100 bg-gray-50/70 px-5 py-2 text-xs font-medium text-gray-500">As co-signer</p>
              <Rows>{historicalCosigner.map((l: any) => <OlderLoan key={`hc-${l.id}`} l={l} who={`Borrower: ${l.borrowerName}`} />)}</Rows>
            </>
          )}
        </Panel>
      )}
    </div>
  )
}
