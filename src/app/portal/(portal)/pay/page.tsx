'use client'
import { useEffect, useId, useState } from 'react'
import { statusLabel } from '@/components/ui'
import { useSearchParams } from 'next/navigation'
import { cn, fmt$, fmtDate } from '@/lib/utils'
import { CreditCard, Landmark, Clock, CheckCircle, XCircle, Info, Receipt, Wallet } from 'lucide-react'
import { Empty, PageHeader, PageSkeleton, Pill, Row, Rows, button, field, surface, type Tone } from '@/components/portal/kit'

async function readJsonSafe(res: Response) {
  try { return await res.json() } catch { return null }
}

const STATUS_TONE: Record<string, Tone> = { pending: 'amber', completed: 'green', rejected: 'red', failed: 'gray' }

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
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-600/20">
        <CheckCircle size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-emerald-900">Payment claim submitted</p>
          <p className="mt-0.5 text-sm text-emerald-800">An admin will confirm it once they see the Zelle transfer in the club’s account. It’ll show as pending until then.</p>
        </div>
      </div>
    )
  }

  const methods = [
    { id: 'stripe' as const, label: 'Card', icon: CreditCard, hint: 'Debit or credit card' },
    { id: 'zelle' as const, label: 'Zelle', icon: Landmark, hint: 'Bank transfer' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={amountId} className="mb-1.5 block text-sm font-medium text-gray-800">Amount</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-medium text-gray-400" aria-hidden>$</span>
          <input
            id={amountId} type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            className={cn(field, 'py-3 pl-8 text-lg font-semibold tabular-nums')}
          />
        </div>
        {maxAmount !== undefined && <p className="mt-1.5 text-xs text-gray-500">Remaining balance: <span className="font-medium tabular-nums text-gray-700">{fmt$(maxAmount)}</span></p>}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-gray-800" id={`${amountId}-method`}>Pay with</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby={`${amountId}-method`}>
          {methods.map((m) => (
            <button
              key={m.id} type="button" onClick={() => setMethod(m.id)} aria-pressed={method === m.id}
              className={cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition-colors',
                method === m.id ? 'bg-navy/[0.04] ring-2 ring-navy' : 'bg-white ring-gray-300 hover:bg-gray-50',
              )}
            >
              <m.icon size={18} className={method === m.id ? 'text-navy' : 'text-gray-500'} aria-hidden />
              <span className="leading-tight">
                <span className="block text-sm font-semibold text-gray-900">{m.label}</span>
                <span className="block text-[11px] text-gray-600" aria-hidden>{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {method === 'zelle' && (
        <div className="space-y-3 rounded-xl bg-gray-50 p-4 ring-1 ring-inset ring-gray-900/5">
          <p className="flex gap-2 text-sm text-gray-700">
            <Info size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden />
            {zelleConfigured
              ? <span>Send via Zelle to <strong>{zelleName}</strong>{zelleEmail && <> · <strong>{zelleEmail}</strong></>}, then submit a claim below. It won’t be credited until an admin confirms it.</span>
              : <span>Contact your admin for the club’s Zelle details, then submit a claim below with your confirmation note.</span>}
          </p>
          <input
            value={zelleReference} onChange={e => setZelleReference(e.target.value)}
            placeholder="Optional: confirmation number or note"
            aria-label="Zelle confirmation number or note"
            className={field}
          />
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <button onClick={submit} disabled={submitting} className={cn(button.primary, 'w-full min-h-11')}>
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

  if (loading) return <PageSkeleton />

  const activeLoan = member?.loansAsBorrower?.[0]
  const hasActiveLoan = activeLoan && activeLoan.status === 'Active' && activeLoan.balanceRemaining > 0

  return (
    <div className="space-y-6">
      <PageHeader title="Make a Payment" sub="Pay your monthly contribution or your loan by card or Zelle." />

      {status === 'success' && (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-600/20">
          <CheckCircle size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden /> Payment received! It may take a minute to show up below.
        </div>
      )}
      {status === 'cancelled' && (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-gray-50 p-4 text-sm text-gray-700 ring-1 ring-inset ring-gray-900/10">
          <XCircle size={18} className="mt-0.5 shrink-0 text-gray-500" aria-hidden /> Checkout was cancelled — no charge was made.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* The heading and its form share a parent, so the form is found by its heading. */}
        <section className={cn(surface, 'space-y-4 p-5 sm:p-6')}>
          <h2 className="flex items-center gap-3 text-[15px] font-semibold text-gray-900">
            <span className="flex size-9 items-center justify-center rounded-xl bg-navy/[0.06] text-navy"><Wallet size={18} aria-hidden /></span>
            Pay monthly contribution
          </h2>
          <PayForm type="contribution" defaultAmount={20} zelle={zelle} onDone={load} />
        </section>

        <section className={cn(surface, 'space-y-4 p-5 sm:p-6')}>
          <h2 className="flex items-center gap-3 text-[15px] font-semibold text-gray-900">
            <span className="flex size-9 items-center justify-center rounded-xl bg-navy/[0.06] text-navy"><Landmark size={18} aria-hidden /></span>
            Pay toward my loan
          </h2>
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
            <Empty icon={Landmark} title="No active loan to pay toward" />
          )}
        </section>
      </div>

      <section className={cn(surface, 'overflow-hidden')} aria-labelledby="requests">
        <div className="px-5 pt-5 pb-3">
          <h2 id="requests" className="text-[15px] font-semibold text-gray-900">Your payment requests</h2>
          <p className="text-xs text-gray-500">Card payments and Zelle claims made here, and whether they have been credited.</p>
        </div>
        {payments.length === 0 ? (
          <div className="border-t border-gray-100"><Empty icon={Receipt} title="No online payments yet" /></div>
        ) : (
          <Rows>
            {payments.map((p) => (
              <Row key={p.id}
                icon={p.status === 'completed' ? CheckCircle : p.status === 'rejected' || p.status === 'failed' ? XCircle : Clock}
                tone={STATUS_TONE[p.status] ?? 'gray'}
                title={<>{p.type === 'contribution' ? 'Contribution' : `Loan payment${p.loanId ? ` · ${p.loanId}` : ''}`}<span className="font-normal text-gray-500"> · {p.method === 'stripe' ? 'Card' : 'Zelle'}</span></>}
                meta={<>{fmtDate(p.createdAt)}{p.status === 'rejected' && p.rejectionReason && <span className="block text-red-700">Reason: {p.rejectionReason}</span>}</>}
                end={<>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmt$(p.amount)}</span>
                  <Pill tone={STATUS_TONE[p.status] ?? 'gray'}>{statusLabel(p.status)}</Pill>
                </>}
              />
            ))}
          </Rows>
        )}
      </section>
    </div>
  )
}
