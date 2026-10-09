'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmt$, fmtDate } from '@/lib/utils'

export default function PortalHistory() {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    fetch('/api/portal/history').then(r => r.json()).then(setData)
  }, [])

  if (!data) return (
    <div className="space-y-4">
      <div className="h-8 bg-gray-200 rounded-lg w-56 animate-pulse" />
      <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
        {[...Array(12)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl animate-pulse" />)}
      </div>
    </div>
  )

  const { yearlyTotals, contributions2026 } = data
  const historicalBorrower = data.historicalLoansAsBorrower || []
  const historicalCosigner = data.historicalLoansAsCosigner || []

  // Build 2026 total from live contributions
  const total2026 = contributions2026.filter((c: any) => !c.reversedAt).reduce((s: number, c: any) => s + c.amount, 0)

  // All years to show (from yearlyTotals + 2026)
  const allYears = [
    ...yearlyTotals.map((y: any) => ({ year: y.year, amount: y.amount, type: 'archive' })),
    ...(total2026 > 0 ? [{ year: 2026, amount: total2026, type: 'live' }] : []),
  ]

  const totalLifetime = allYears.reduce((s, y) => s + y.amount, 0)
  const paidYears     = allYears.filter(y => y.amount > 0).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payment History</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {paidYears} years of contributions · {fmt$(totalLifetime)} lifetime total
        </p>
      </div>

      {/* Year grid */}
      <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Annual contributions</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {allYears.map((y) => (
            <div key={y.year} className={`rounded-xl p-3 text-center border transition-colors ${
              y.amount > 0
                ? y.type === 'live'
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-green-50 border-green-200'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <p className={`text-xs font-semibold ${
                y.amount > 0 ? (y.type === 'live' ? 'text-blue-700' : 'text-green-700') : 'text-gray-400'
              }`}>{y.year}</p>
              <p className={`text-sm font-bold mt-0.5 ${
                y.amount > 0 ? (y.type === 'live' ? 'text-blue-800' : 'text-green-800') : 'text-gray-400'
              }`}>{y.amount > 0 ? fmt$(y.amount) : '—'}</p>
            </div>
          ))}
        </div>

        {/* Bar chart visual */}
        <div className="mt-6">
          <div className="flex items-end gap-1.5 h-24">
            {allYears.map((y) => {
              const max = Math.max(...allYears.map(a => a.amount), 1)
              const pct = Math.max((y.amount / max) * 100, y.amount > 0 ? 4 : 0)
              return (
                <div key={y.year} className="flex-1 h-full flex flex-col items-center gap-1">
                  {/* The bar's height is a share of this box, which fills the chart's height. */}
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-sm transition-all ${
                        y.type === 'live' ? 'bg-blue-400' : y.amount > 0 ? 'bg-green-500' : 'bg-gray-200'
                      }`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 font-medium">
                    {String(y.year).slice(2)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-xs bg-green-500 inline-block" /> Archive (2014–2025)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-xs bg-blue-400 inline-block" /> Live (2026)</span>
        </div>
      </div>

      {/* 2026 transaction detail */}
      {contributions2026.length > 0 && (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">2026 — individual payments</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {contributions2026.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {c.reversedAt ? 'Reversed' : c.category === 'voluntary' ? 'Voluntary contribution' : (c.receiptCovers || c.monthYear)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {fmtDate(c.paymentDate)}
                    {c.paymentMethod ? ` · ${c.paymentMethod}` : ''}
                    {c.receiptNumber && <> · <Link className="text-indigo-600 underline" href={`/portal/receipts/${c.transactionId}`}>Receipt {c.receiptNumber}</Link></>}
                  </p>
                </div>
                <span className={`font-semibold ${c.reversedAt ? 'text-gray-400 line-through' : 'text-green-700'}`}>{fmt$(c.amount)}</span>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex justify-between text-sm">
            <span className="text-gray-500">2026 total</span>
            <span className="font-bold text-gray-900">{fmt$(total2026)}</span>
          </div>
        </div>
      )}

      {/* Historical loans */}
      {(historicalBorrower.length > 0 || historicalCosigner.length > 0) && (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Historical loans (2024–2025)</h2>
          </div>

          {historicalBorrower.length > 0 && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">As borrower</p>
              <div className="space-y-2">
                {historicalBorrower.map((l: any) => (
                  <div key={`hb-${l.id}`} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{l.loanId} · {l.year}</p>
                      <p className="text-xs text-gray-500">Co-signer: {l.cosignerName || '—'} · {new Date(l.loanDate).toLocaleDateString('en-US')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{fmt$(l.loanAmount)}</p>
                      <p className="text-xs text-gray-500">Balance: {l.balanceRemaining > 0 ? fmt$(l.balanceRemaining) : '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {historicalCosigner.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">As co-signer</p>
              <div className="space-y-2">
                {historicalCosigner.map((l: any) => (
                  <div key={`hc-${l.id}`} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{l.loanId} · {l.year}</p>
                      <p className="text-xs text-gray-500">Borrower: {l.borrowerName} · {new Date(l.loanDate).toLocaleDateString('en-US')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{fmt$(l.loanAmount)}</p>
                      <p className="text-xs text-gray-500">Balance: {l.balanceRemaining > 0 ? fmt$(l.balanceRemaining) : '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
