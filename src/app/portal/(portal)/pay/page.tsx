'use client'
import { useEffect, useId, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmt$, fmtDate } from '@/lib/utils'
import { CreditCard, Landmark, Clock, CheckCircle, XCircle } from 'lucide-react'

async function readJsonSafe(res: Response) {
  try { return await res.json() } catch { return null }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    completed: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    failed: 'bg-gray-100 text-gray-600',
  }
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[status] || map.failed}`}>{status}</span>
}

type Zelle = { name: string; email: string } | null

function PayForm({ type, loanId, defaultAmount, maxAmount, zelle, onDone }: {
  type: 'contribution' | 'loan_payment'
  loanId?: string
  defaultAmount: number
  maxAmount?: number
  zelle: Zelle
  onDone: () => void
}) {
  const [amount, setAmount] = useState(String(defaultAmount))
  const [method, setMethod] = useState<'stripe' | 'zelle'>('stripe')
  const [zelleReference, setZelleReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [zelleSubmitted, setZelleSubmitted] = useState(false)
  const amountId = useId()

  // From the server (ZELLE_RECIPIENT_NAME / _EMAIL), so a change takes effect on restart.
  const zelleName = zelle?.name ?? ''
  const zelleEmail = zelle?.email ?? ''
  const zelleConfigured = zelle !== null

  async function submit() {
    const amt = parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    if (maxAmount && amt > maxAmount) { setError(`Amount cannot exceed ${fmt$(maxAmount)}.`); return }

    setSubmitting(true); setError('')
    const res = await fetch('/api/portal/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, loanId, amount: amt, method, zelleReference: zelleReference.trim() || undefined }),
    })
    const data = await readJsonSafe(res)
    if (!res.ok || !data) {
      setError(data?.error || 'Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }
    if (method === 'stripe') {
      if (data.url) { window.location.href = data.url; return }
      setError('Could not start checkout.')
      setSubmitting(false)
      return
    }
    setZelleSubmitted(true)
    setSubmitting(false)
    onDone()
  }

  if (zelleSubmitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
        <CheckCircle size={18} className="text-green-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-green-800">Payment claim submitted</p>
          <p className="text-xs text-green-600 mt-0.5">An admin will confirm it once they see the Zelle transfer in the club’s account. It’ll show as pending until then.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={amountId} className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
          <input
            id={amountId} type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full pl-6 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {maxAmount !== undefined && <p className="text-xs text-gray-400 mt-1">Remaining balance: {fmt$(maxAmount)}</p>}
      </div>

      <div className="flex gap-2">
        <button
          type="button" onClick={() => setMethod('stripe')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${method === 'stripe' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          <CreditCard size={15} /> Card
        </button>
        <button
          type="button" onClick={() => setMethod('zelle')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${method === 'zelle' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          <Landmark size={15} /> Zelle
        </button>
      </div>

      {method === 'zelle' && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          {zelleConfigured ? (
            <p className="text-xs text-gray-600">
              Send via Zelle to <strong>{zelleName}</strong>{zelleEmail && <> · <strong>{zelleEmail}</strong></>}, then submit a claim below. It won’t be credited until an admin confirms it.
            </p>
          ) : (
            <p className="text-xs text-gray-600">Contact your admin for the club’s Zelle details, then submit a claim below with your confirmation note.</p>
          )}
          <input
            value={zelleReference} onChange={e => setZelleReference(e.target.value)}
            placeholder="Optional: confirmation number or note"
            aria-label="Zelle confirmation number or note"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={submit} disabled={submitting}
        className="w-full bg-[#1B2A4A] hover:bg-[#243660] text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60 text-sm"
      >
        {submitting ? 'Please wait…' : method === 'stripe' ? 'Continue to card payment' : 'Submit Zelle claim'}
      </button>
    </div>
  )
}

export default function PortalPayPage() {
  const searchParams = useSearchParams()
  const [member, setMember] = useState<any>(null)
  const [payments, setPayments] = useState<any[]>([])
  const [zelle, setZelle] = useState<Zelle>(null)
  const [loading, setLoading] = useState(true)

  const status = searchParams.get('status')

  async function load() {
    const [meRes, paymentsRes] = await Promise.all([
      fetch('/api/portal/me'),
      fetch('/api/portal/payments'),
    ])
    const me = await readJsonSafe(meRes)
    const paymentsData = await readJsonSafe(paymentsRes)
    if (me) setMember(me)
    if (paymentsData) {
      setPayments(paymentsData.payments || [])
      setZelle(paymentsData.zelle ?? null)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="space-y-4"><div className="h-8 bg-gray-200 rounded-sm w-48 animate-pulse" /></div>

  const activeLoan = member?.loansAsBorrower?.[0]
  const hasActiveLoan = activeLoan && activeLoan.status === 'Active' && activeLoan.balanceRemaining > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Make a Payment</h1>
        <p className="text-sm text-gray-500 mt-0.5">Pay your monthly contribution or your loan by card or Zelle.</p>
      </div>

      {status === 'success' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
          Payment received! It may take a minute to show up below.
        </div>
      )}
      {status === 'cancelled' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
          Checkout was cancelled — no charge was made.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Pay monthly contribution</h2>
          <PayForm type="contribution" defaultAmount={20} zelle={zelle} onDone={load} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Pay toward my loan</h2>
          {hasActiveLoan ? (
            <PayForm
              type="loan_payment"
              loanId={activeLoan.loanId}
              defaultAmount={Math.min(activeLoan.monthlyDue, activeLoan.balanceRemaining)}
              maxAmount={activeLoan.balanceRemaining}
              zelle={zelle}
              onDone={load}
            />
          ) : (
            <p className="text-sm text-gray-400">No active loan to pay toward.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-xs border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Your payment requests</h2>
        </div>
        {payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No online payments yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  {p.status === 'completed' ? <CheckCircle size={16} className="text-green-500 shrink-0" />
                    : p.status === 'rejected' || p.status === 'failed' ? <XCircle size={16} className="text-red-400 shrink-0" />
                    : <Clock size={16} className="text-amber-500 shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {p.type === 'contribution' ? 'Contribution' : `Loan payment${p.loanId ? ` · ${p.loanId}` : ''}`}
                      <span className="text-gray-400 font-normal"> · {p.method === 'stripe' ? 'Card' : 'Zelle'}</span>
                    </p>
                    <p className="text-xs text-gray-400">{fmtDate(p.createdAt)}</p>
                    {p.status === 'rejected' && p.rejectionReason && (
                      <p className="text-xs text-red-500 mt-0.5">Reason: {p.rejectionReason}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{fmt$(p.amount)}</span>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
