'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { eligibilityText, fmt$, fmtDate } from '@/lib/utils'
import { formatUSD } from '@/lib/money'
import { DuesMonths, DuesSummary, type DuesData } from '@/components/contributions/DuesPanel'

function InfoCard({ label, value, sub, color = 'white' }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    white:  'bg-white border border-gray-200',
    green:  'bg-green-600 text-white',
    amber:  'bg-amber-500 text-white',
    red:    'bg-red-600 text-white',
    navy:   'bg-[#1B2A4A] text-white',
    teal:   'bg-teal-600 text-white',
  }
  const textColor = color === 'white' ? 'text-gray-900' : 'text-white'
  const subColor  = color === 'white' ? 'text-gray-500' : 'text-white/70'
  return (
    <div className={`rounded-xl p-5 shadow-xs ${colors[color]}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${color === 'white' ? 'text-gray-400' : 'text-white/70'}`}>{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColor}`}>{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${subColor}`}>{sub}</p>}
    </div>
  )
}

function StatusPill({ paid }: { paid: string }) {
  if (paid === 'PAID') return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800">
      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Paid this month
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-900">
      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> This month not paid yet
    </span>
  )
}

export default function PortalDashboard() {
  const [member, setMember] = useState<any>(null)
  const [dues, setDues] = useState<DuesData | null>(null)

  useEffect(() => {
    fetch('/api/portal/me').then(r => r.json()).then(setMember)
    fetch('/api/portal/dues').then(r => (r.ok ? r.json() : null)).then(setDues).catch(() => setDues(null))
  }, [])

  if (!member) return (
    <div className="space-y-4">
      <div className="h-8 bg-gray-200 rounded-lg w-48 animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse" />)}
      </div>
    </div>
  )

  const activeLoan = member.loansAsBorrower?.[0]
  const eligible = member.eligible === 'YES'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{member.legalName}</h1>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-gray-500">{member.id} {member.nickname && `· "${member.nickname}"`}</span>
          <StatusPill paid={member.thisMonth} />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard label="Member since"     value={fmtDate(member.joinDate)}          color="white" />
        <InfoCard label="Months active"    value={member.monthsActive}               color="white" />
        <InfoCard label="Lifetime contributions" value={fmt$(member.archiveLifetime + member.contributions2026)} color="white" />
        {eligible
          ? <InfoCard label="You can borrow up to" value={fmt$(member.maxLoanAmount)} color="white" />
          : <InfoCard label="Borrowing" value="Not now" sub={eligibilityText(member.eligible, true)} color="white" />}
      </div>

      {/* Monthly dues */}
      {dues && dues.obligations.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-xs border border-gray-200 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Monthly dues{dues.monthlyCents !== null ? ` · ${formatUSD(dues.monthlyCents)} a month` : ''}</h2>
            <Link href="/portal/history" className="inline-flex min-h-6 items-center text-xs text-indigo-700 underline">Receipts</Link>
          </div>
          <DuesSummary d={dues} />
          <DuesMonths d={{ ...dues, obligations: dues.obligations.slice(0, 6) }} />
          <p className="text-xs text-gray-400">Each payment counts towards your oldest unpaid month first; anything extra covers the months ahead.</p>
        </div>
      )}

      {/* Status + recent contributions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Loan eligibility */}
        <div className={`rounded-xl p-5 shadow-xs border ${eligible ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Loan eligibility</h2>
          {eligible ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl font-bold text-green-700">✓ Eligible</span>
              </div>
              <p className="text-sm text-green-700">You can borrow up to <strong>{fmt$(member.maxLoanAmount)}</strong></p>
              <p className="text-xs text-green-600 mt-1">Contact your club admin to apply.</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">{eligibilityText(member.eligible)}</p>
              {member.currentLoanBalance > 0 && (
                <p className="text-xs text-gray-500">Current loan balance: <strong>{fmt$(member.currentLoanBalance)}</strong></p>
              )}
            </div>
          )}
        </div>

        {/* Active loan */}
        <div className="bg-white rounded-xl p-5 shadow-xs border border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Active loan</h2>
          {activeLoan && activeLoan.status === 'Active' ? (
            <div>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-mono text-xs text-indigo-600 whitespace-nowrap">{activeLoan.loanId}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-0.5">{fmt$(activeLoan.balanceRemaining)}</p>
                  <p className="text-xs text-gray-500">remaining of {fmt$(activeLoan.loanAmount)}</p>
                </div>
                {activeLoan.overdue && (
                  <span className="bg-red-100 text-red-800 text-xs font-semibold px-2 py-1 rounded-full">⚠ Overdue</span>
                )}
              </div>
              {/* Progress bar */}
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${Math.round((activeLoan.totalPaid / activeLoan.loanAmount) * 100)}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                <div><span className="text-gray-400">Monthly due</span><br /><strong className="text-gray-800">{fmt$(activeLoan.monthlyDue)}</strong></div>
                <div><span className="text-gray-400">Next payment</span><br /><strong className="text-gray-800">{fmtDate(activeLoan.nextDueDate)}</strong></div>
                <div><span className="text-gray-400">Total paid</span><br /><strong className="text-green-700">{fmt$(activeLoan.totalPaid)}</strong></div>
                <div><span className="text-gray-400">Term end</span><br /><strong className="text-gray-800">{fmtDate(activeLoan.endDate)}</strong></div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No active loan.</p>
          )}
          {activeLoan && activeLoan.status === 'Active' && (
            <Link href="/portal/loan" className="mt-3 inline-flex min-h-6 items-center text-sm text-indigo-700 underline">See the schedule and payoff →</Link>
          )}
        </div>
      </div>

      {/* Recent contributions */}
      <div className="bg-white rounded-xl shadow-xs border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Recent contributions (2026)</h2>
        </div>
        {member.contributions?.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No contributions recorded yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {member.contributions?.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {c.reversedAt ? 'Reversed' : c.category === 'voluntary' ? 'Voluntary contribution' : (c.receiptCovers || c.monthYear)}
                  </p>
                  <p className="text-xs text-gray-400">
                    Paid {fmtDate(c.paymentDate)} · {c.paymentMethod || '—'}
                    {c.receiptNumber && <> · <Link className="text-indigo-600 underline" href={`/portal/receipts/${c.transactionId}`}>Receipt</Link></>}
                  </p>
                </div>
                <span className={`font-semibold ${c.reversedAt ? 'text-gray-400 line-through' : 'text-green-700'}`}>{fmt$(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-100">
          <a href="/portal/history" className="inline-flex min-h-6 items-center text-sm text-indigo-700 hover:underline">View full payment history →</a>
        </div>
      </div>
    </div>
  )
}
