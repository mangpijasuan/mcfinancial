'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Trophy, TrendingUp } from 'lucide-react'
import { Card, Table, EmptyState, LoanStatusBadge, PageHeader, FilterBar, SearchInput, Select, Badge, plural } from '@/components/ui'
import LoanTabs from '@/components/staff/LoanTabs'
import { fmt$, fmtCompact$, fmtDate } from '@/lib/utils'

const START_YEAR = 2021

export default function LoanHistoryPage() {
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: currentYear - START_YEAR + 1 }, (_, i) => START_YEAR + i)

  const [data, setData]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [year, setYear]     = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ search, year, status })
    const res = await fetch(`/api/loan-history?${p}`)
    setData(await res.json())
    setLoading(false)
  }, [search, year, status])

  useEffect(() => { load() }, [load])

  const totalLent = data?.byYear?.reduce((s: number, r: any) => s + (r._sum.loanAmount || 0), 0) || 0
  const totalLoans = data?.byYear?.reduce((s: number, r: any) => s + (r._count?.id || 0), 0) || 0

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Loans"
        sub={`Older loans · ${plural(totalLoans, 'loan')} · ${fmt$(totalLent)} lent`}
        action={<Link href="/loan-history/review" className="inline-flex min-h-6 items-center text-sm text-indigo-700 underline">Link older loans to members</Link>}
      />
      <LoanTabs current="/loan-history" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Year-by-year chart */}
        <Card className="lg:col-span-2 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <TrendingUp size={15} className="text-indigo-500" /> Loans by year
          </h2>
          {data?.byYear && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.byYear} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtCompact$} />
                <Tooltip
                  formatter={(v: number) => [fmt$(v), 'Total lent']}
                  labelFormatter={l => `Year ${l}`}
                />
                <Bar dataKey="_sum.loanAmount" name="Total lent" fill="#1B2A4A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {/* Year pills */}
          {data?.byYear && (
            <div className="flex flex-wrap gap-2 mt-4">
              {data.byYear.map((r: any) => (
                <button key={r.year} onClick={() => setYear(year === String(r.year) ? '' : String(r.year))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${year === String(r.year) ? 'bg-[#1B2A4A] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {r.year} · {plural(r._count?.id || 0, 'loan')} · {fmt$(r._sum.loanAmount)}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Leaderboard */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Trophy size={15} className="text-amber-500" /> Top borrowers (all time)
          </h2>
          <div className="space-y-2.5">
            {data?.leaderboard?.slice(0, 10).map((r: any, i: number) => (
              <div key={`${r.borrowerId ?? ''}:${r.borrowerName}`} className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  i === 0 ? 'bg-amber-400 text-amber-900' :
                  i === 1 ? 'bg-gray-300 text-gray-700' :
                  i === 2 ? 'bg-amber-700 text-amber-100' :
                  'bg-gray-100 text-gray-500'
                }`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.borrowerName}{r.borrowerId && <span className="ml-1 text-xs font-normal text-gray-400">{r.borrowerId}</span>}</p>
                  <p className="text-xs text-gray-400">{plural(r._count?.id || 0, 'loan')} · {fmt$(r._sum.loanAmount)}</p>
                </div>
                <Badge variant={(r._count?.id || 0) >= 3 ? 'red' : (r._count?.id || 0) >= 2 ? 'amber' : 'gray'}>
                  ×{r._count?.id || 0}
                </Badge>
              </div>
            ))}
            {!data?.leaderboard?.length && <p className="text-sm text-gray-400">No data yet.</p>}
          </div>
        </Card>
      </div>

      {/* Loans table */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100">
          <FilterBar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search borrower or loan ID…" />
            <Select aria-label="Year" value={year} onChange={e => setYear(e.target.value)}>
              <option value="">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="Paid Off">Paid off</option>
              <option value="Active">Active</option>
            </Select>
          </FilterBar>
        </div>
        <Table loading={loading} headers={['Loan ID', 'Year', 'Borrower', 'Co-signer', 'Amount', 'Total paid', 'Balance', 'Date', 'Status']}>
          {data?.loans?.length === 0 && !loading
            ? <EmptyState message="No loans found." />
            : data?.loans?.map((l: any) => (
              <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{l.loanId}</td>
                <td className="px-4 py-3">
                  <Badge variant={
                    l.year === 2025 ? 'blue' : l.year === 2024 ? 'purple' :
                    l.year === 2023 ? 'teal' : l.year === 2022 ? 'amber' : 'gray'
                  }>{l.year}</Badge>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                  {l.borrowerId ? <Link href={`/members/${l.borrowerId}`} className="inline-flex min-h-6 items-center hover:underline">{l.borrowerName}</Link> : l.borrowerName}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {l.cosignerId ? <Link href={`/members/${l.cosignerId}`} className="hover:underline">{l.cosignerName}</Link> : l.cosignerName || '—'}
                </td>
                <td className="px-4 py-3 font-semibold text-gray-900">{fmt$(l.loanAmount)}</td>
                <td className="px-4 py-3 text-green-700 font-medium">{fmt$(l.totalPaid)}</td>
                <td className="px-4 py-3 text-gray-700">{l.balanceRemaining > 0 ? fmt$(l.balanceRemaining) : '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(l.loanDate)}</td>
                <td className="px-4 py-3">
                  {l.importedLoanId
                    ? <Link href={`/loans/${l.importedLoanId}`} className="inline-flex min-h-6 items-center text-xs text-indigo-700 underline whitespace-nowrap">In live loans</Link>
                    : <LoanStatusBadge status={l.status} />}
                </td>
              </tr>
            ))
          }
        </Table>
      </Card>
    </div>
  )
}
