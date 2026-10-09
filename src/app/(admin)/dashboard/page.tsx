'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { StatCard, Card, Table, EmptyState, LoanStatusBadge, Badge, plural } from '@/components/ui'
import { fmt$, fmtCompact$, fmtDate } from '@/lib/utils'
import { Users, Landmark, TrendingUp, ShieldCheck, AlertTriangle, Receipt, Trophy, ArrowDownLeft } from 'lucide-react'

export default function DashboardPage() {
  const currentYear = new Date().getFullYear()
  const startYear = 2021

  const [data, setData]       = useState<any>(null)
  const [history, setHistory] = useState<any>(null)
  const [error, setError]     = useState('')

  async function readJsonSafe(res: Response) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        setError('')
        const [dashboardRes, historyRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/loan-history'),
        ])
        const [dashboardData, historyData] = await Promise.all([
          readJsonSafe(dashboardRes),
          readJsonSafe(historyRes),
        ])

        if (!dashboardRes.ok || !historyRes.ok || !dashboardData || !historyData) {
          throw new Error('Failed to load dashboard data.')
        }

        setData(dashboardData)
        setHistory(historyData)
      } catch (err: any) {
        setError(err?.message || 'Failed to load dashboard data.')
      }
    })()
  }, [])

  if (error) {
    return (
      <div className="p-4 sm:p-8">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  if (!data) return (
    <div className="p-4 sm:p-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[...Array(8)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl animate-pulse" />)}
      </div>
    </div>
  )

  const { stats, recentContribs, monthlyBreakdown, activeLoansDetail } = data

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Club overview{data.balanceSource === 'ledger' ? ' · balances from the ledger' : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* Grouped by area. Red only where something needs attention now. */}
        <StatCard tone="plain" label="Active members"       value={stats.activeMembers}            icon={<Users size={18}/>} sub={`of ${stats.totalMembers} · ${stats.inactiveMembers} inactive`} />
        <StatCard tone="plain" label="Eligible for a loan"  value={stats.eligibleMembers}          icon={<ShieldCheck size={18}/>} />
        <StatCard tone="plain" label="Total contributions"  value={fmt$(stats.totalContributions)} icon={<TrendingUp size={18}/>} />
        <StatCard tone="plain" label="Contributions logged" value={fmt$(stats.contributionsLogged ?? 0)} icon={<Receipt size={18}/>} sub="Recorded in this app" />
        <StatCard tone="plain" label="Active loans"         value={stats.activeLoans}              icon={<Landmark size={18}/>} />
        <StatCard tone="plain" label="Outstanding balance"  value={fmt$(stats.outstandingBalance)} sub="Principal still owed" />
        <StatCard tone={stats.overdueLoans > 0 ? 'alert' : 'plain'} label="Overdue loans" value={stats.overdueLoans} icon={<AlertTriangle size={18}/>} sub={stats.overdueLoans > 0 ? 'Need follow-up' : 'None overdue'} />
        <StatCard tone="plain" label="Total withdrawn"      value={fmt$(stats.totalWithdrawn ?? 0)}    icon={<ArrowDownLeft size={18}/>} sub={plural(stats.withdrawalCount ?? 0, 'withdrawal')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly contributions ({currentYear})</h2>
          {monthlyBreakdown.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No monthly data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyBreakdown} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="monthYear" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtCompact$} />
                <Tooltip formatter={(v: number) => fmt$(v)} />
                <Bar dataKey="_sum.amount" name="Contributions" fill="#1B2A4A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Recent contributions</h2>
          <div className="space-y-3">
            {recentContribs.length === 0 && <p className="text-sm text-gray-400">None yet.</p>}
            {recentContribs.map((c: any) => (
              <div key={c.transactionId} className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.memberName}</p>
                  <p className="text-xs text-gray-400">{c.monthYear} · {c.paymentMethod || "—"}</p>
                </div>
                <span className="text-sm font-semibold text-green-700 ml-2">{fmt$(c.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Loans issued by year ({startYear}–{currentYear})</h2>
          {history?.byYear ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={history.byYear} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtCompact$} />
                  <Tooltip formatter={(v: number) => [fmt$(v), "Total lent"]} labelFormatter={(l: any) => "Year " + l} />
                  <Bar dataKey="_sum.loanAmount" name="Total lent" fill="#C9A84C" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-3">
                {history.byYear.map((r: any) => (
                  <div key={r.year} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-center">
                    <p className="text-xs text-gray-400 font-semibold">{r.year}</p>
                    <p className="text-sm font-bold text-gray-800">{plural(r._count?.id || 0, 'loan')}</p>
                    <p className="text-xs text-amber-700 font-semibold">{fmt$(r._sum.loanAmount)}</p>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="h-32 flex items-center justify-center text-sm text-gray-400">Loading history…</div>}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Trophy size={14} className="text-amber-500" /> Top borrowers (all time)
          </h2>
          <div className="space-y-2.5">
            {history?.leaderboard?.slice(0, 8).map((r: any, i: number) => (
              <div key={r.borrowerName} className="flex items-center gap-3">
                <span className={"w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 " + (
                  i === 0 ? "bg-amber-400 text-amber-900" :
                  i === 1 ? "bg-gray-300 text-gray-700" :
                  i === 2 ? "bg-amber-700 text-amber-100" : "bg-gray-100 text-gray-500"
                )}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.borrowerName}</p>
                  <p className="text-xs text-gray-400">{fmt$(r._sum.loanAmount)} total</p>
                </div>
                <Badge variant={(r._count?.id || 0) >= 3 ? "red" : (r._count?.id || 0) >= 2 ? "amber" : "gray"}>x{r._count?.id || 0}</Badge>
              </div>
            ))}
            {!history && <p className="text-sm text-gray-400">Loading…</p>}
          </div>
        </Card>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Active loans ({currentYear})</h2>
        </div>
        <Table headers={["Loan ID", "Borrower", "Amount", "Balance", "Monthly due", "Next due", "Status"]}>
          {activeLoansDetail.length === 0
            ? <EmptyState message="No active loans." />
            : activeLoansDetail.map((l: any) => (
              <tr key={l.loanId} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{l.loanId}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{l.borrowerName}</td>
                <td className="px-4 py-3 text-gray-600">{fmt$(l.loanAmount)}</td>
                <td className="px-4 py-3 font-semibold text-gray-900">{fmt$(l.balanceRemaining)}</td>
                <td className="px-4 py-3 text-gray-600">{fmt$(l.monthlyDue)}</td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(l.nextDueDate)}</td>
                <td className="px-4 py-3"><LoanStatusBadge status="Active" overdue={l.overdue} /></td>
              </tr>
            ))
          }
        </Table>
      </Card>
    </div>
  )
}
