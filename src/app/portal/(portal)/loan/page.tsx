'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { formatUSD, type Cents } from '@/lib/money'
import type { CosignedLoan, LoanStage, MemberLoan } from '@/modules/loans/memberView'

const usd = (c: number) => formatUSD(c as Cents)

const STAGE: Record<LoanStage, { label: string; className: string }> = {
  repaying: { label: 'Being repaid', className: 'bg-amber-100 text-amber-800' },
  awaiting_payout: { label: 'Waiting to be paid out', className: 'bg-indigo-100 text-indigo-800' },
  paid_off: { label: 'Paid off', className: 'bg-green-100 text-green-800' },
  written_off: { label: 'Written off', className: 'bg-gray-100 text-gray-700' },
}

const INSTALLMENT: Record<string, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-green-100 text-green-800' },
  partly_paid: { label: 'Part paid', className: 'bg-amber-100 text-amber-800' },
  overdue: { label: 'Late', className: 'bg-red-100 text-red-800' },
  due: { label: 'Due', className: 'bg-gray-100 text-gray-700' },
}

function Pill({ label, className }: { label: string; className: string }) {
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${className}`}>{label}</span>
}

function Tile({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'navy' | 'teal' }) {
  const look = tone === 'navy' ? 'bg-[#1B2A4A] text-white' : tone === 'teal' ? 'bg-teal-700 text-white' : 'bg-white border border-gray-200 text-gray-900'
  return (
    <div className={`rounded-xl p-4 shadow-xs ${look}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone === 'plain' ? 'text-gray-500' : 'text-white/75'}`}>{label}</p>
      <p className="text-xl font-bold mt-1 tabular-nums">{value}</p>
    </div>
  )
}

function LoanCard({ loan }: { loan: MemberLoan }) {
  const stage = STAGE[loan.stage]
  const paidShare = loan.amountCents > 0 ? Math.min(100, Math.round((loan.paidCents / loan.amountCents) * 100)) : 0
  return (
    <section className="space-y-4" aria-labelledby={`loan-${loan.loanId}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`loan-${loan.loanId}`} className="text-lg font-semibold text-gray-900">Loan {loan.loanId}</h2>
        <Pill {...stage} />
        <span className="text-sm text-gray-500">
          {fmtDate(loan.loanDate)} · {loan.termMonths} months{loan.cosigner ? ` · co-signer ${loan.cosigner}` : ''}
        </span>
      </div>

      {loan.overdue && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loan.overdue.amountCents !== null
            ? <><strong>{usd(loan.overdue.amountCents)}</strong> is late{loan.overdue.daysPastDue ? ` (${loan.overdue.daysPastDue} days)` : ''}. Please pay it as soon as you can, or talk to the Treasurer.</>
            : <>A payment on this loan is late. Please pay it as soon as you can, or talk to the Treasurer.</>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Loan" value={usd(loan.amountCents)} tone="navy" />
        <Tile label="Paid so far" value={usd(loan.paidCents)} tone="teal" />
        <Tile label="Still to repay" value={usd(loan.outstandingCents)} />
        {loan.payoffCents !== null
          ? <Tile label="To pay it off today" value={usd(loan.payoffCents)} />
          : <Tile label="Monthly payment" value={usd(loan.monthlyDueCents)} />}
      </div>

      {loan.stage !== 'awaiting_payout' && (
        <div className="w-full bg-gray-100 rounded-full h-2" role="progressbar" aria-valuenow={paidShare} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the loan repaid">
          <div className="bg-green-500 h-2 rounded-full" style={{ width: `${paidShare}%` }} />
        </div>
      )}

      {loan.stage === 'repaying' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm text-gray-700">
            {loan.nextDue
              ? <>Next payment: <strong>{usd(loan.nextDue.amountCents)}</strong> due <strong>{fmtDate(loan.nextDue.date)}</strong></>
              : 'No payment is due right now.'}
            {loan.feesOutstandingCents > 0 && <> · late fees owed: <strong>{usd(loan.feesOutstandingCents)}</strong></>}
          </p>
          <Link href="/portal/pay" className="rounded-lg bg-[#1B2A4A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#243660]">Make a payment</Link>
        </div>
      )}
      {loan.stage === 'awaiting_payout' && (
        <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          This loan is approved. Once the agreement is signed and the money is paid out, its repayment schedule starts here.
          {' '}<Link href="/portal/agreements" className="underline">See the agreement</Link>
        </p>
      )}

      {loan.schedule ? (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Repayment schedule</h3>
            <p className="text-xs text-gray-500 mt-0.5">Interest-free. Each payment pays the oldest unpaid month first; the last month absorbs any rounding.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="px-5 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Due</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold text-right">Paid</th>
                  <th className="px-5 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loan.schedule.map((it) => (
                  <tr key={it.number}>
                    <td className="px-5 py-2.5 text-gray-500">{it.number}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(it.dueDate)}</td>
                    <td className="px-3 py-2.5 text-right">{usd(it.amount)}</td>
                    <td className="px-3 py-2.5 text-right">{usd(it.paid)}</td>
                    <td className="px-5 py-2.5"><Pill {...INSTALLMENT[it.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : loan.stage !== 'awaiting_payout' && (
        <p className="text-xs text-gray-500">This loan was made before the club kept month-by-month schedules, so only its totals are shown.</p>
      )}

      {loan.payments.length > 0 && (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Payments ({loan.payments.length})</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {loan.payments.map((p) => (
              <div key={p.paymentId} className="flex items-center justify-between px-5 py-2.5">
                <p className="text-sm text-gray-800">{fmtDate(p.date)}<span className="text-xs text-gray-400"> · {p.method || '—'} · {p.paymentId}</span></p>
                <span className="font-semibold text-green-700 tabular-nums">{usd(p.amountCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function PortalLoan() {
  const [data, setData] = useState<{ loans: MemberLoan[]; cosigned: CosignedLoan[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/portal/loans')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p className="text-sm text-red-700">Your loan could not be loaded. Please reload the page.</p>
  if (!data) return <div className="space-y-4"><div className="h-8 bg-gray-200 rounded-sm w-48 animate-pulse" /></div>

  const current = data.loans.filter((l) => l.stage === 'repaying' || l.stage === 'awaiting_payout')
  const past = data.loans.filter((l) => l.stage === 'paid_off' || l.stage === 'written_off')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Loan</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your loan’s schedule, what you have paid, and what is left.</p>
      </div>

      {current.length === 0 && (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6 text-sm text-gray-600">
          You have no loan at the moment. Your dashboard shows whether you can borrow and how much.
          {' '}<Link href="/portal/dashboard" className="text-indigo-600 underline">Go to my dashboard</Link>
        </div>
      )}
      {current.map((loan) => <LoanCard key={loan.loanId} loan={loan} />)}

      {data.cosigned.length > 0 && (
        <section className="bg-white rounded-xl shadow-xs border border-gray-200" aria-labelledby="cosigned">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 id="cosigned" className="text-sm font-semibold text-gray-700">Loans you co-sign</h2>
            <p className="text-xs text-gray-500 mt-0.5">As co-signer you answer for these loans if the borrower cannot pay.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {data.cosigned.map((l) => (
              <div key={l.loanId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <p className="text-sm text-gray-800">{l.loanId} · {l.borrowerName}</p>
                <div className="flex items-center gap-2">
                  {l.overdue && <Pill label="Late" className="bg-red-100 text-red-800" />}
                  <Pill {...STAGE[l.stage]} />
                  <span className="text-sm font-semibold tabular-nums">{usd(l.outstandingCents)} left</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <details className="bg-white rounded-xl shadow-xs border border-gray-200">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-700">Earlier loans ({past.length})</summary>
          <div className="space-y-10 px-5 pb-6">
            {past.map((loan) => <LoanCard key={loan.loanId} loan={loan} />)}
          </div>
        </details>
      )}
    </div>
  )
}
