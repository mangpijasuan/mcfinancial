'use client'
import { useEffect, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { Card, Select, Table, EmptyState } from '@/components/ui'
import { fmtDate } from '@/lib/utils'

// The monthly contributions report on the Contributions page: the month's
// figures and every member, as in the PDF and CSV it downloads
// (GET /api/reports/monthly, src/modules/contributions/monthlyReport.ts).

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (c: number) => usd.format(c / 100)
const LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** This month and the 23 before it, newest first, as YYYY-MM. */
function recentMonths(today = new Date()) {
  return Array.from({ length: 24 }, (_, i) => {
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() - i, 1))
    return d.toISOString().slice(0, 7)
  })
}

const download = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium'

export default function MonthlyReportCard() {
  const months = recentMonths()
  const [month, setMonth] = useState(months[0])
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setReport(null); setError('')
    fetch(`/api/reports/monthly?month=${month}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !data) setError(data?.error ?? 'The report could not be loaded.')
        else setReport(data)
      })
      // Leaving the page cancels the request: nothing to show then.
      .catch(() => { if (!cancelled) setError('The report could not be loaded.') })
    return () => { cancelled = true }
  }, [month])

  const t = report?.totals
  return (
    <section id="monthly-report" aria-labelledby="monthly-report-title" className="mt-6 scroll-mt-4">
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div>
          <h2 id="monthly-report-title" className="text-base font-bold text-gray-900">Monthly report</h2>
          <p className="mt-0.5 text-xs text-gray-500">Every member and what they paid in the month, with the month’s totals and loan repayments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Report month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{LABEL.format(new Date(`${m}-01T00:00:00Z`))}</option>)}
          </Select>
          <a href={`/api/reports/monthly?month=${month}&format=pdf`} className={`${download} bg-[#1B2A4A] font-semibold text-white hover:bg-[#243660]`}>
            <FileText size={15} aria-hidden /> Download PDF
          </a>
          <a href={`/api/reports/monthly?month=${month}&format=csv`} className={`${download} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
            <Download size={14} aria-hidden /> CSV
          </a>
        </div>
      </div>

      {error && <p role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {t && (
        <dl className="grid grid-cols-2 gap-px border-b border-gray-200 bg-gray-200 md:grid-cols-4">
          {[
            ['Collected', money(t.collectedCents), `${t.payments} ${t.payments === 1 ? 'payment' : 'payments'}`],
            ['Members paid', `${t.paidMembers} of ${t.activeMembers}`, t.activeMembers ? `${Math.round((t.paidMembers / t.activeMembers) * 100)}% of active members` : ''],
            ['No payment this month', String(t.unpaidMembers), 'active members'],
            ['Loan repayments', money(t.repaymentsCents), `${report.repayments.length} received`],
          ].map(([label, value, sub]) => (
            <div key={label} className="bg-white px-5 py-3">
              <dt className="text-xs font-medium text-gray-500">{label}</dt>
              <dd className="text-lg font-bold text-gray-900 tabular-nums">{value}</dd>
              <dd className="text-xs text-gray-500">{sub}</dd>
            </div>
          ))}
        </dl>
      )}

      <Table loading={!report && !error} headers={['Member ID', 'Name', 'Nickname', 'Joined', 'Paid on', 'Amount', 'Method', 'Covers / note']}>
        {report && report.members.length === 0
          ? <EmptyState message="No members to report." />
          : report?.members.map((m: any) => {
            const paid = m.payments.length > 0
            const values = (key: string) => [...new Set(m.payments.map((p: any) => p[key]).filter(Boolean))].join('; ')
            return (
              <tr key={m.memberId} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{m.memberId}</td>
                <td className="px-4 py-2.5 font-medium text-gray-900">{m.name}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{m.nickname || '—'}</td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap text-gray-500">{fmtDate(m.joined)}</td>
                <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${paid ? 'text-gray-700' : 'font-medium text-red-700'}`}>
                  {paid ? m.payments.map((p: any) => fmtDate(p.date)).join(', ') : 'No payment'}
                </td>
                <td className="px-4 py-2.5 font-semibold tabular-nums text-gray-900">{paid ? money(m.paidCents) : '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{values('method') || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{[values('covers'), values('note')].filter(Boolean).join('; ') || '—'}</td>
              </tr>
            )
          })}
      </Table>
    </Card>
    </section>
  )
}
