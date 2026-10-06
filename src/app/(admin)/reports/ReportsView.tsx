'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, Printer } from 'lucide-react'
import { Button, Card, Input, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatUSD, toDecimalString, type Cents } from '@/lib/money'
import type { BalanceSheet, CashFlow, IncomeStatement, LoanPortfolio, ReportLine } from '@/modules/accounting/reports'

type Tab = 'balance' | 'income' | 'cash' | 'loans'
const TABS: { key: Tab; label: string; api: string; range: boolean }[] = [
  { key: 'balance', label: 'Balance sheet', api: 'balance-sheet', range: false },
  { key: 'income', label: 'Income statement', api: 'income-statement', range: true },
  { key: 'cash', label: 'Cash flow', api: 'cash-flow', range: true },
  { key: 'loans', label: 'Loan portfolio', api: 'loan-portfolio', range: false },
]

const usd = (c: number) => formatUSD(c as Cents)
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

type Csv = (string | number)[][]
const dollars = (c: number) => toDecimalString(c as Cents)

// Text a spreadsheet would run as a formula (a name starting with "=") is
// kept as text; amounts like "-5.00" stay numbers.
const cell = (v: string | number) => {
  const text = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && Number.isNaN(Number(v)) ? `'${v}` : String(v)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function download(name: string, rows: Csv) {
  const text = rows.map((r) => r.map(cell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsView({ today }: { today: string }) {
  const [tab, setTab] = useState<Tab>('balance')
  const [asOf, setAsOf] = useState(today)
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [data, setData] = useState<{ tab: Tab; report: any } | null>(null)
  const [error, setError] = useState('')
  const current = TABS.find((t) => t.key === tab)!

  useEffect(() => {
    const query = current.range ? `from=${from}&to=${to}` : `asOf=${asOf}`
    if (current.range ? !(from && to) : !asOf) return
    // A slower answer for an earlier tab or date must not replace this one.
    let chosen = true
    setError('')
    setData(null)
    fetch(`/api/reports/${current.api}?${query}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => null))?.error ?? 'The report could not be loaded.'))))
      .then((report) => { if (chosen) setData({ tab, report }) })
      .catch((e: Error) => { if (chosen) { setData(null); setError(e.message) } })
    return () => { chosen = false }
  }, [tab, current, asOf, from, to])

  const report = data?.tab === tab ? data.report : null
  const period = current.range ? `${fmtDay(from)} – ${fmtDay(to)}` : `as of ${fmtDay(asOf)}`
  const fileDate = current.range ? `${from}_${to}` : asOf

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="print:hidden">
        <PageHeader
          title="Reports"
          sub="From the club's ledger, for any date. The trial balance is on the Ledger page."
          action={<>
            <Button variant="secondary" size="sm" disabled={!report} onClick={() => report && download(`${current.api}_${fileDate}.csv`, toCsv(tab, report))}><Download size={14} /> CSV</Button>
            <Button variant="secondary" size="sm" disabled={!report} onClick={() => window.print()}><Printer size={14} /> Print</Button>
          </>}
        />
        <div role="tablist" aria-label="Report" className="flex flex-wrap gap-1 border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.key ? 'border-[#1B2A4A] font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {current.range ? <>
            <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </> : <Input label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />}
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!report && !error && <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />}
      {report && (
        <Card className="p-5 sm:p-6 print:border-none print:shadow-none print:p-0">
          <header className="mb-4 flex items-center gap-3 border-b border-gray-100 pb-4">
            <img src="/brand/mc-logo.svg" alt="" width={48} height={26} />
            <div>
              <h2 className="text-lg font-bold text-gray-900">{current.label}</h2>
              <p className="text-sm text-gray-500">{period}</p>
            </div>
          </header>
          {tab === 'balance' && <BalanceSheetReport r={report} />}
          {tab === 'income' && <IncomeReport r={report} />}
          {tab === 'cash' && <CashFlowReport r={report} />}
          {tab === 'loans' && <PortfolioReport r={report} />}
        </Card>
      )}
    </div>
  )
}

// ── The reports ────────────────────────────────────────────────────────

function Lines({ title, lines, total, totalLabel, empty }: { title: string; lines: ReportLine[]; total: number; totalLabel: string; empty: string }) {
  return (
    <section className="mb-5" aria-label={title}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <table className="w-full text-sm tabular-nums">
        <tbody className="divide-y divide-gray-50">
          {lines.length === 0 && <tr><td className="py-1.5 text-gray-400" colSpan={2}>{empty}</td></tr>}
          {lines.map((l) => (
            <tr key={l.code || l.name}>
              <td className="py-1.5 pr-3"><span className="mr-2 font-mono text-xs text-gray-400">{l.code}</span>{l.name}</td>
              <td className="py-1.5 text-right whitespace-nowrap">{usd(l.amountCents)}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-200 font-semibold text-gray-900">
            <td className="py-1.5 pr-3">{totalLabel}</td>
            <td className="py-1.5 text-right whitespace-nowrap">{usd(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function Check({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return <p className={cn('text-sm', ok ? 'text-green-700' : 'text-red-700 font-semibold')}>{ok ? good : bad}</p>
}

function BalanceSheetReport({ r }: { r: BalanceSheet }) {
  return <>
    <Lines title="Assets" lines={r.assets} total={r.totalAssetsCents} totalLabel="Total assets" empty="No assets." />
    <Lines title="Liabilities" lines={r.liabilities} total={r.totalLiabilitiesCents} totalLabel="Total liabilities" empty="No liabilities." />
    <Lines title="Equity" lines={r.equity} total={r.totalEquityCents} totalLabel="Total equity" empty="No equity." />
    <Check ok={r.balanced} good="Assets equal liabilities plus equity." bad="Assets do not equal liabilities plus equity: tell the treasurer." />
    <p className="mt-2 text-xs text-gray-500">Whether member capital is a liability or equity is for the club’s accountant to confirm; it is shown as a liability until then.</p>
  </>
}

function IncomeReport({ r }: { r: IncomeStatement }) {
  return <>
    <Lines title="Income" lines={r.income} total={r.totalIncomeCents} totalLabel="Total income" empty="No income in this period." />
    <Lines title="Expenses" lines={r.expenses} total={r.totalExpensesCents} totalLabel="Total expenses" empty="No expenses in this period." />
    <p className="flex justify-between border-t-2 border-gray-300 pt-2 text-sm font-bold text-gray-900 tabular-nums">
      <span>{r.surplusCents < 0 ? 'Deficit' : 'Surplus'} for the period</span><span>{usd(r.surplusCents)}</span>
    </p>
  </>
}

function CashFlowReport({ r }: { r: CashFlow }) {
  return <>
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
          <th className="py-1.5 pr-3 font-semibold">Cash</th>
          <th className="py-1.5 pr-3 text-right font-semibold hidden sm:table-cell">In</th>
          <th className="py-1.5 pr-3 text-right font-semibold hidden sm:table-cell">Out</th>
          <th className="py-1.5 text-right font-semibold">Net</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        <tr className="text-gray-600">
          <td className="py-1.5 pr-3">Cash at the start</td>
          <td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" />
          <td className="py-1.5 text-right">{usd(r.openingCents)}</td>
        </tr>
        {r.rows.length === 0 && <tr><td colSpan={4} className="py-1.5 text-gray-400">No money came in or went out.</td></tr>}
        {r.rows.map((row) => (
          <tr key={row.type}>
            <td className="py-1.5 pr-3">{row.label} <span className="text-xs text-gray-400">({row.entries})</span></td>
            <td className="py-1.5 pr-3 text-right hidden sm:table-cell">{row.inflowCents ? usd(row.inflowCents) : '—'}</td>
            <td className="py-1.5 pr-3 text-right hidden sm:table-cell">{row.outflowCents ? usd(row.outflowCents) : '—'}</td>
            <td className="py-1.5 text-right whitespace-nowrap">{usd(row.netCents)}</td>
          </tr>
        ))}
        <tr className="border-t border-gray-200 font-semibold text-gray-900">
          <td className="py-1.5 pr-3">Cash at the end</td>
          <td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" />
          <td className="py-1.5 text-right">{usd(r.closingCents)}</td>
        </tr>
      </tbody>
    </table>
    {r.internalMoves > 0 && <p className="mt-2 text-xs text-gray-500">{r.internalMoves} {r.internalMoves === 1 ? 'entry' : 'entries'} only moved money between the club’s own accounts (a deposit or a payout) and are not counted.</p>}
    <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Where the cash is</h3>
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-medium">Account</th><th className="py-1 pr-3 text-right font-medium">Start</th><th className="py-1 text-right font-medium">End</th></tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {r.accounts.map((a) => (
          <tr key={a.code}>
            <td className="py-1.5 pr-3"><span className="mr-2 font-mono text-xs text-gray-400">{a.code}</span>{a.name}</td>
            <td className="py-1.5 pr-3 text-right">{usd(a.openingCents)}</td>
            <td className="py-1.5 text-right">{usd(a.closingCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </>
}

function PortfolioReport({ r }: { r: LoanPortfolio }) {
  return <>
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {r.buckets.map((b) => (
        <div key={b.key} className={cn('rounded-lg border p-3', b.key !== 'current' && b.count > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200')}>
          <p className="text-xs text-gray-500">{b.label}</p>
          <p className="text-base font-semibold tabular-nums text-gray-900">{usd(b.outstandingCents)}</p>
          <p className="text-xs text-gray-500">{b.count} {b.count === 1 ? 'loan' : 'loans'}</p>
        </div>
      ))}
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-1.5 pr-3 font-semibold">Loan</th>
            <th className="py-1.5 pr-3 font-semibold">Borrower</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Owed</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Late</th>
            <th className="py-1.5 text-right font-semibold">Days</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {r.loans.length === 0 && <tr><td colSpan={5} className="py-1.5 text-gray-400">No loans owed on this date.</td></tr>}
          {r.loans.map((l) => (
            <tr key={l.loanId}>
              <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/loans/${l.loanId}`} className="text-indigo-700 underline print:no-underline">{l.loanId}</Link></td>
              <td className="py-1.5 pr-3">{l.borrowerName}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">{usd(l.outstandingCents)}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">{l.overdueCents ? usd(l.overdueCents) : '—'}</td>
              <td className={cn('py-1.5 text-right', l.daysPastDue > 0 && 'font-semibold text-amber-800')}>{l.daysPastDue || '—'}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-200 font-semibold text-gray-900">
            <td className="py-1.5 pr-3" colSpan={2}>Total owed</td>
            <td className="py-1.5 pr-3 text-right whitespace-nowrap">{usd(r.totalOutstandingCents)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-gray-500">Days late count from the oldest unpaid installment, with the payments made by that date. The total equals Loans receivable on the balance sheet.</p>
  </>
}

// ── CSV ────────────────────────────────────────────────────────────────

function toCsv(tab: Tab, r: any): Csv {
  const lines = (section: string, rows: ReportLine[]) => rows.map((l) => [section, l.code, l.name, dollars(l.amountCents)])
  if (tab === 'balance') {
    const b = r as BalanceSheet
    return [['Balance sheet as of', b.asOf], ['Section', 'Account', 'Name', 'Amount'],
      ...lines('Assets', b.assets), ['Assets', '', 'Total assets', dollars(b.totalAssetsCents)],
      ...lines('Liabilities', b.liabilities), ['Liabilities', '', 'Total liabilities', dollars(b.totalLiabilitiesCents)],
      ...lines('Equity', b.equity), ['Equity', '', 'Total equity', dollars(b.totalEquityCents)]]
  }
  if (tab === 'income') {
    const s = r as IncomeStatement
    return [['Income statement', s.from, s.to], ['Section', 'Account', 'Name', 'Amount'],
      ...lines('Income', s.income), ['Income', '', 'Total income', dollars(s.totalIncomeCents)],
      ...lines('Expenses', s.expenses), ['Expenses', '', 'Total expenses', dollars(s.totalExpensesCents)],
      ['', '', 'Surplus', dollars(s.surplusCents)]]
  }
  if (tab === 'cash') {
    const c = r as CashFlow
    return [['Cash flow', c.from, c.to], ['Line', 'Entries', 'In', 'Out', 'Net'],
      ['Cash at the start', '', '', '', dollars(c.openingCents)],
      ...c.rows.map((row) => [row.label, row.entries, dollars(row.inflowCents), dollars(row.outflowCents), dollars(row.netCents)]),
      ['Cash at the end', '', '', '', dollars(c.closingCents)]]
  }
  const p = r as LoanPortfolio
  return [['Loan portfolio as of', p.asOf], ['Loan', 'Borrower ID', 'Borrower', 'Loan date', 'Owed', 'Late amount', 'Days late', 'Group'],
    ...p.loans.map((l) => [l.loanId, l.borrowerId, l.borrowerName, l.loanDate, dollars(l.outstandingCents), dollars(l.overdueCents), l.daysPastDue, l.bucket]),
    ['Total', '', '', '', dollars(p.totalOutstandingCents)]]
}
