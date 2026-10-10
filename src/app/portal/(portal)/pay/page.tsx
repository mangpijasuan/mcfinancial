'use client'
import { useEffect, useId, useState } from 'react'
import { statusLabel } from '@/components/ui'
import { useSearchParams } from 'next/navigation'
import { cn, fmt$, fmtDate } from '@/lib/utils'
import { Building2, Check, CreditCard, Copy, Download, ExternalLink, Landmark, ShieldCheck, Clock, CheckCircle, XCircle, Info, Receipt, Wallet } from 'lucide-react'
import { Empty, PageHeader, PageSkeleton, Pill, Row, Rows, button, field, surface, type Tone } from '@/components/portal/kit'
import { BANKS, BANK_STORAGE_KEY, findBank } from '@/components/portal/banks'

async function readJsonSafe(res: Response) {
  try { return await res.json() } catch { return null }
}

const STATUS_TONE: Record<string, Tone> = { pending: 'amber', completed: 'green', rejected: 'red', failed: 'gray' }

type Zelle = { name: string; email: string } | null

/**
 * The member picks their bank once (remembered on this device only), then
 * one tap opens the bank's official website, which on a phone often opens
 * the bank's app. Only the fixed addresses in banks.ts are linked.
 */
function BankOpener() {
  const [bankId, setBankId] = useState('')
  const selectId = useId()
  useEffect(() => {
    try { setBankId(window.localStorage.getItem(BANK_STORAGE_KEY) ?? '') } catch { /* storage blocked: choose each time */ }
  }, [])
  function choose(id: string) {
    setBankId(id)
    try { window.localStorage.setItem(BANK_STORAGE_KEY, id) } catch { /* storage blocked: choose each time */ }
  }
  const bank = findBank(bankId)
  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="sr-only">Your bank</label>
      <div className="flex flex-wrap gap-2">
        <select id={selectId} value={bankId} onChange={(e) => choose(e.target.value)} className={cn(field, 'w-auto min-w-0 flex-1 py-2')}>
          <option value="">Choose your bank…</option>
          {BANKS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          <option value="other">Other bank</option>
        </select>
        {bank && (
          <a href={bank.url} target="_blank" rel="noopener noreferrer" className={cn(button.secondary, 'min-h-10')}>
            Open {bank.name} <ExternalLink size={14} aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      {bank && <p className="text-xs text-gray-600">Opens {bank.name}’s own website. On a phone with its app installed, it may open the app.</p>}
      {bankId === 'other' && <p className="text-xs text-gray-600">Open your bank’s app the usual way and look for Zelle.</p>}
    </div>
  )
}

function Step({ n }: { n: number }) {
  return <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white" aria-hidden>{n}</span>
}

/** One Zelle detail with a button that copies it, so the member can paste it into their bank's app. */
function CopyLine({ label, value, display, copyLabel }: { label: string; value: string; display?: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (an old browser, or not on https): the value stays on screen to type in.
    }
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-gray-500">{label}</p>
        <p className="text-sm font-semibold break-words text-gray-900">{display ?? value}</p>
      </div>
      <button type="button" onClick={copy} aria-label={copyLabel}
        className={cn('inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ring-1 ring-inset transition-colors',
          copied ? 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50')}>
        {copied ? <><Check size={14} aria-hidden /> Copied</> : <><Copy size={14} aria-hidden /> Copy</>}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? `${label} copied` : ''}</span>
    </div>
  )
}

function PayForm({ type, loanId, defaultAmount, maxAmount, zelle, qr, ach, onDone }: {
  type: 'contribution' | 'loan_payment'
  loanId?: string
  defaultAmount: number
  maxAmount?: number
  zelle: Zelle
  qr: boolean
  ach: boolean
  onDone: () => void
}) {
  const [amount, setAmount] = useState(String(defaultAmount))
  const [method, setMethod] = useState<'stripe' | 'ach' | 'zelle'>('stripe')
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
    if (method === 'stripe' || method === 'ach') {
      if (data.url) { window.location.href = data.url; return }
      setError(method === 'ach' ? 'Could not open the bank payment page.' : 'Could not start checkout.')
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
    ...(ach ? [{ id: 'ach' as const, label: 'Bank (ACH)', icon: Building2, hint: 'From your bank account' }] : []),
    { id: 'zelle' as const, label: 'Zelle', icon: Landmark, hint: 'From your bank’s app' },
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
        <div className={cn('grid gap-2', methods.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')} role="group" aria-labelledby={`${amountId}-method`}>
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

      {method === 'ach' && (
        <p className="flex gap-2 rounded-xl bg-gray-50 p-4 text-sm text-gray-700 ring-1 ring-inset ring-gray-900/5">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
          <span>You’ll pay on the club’s secure QuickBooks page, from your bank account. Your bank details are entered there, never here. Bank transfers take a few days: the payment shows here as pending until QuickBooks has it.</span>
        </p>
      )}

      {method === 'zelle' && (
        <div className="space-y-4 rounded-xl bg-gray-50 p-4 ring-1 ring-inset ring-gray-900/5">
          {zelleConfigured || qr ? (
              <ol className="space-y-4 text-sm text-gray-700">
                <li className="flex gap-3">
                  <Step n={1} />
                  <div className="min-w-0 flex-1 space-y-2">
                    {qr && (
                      <>
                        <p>Scan the club’s Zelle QR code with your bank’s app:</p>
                        <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-gray-900/10 sm:flex-row sm:items-center sm:gap-4">
                          <img src="/api/portal/zelle-qr" alt="The club’s Zelle QR code" width={160} height={160} className="size-40 rounded-lg object-contain sm:size-32" />
                          <div className="w-full min-w-0 flex-1 space-y-2 text-center text-xs text-gray-600 sm:text-left">
                            <p>On a computer, scan it with your phone. On a phone, save it, then choose the photo in your bank app’s Zelle scanner (most banks can).</p>
                            <a href="/api/portal/zelle-qr" download="millionaires-club-zelle-qr.png" className={cn(button.secondary, 'min-h-9 w-full px-3 text-xs sm:w-auto')}>
                              <Download size={14} aria-hidden /> Save QR code
                            </a>
                          </div>
                        </div>
                      </>
                    )}
                    {zelleConfigured && (
                      <>
                        <p>{qr ? 'Or copy the club’s Zelle details:' : 'Copy the club’s Zelle details:'}</p>
                        <div className="divide-y divide-gray-100 rounded-xl bg-white ring-1 ring-inset ring-gray-900/10">
                          {zelleName && <CopyLine label="Send to" value={zelleName} copyLabel="Copy name" />}
                          {zelleEmail && <CopyLine label="Zelle email or phone" value={zelleEmail} copyLabel="Copy email" />}
                          {Number(amount) > 0 && <CopyLine label="Amount" value={Number(amount).toFixed(2)} display={fmt$(Number(amount))} copyLabel="Copy amount" />}
                        </div>
                      </>
                    )}
                  </div>
                </li>
                <li className="flex gap-3">
                  <Step n={2} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="pt-0.5">Open your bank’s app, choose <strong>Zelle</strong>, and send the payment.</p>
                    <BankOpener />
                  </div>
                </li>
                <li className="flex gap-3">
                  <Step n={3} />
                  <p className="pt-0.5">Come back and submit your claim below. It won’t be credited until an admin confirms it.</p>
                </li>
              </ol>
          ) : (
            <p className="flex gap-2 text-sm text-gray-700">
              <Info size={16} className="mt-0.5 shrink-0 text-gray-500" aria-hidden />
              <span>Contact your admin for the club’s Zelle details, then submit a claim below with your confirmation note.</span>
            </p>
          )}
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
        {submitting ? 'Please wait…' : method === 'stripe' ? 'Continue to card payment' : method === 'ach' ? 'Continue to bank payment' : 'Submit Zelle claim'}
      </button>
    </div>
  )
}

export default function PortalPayPage() {
  const searchParams = useSearchParams()
  const [member, setMember] = useState<any>(null)
  const [payments, setPayments] = useState<any[]>([])
  const [zelle, setZelle] = useState<Zelle>(null)
  const [zelleQr, setZelleQr] = useState(false)
  const [ach, setAch] = useState(false)
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
      setZelleQr(paymentsData.zelleQr === true)
      setAch(paymentsData.ach === true)
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
          <PayForm type="contribution" defaultAmount={20} zelle={zelle} qr={zelleQr} ach={ach} onDone={load} />
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
              qr={zelleQr}
              ach={ach}
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
                title={<>{p.type === 'contribution' ? 'Contribution' : `Loan payment${p.loanId ? ` · ${p.loanId}` : ''}`}<span className="font-normal text-gray-500"> · {p.method === 'stripe' ? 'Card' : p.method === 'ach' ? 'Bank (ACH)' : 'Zelle'}</span></>}
                meta={<>
                  {fmtDate(p.createdAt)}
                  {p.status === 'rejected' && p.rejectionReason && <span className="block text-red-700">Reason: {p.rejectionReason}</span>}
                  {p.method === 'ach' && p.status === 'pending' && p.qboInvoiceLink && (
                    <span className="block">Not paid yet? <a href={p.qboInvoiceLink} className="font-medium text-navy underline underline-offset-2">Continue on QuickBooks</a></span>
                  )}
                </>}
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
