'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarRange, CircleCheck, Handshake, Landmark, PiggyBank, Undo2 } from 'lucide-react'
import { cn, fmt$, fmtDate } from '@/lib/utils'
import { plural } from '@/components/ui'
import { Empty, PageHeader, PageSkeleton, Panel, Pill, Row, Rows, Stat } from '@/components/portal/kit'

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
  const max = Math.max(...allYears.map(a => a.amount), 1)

  return (
    <div className="space-y-6">
      <PageHeader title="Payment History" sub={`${plural(paidYears, 'year')} of contributions · ${fmt$(totalLifetime)} in total`} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        <Stat icon={PiggyBank} label="Total by year" value={fmt$(totalLifetime)} hint="All the years below" />
        <Stat icon={CalendarRange} label="Years contributing" value={paidYears} />
        <div className="col-span-2 md:col-span-1">
          <Stat icon={CircleCheck} label="This year" value={fmt$(total2026)} hint={plural(contributions2026.filter((c: any) => !c.reversedAt).length, 'payment')} />
        </div>
      </div>

      <Panel title="Contributions by year" icon={CalendarRange}>
        {allYears.length === 0 ? (
          <Empty icon={PiggyBank} title="No contributions recorded yet" />
        ) : (
          <ul className="space-y-2.5">
            {[...allYears].reverse().map((y) => (
              <li key={y.year} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3">
                <span className={cn('text-sm font-medium tabular-nums', y.live ? 'text-navy' : 'text-gray-600')}>{y.year}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                  <span className={cn('block h-full rounded-full', y.live ? 'bg-gold' : 'bg-navy/70')} style={{ width: `${Math.max((y.amount / max) * 100, y.amount > 0 ? 3 : 0)}%` }} />
                </span>
                <span className="min-w-20 text-right text-sm font-semibold text-gray-900 tabular-nums">{y.amount > 0 ? fmt$(y.amount) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-navy/70" aria-hidden /> Club records (2014–2025)</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-gold" aria-hidden /> This year, payment by payment</span>
        </p>
      </Panel>

      {contributions2026.length > 0 && (
        <Panel title="2026 payments" icon={CircleCheck} sub="Each payment, with its receipt" flush>
          <Rows>
            {contributions2026.map((c: any) => (
              <Row key={c.id}
                icon={c.reversedAt ? Undo2 : CircleCheck} tone={c.reversedAt ? 'gray' : 'green'}
                title={c.reversedAt ? 'Reversed' : c.category === 'voluntary' ? 'Voluntary contribution' : (c.receiptCovers || c.monthYear)}
                meta={<>
                  {fmtDate(c.paymentDate)}
                  {c.paymentMethod ? ` · ${c.paymentMethod}` : ''}
                  {c.receiptNumber && <> · <Link className="font-medium text-navy underline underline-offset-2" href={`/portal/receipts/${c.transactionId}`}>Receipt {c.receiptNumber}</Link></>}
                </>}
                end={<span className={cn('text-sm font-semibold tabular-nums', c.reversedAt ? 'text-gray-400 line-through' : 'text-gray-900')}>{fmt$(c.amount)}</span>}
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
