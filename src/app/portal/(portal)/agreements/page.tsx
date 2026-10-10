'use client'
import { useEffect, useState } from 'react'
import { cn, fmt$, fmtDate } from '@/lib/utils'
import { FileSignature, CheckCircle, FileText } from 'lucide-react'
import { Modal } from '@/components/ui'
import { Empty, PageHeader, PageSkeleton, Pill, button, field, surface } from '@/components/portal/kit'
import { APP_NAME } from '@/lib/brand'

async function readJsonSafe(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export default function PortalAgreements() {
  const [me, setMe]             = useState<any>(null)
  const [agreements, setAgreements] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        setError('')
        const meRes = await fetch('/api/portal/me')
        const meData = await readJsonSafe(meRes)
        if (!meRes.ok || !meData) throw new Error('Failed to load your portal profile.')
        setMe(meData)

        const agreementsRes = await fetch('/api/agreements')
        const agreementsData = await readJsonSafe(agreementsRes)
        if (!agreementsRes.ok || !agreementsData) throw new Error('Failed to load agreements.')
        setAgreements(Array.isArray(agreementsData) ? agreementsData : [])
      } catch (err: any) {
        setError(err?.message || 'Failed to load agreements.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <PageSkeleton />

  if (error) {
    return <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-600/20">{error}</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Loan Agreements" sub="Read and sign the agreements for your loans, or loans you co-sign." />

      {agreements.length === 0 ? (
        <div className={surface}><Empty icon={FileText} title="No loan agreements yet">When the club approves a loan for you, or one you co-sign, its agreement appears here to sign.</Empty></div>
      ) : (
        <ul className="space-y-3">
          {agreements.map(a => {
            const isBorrower  = a.borrowerId  === me?.id
            const mySignature = isBorrower ? a.borrowerSignature : a.cosignerSignature
            const mySigned    = !!mySignature

            return (
              <li key={a.id} className={cn(surface, 'flex flex-wrap items-center gap-4 p-4 sm:p-5')}>
                <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', mySigned ? 'bg-emerald-50 text-emerald-700' : 'bg-gold/15 text-amber-800')}>
                  {mySigned ? <CheckCircle size={20} aria-hidden /> : <FileSignature size={20} aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-[15px] font-semibold text-gray-900 tabular-nums">{fmt$(a.loanAmount)} · {a.termMonths} months</p>
                    {mySigned
                      ? <Pill tone="green" dot>Signed</Pill>
                      : <Pill tone="amber" dot>Awaiting your signature</Pill>}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {isBorrower ? 'You are the borrower' : 'You are the co-signer'}
                    <span className="text-gray-400"> · </span><span className="font-mono text-xs">{a.agreementId}</span>
                    <span className="text-gray-400"> · </span><span className="font-mono text-xs">Loan {a.loanId}</span>
                  </p>
                </div>
                <button onClick={() => setSelected(a)} className={cn(mySigned ? button.secondary : button.primary, 'w-full sm:w-auto')}>
                  <FileSignature size={16} aria-hidden /> {mySigned ? 'View' : 'Review & sign'}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {selected && me && (
        <SignModal
          agreement={selected}
          me={me}
          onClose={() => setSelected(null)}
          onSigned={(updated: any) => {
            setAgreements(prev => prev.map(a => a.id === updated.id ? updated : a))
            setSelected(updated)
          }}
        />
      )}
    </div>
  )
}

function SignModal({ agreement: initial, me, onClose, onSigned }: any) {
  const [a, setA]         = useState(initial)
  const [sig, setSig]     = useState('')
  const [address, setAddress] = useState({ borrowerAddress: a.borrowerAddress || '', borrowerCity: a.borrowerCity || '', borrowerState: a.borrowerState || '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const isBorrower = a.borrowerId === me.id
  const mySigned   = isBorrower ? !!a.borrowerSignature : !!a.cosignerSignature
  const signerType = isBorrower ? 'borrower' : 'cosigner'

  async function sign() {
    if (!sig.trim()) { setError('Type your full legal name to sign.'); return }
    if (isBorrower && !address.borrowerCity) {
      setError(a.lenderSignature || a.cosignerSignature
        ? 'The signed terms are missing your city. Ask the club to cancel this undisbursed loan and issue a replacement agreement.'
        : 'Please fill in your city.')
      return
    }
    setSaving(true); setError('')
    const res = await fetch(`/api/agreements/${a.agreementId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signerType, signatureText: sig.trim(), ...address }),
    })
    if (res.ok) { const updated = await res.json(); setA(updated); onSigned(updated) }
    else {
      const data = await readJsonSafe(res)
      setError(data?.error || 'Failed to sign. Please try again.')
      setSaving(false)
    }
  }

  return (
    // The shared dialog: focus moves in and stays, Escape closes, focus returns.
    <Modal open onClose={onClose} title={`Loan Agreement — ${a.agreementId}`} width="max-w-2xl">
        <div className="space-y-5">
          {/* Document */}
          <div className="bg-[#fffdf7] border border-amber-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="text-center border-b border-amber-200 bg-linear-to-b from-amber-50 to-transparent px-5 py-4">
              <p className="text-lg font-bold font-serif tracking-wide">LOAN AGREEMENT</p>
              <p className="font-sans text-xs uppercase tracking-[0.2em] text-gray-500">{APP_NAME} Financial Services</p>
            </div>
            <div className="px-5 py-4 space-y-3 text-[13px] leading-7 font-serif text-gray-800">
              <p><strong>${a.loanAmount.toLocaleString()}</strong>{'  '}<span className="text-gray-500">Date: {fmtDate(a.createdAt)}</span></p>
              <p>
                For above value received by <strong>{a.borrowerName}</strong>{' '}
                {a.borrowerAddress && `with a mailing address of ${a.borrowerAddress}, ${a.borrowerCity}, ${a.borrowerState},`}
                {' '}agrees to pay <strong>{APP_NAME}</strong> with no interest.
              </p>
              <div className="rounded-xl border border-amber-100 bg-white/80 px-4 py-3">
                <p className="font-sans font-bold underline text-sm">TERM OF REPAYMENT</p>
                <p><strong>A. Payment:</strong> Monthly installments of <strong>${a.monthlyPayment.toFixed(2)}</strong>, beginning {fmtDate(a.startDate)} and ending {fmtDate(a.endDate)}.</p>
                <p><strong>B. Late Fee:</strong> $5.00 for each installment unpaid more than 15 days after due date.</p>
                <p><strong>C. Prepayment:</strong> Right to pay in full at any time, no penalty.</p>
                {a.applicationFee > 0 && (
                  <p>
                    <strong>D. Application Fee:</strong> ${a.applicationFee.toFixed(2)} (non-refundable)
                    {a.amountPaidOut != null && <>, deducted from the loan when it is paid out. Amount financed: <strong>${a.loanAmount.toFixed(2)}</strong>. Amount paid to you: <strong>${a.amountPaidOut.toFixed(2)}</strong>. You repay the amount financed</>}.
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-amber-200 px-5 py-4">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="font-sans text-gray-400 text-xs">Lender</p>
                <p className="font-bold">{APP_NAME}</p>
                {a.lenderSignature && <p className="text-green-700 mt-1" style={{fontFamily:'cursive'}}>{a.lenderSignature} ✓</p>}
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="font-sans text-gray-400 text-xs">Borrower</p>
                <p className="font-bold">{a.borrowerName}</p>
                {a.borrowerSignature && <p className="text-green-700 mt-1" style={{fontFamily:'cursive'}}>{a.borrowerSignature} ✓</p>}
              </div>
              {a.cosignerName && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="font-sans text-gray-400 text-xs">Co-signer</p>
                  <p className="font-bold">{a.cosignerName}</p>
                  {a.cosignerSignature && <p className="text-green-700 mt-1" style={{fontFamily:'cursive'}}>{a.cosignerSignature} ✓</p>}
                </div>
              )}
            </div>
          </div>

          {/* Sign form */}
          {!mySigned ? (
            <div className="space-y-3 rounded-2xl bg-navy/[0.03] p-4 ring-1 ring-inset ring-navy/10">
              <p className="text-sm font-semibold text-navy">
                Sign as {isBorrower ? 'Borrower' : 'Co-signer'}
              </p>
              {isBorrower && (
                <div className="grid grid-cols-3 gap-3">
                  <input readOnly={!!(a.lenderSignature || a.cosignerSignature || a.borrowerSignature)} value={address.borrowerAddress} onChange={e => setAddress(a => ({...a, borrowerAddress: e.target.value}))} placeholder="Street address" aria-label="Street address" className={cn(field, 'col-span-3')} />
                  <input readOnly={!!(a.lenderSignature || a.cosignerSignature || a.borrowerSignature)} value={address.borrowerCity} onChange={e => setAddress(a => ({...a, borrowerCity: e.target.value}))} placeholder="City *" aria-label="City" required className={field} />
                  <input readOnly={!!(a.lenderSignature || a.cosignerSignature || a.borrowerSignature)} value={address.borrowerState} onChange={e => setAddress(a => ({...a, borrowerState: e.target.value}))} placeholder="State" aria-label="State" className={field} />
                </div>
              )}
              <input value={sig} onChange={e => setSig(e.target.value)} placeholder="Type your full legal name to sign…" aria-label="Your full legal name"
                className={field} />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-600">By typing your name you are electronically signing this agreement.</p>
                <button onClick={sign} disabled={saving || !sig.trim()} className={button.primary}>
                  {saving ? 'Signing…' : 'Sign agreement'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-600/20">
              <CheckCircle size={20} className="shrink-0 text-emerald-600" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-emerald-900">You have signed this agreement</p>
                <p className="text-xs text-emerald-800">Signed on {fmtDate(isBorrower ? a.borrowerSignedAt : a.cosignerSignedAt)}</p>
              </div>
            </div>
          )}
        </div>
    </Modal>
  )
}
