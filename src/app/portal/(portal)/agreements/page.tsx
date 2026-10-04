'use client'
import { useEffect, useState } from 'react'
import { fmt$, fmtDate } from '@/lib/utils'
import { FileSignature, CheckCircle } from 'lucide-react'
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

  if (loading) return <div className="space-y-4"><div className="h-8 bg-gray-200 rounded w-48 animate-pulse"/></div>

  if (error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Loan Agreements</h1>
        <p className="text-sm text-gray-500 mt-0.5">Sign your pending loan agreements below.</p>
      </div>

      {agreements.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">No loan agreements found.</div>
      ) : (
        <div className="space-y-4">
          {agreements.map(a => {
            const isBorrower  = a.borrowerId  === me?.id
            const isCosigner  = a.cosignerId  === me?.id
            const mySignature = isBorrower ? a.borrowerSignature : a.cosignerSignature
            const mySigned    = !!mySignature

            return (
              <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-indigo-600">{a.agreementId}</span>
                      <span className="font-mono text-xs text-gray-400">· Loan {a.loanId}</span>
                      {mySigned
                        ? <span className="bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={10}/> Signed</span>
                        : <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded-full">Awaiting your signature</span>
                      }
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {fmt$(a.loanAmount)} · {a.termMonths} months · {isBorrower ? 'You are the borrower' : 'You are the co-signer'}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelected(a)}
                    className="text-sm text-indigo-600 hover:underline font-medium flex items-center gap-1"
                  >
                    <FileSignature size={14}/> {mySigned ? 'View' : 'Review & sign'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
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
  const isCosigner = a.cosignerId === me.id
  const mySigned   = isBorrower ? !!a.borrowerSignature : !!a.cosignerSignature
  const signerType = isBorrower ? 'borrower' : 'cosigner'

  async function sign() {
    if (!sig.trim()) { setError('Type your full legal name to sign.'); return }
    if (isBorrower && !address.borrowerCity) { setError('Please fill in your city.'); return }
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
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 overflow-y-auto">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="sign-agreement-title" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 id="sign-agreement-title" className="text-base font-semibold">Loan Agreement — {a.agreementId}</h3>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {/* Document */}
          <div className="bg-[#fffdf7] border border-amber-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="text-center border-b border-amber-200 bg-gradient-to-b from-amber-50 to-transparent px-5 py-4">
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
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-indigo-900">
                Sign as {isBorrower ? 'Borrower' : 'Co-signer'}
              </p>
              {isBorrower && (
                <div className="grid grid-cols-3 gap-3">
                  <input value={address.borrowerAddress} onChange={e => setAddress(a => ({...a, borrowerAddress: e.target.value}))} placeholder="Street address" aria-label="Street address" className="col-span-3 px-3 py-2 rounded-lg border border-indigo-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <input value={address.borrowerCity} onChange={e => setAddress(a => ({...a, borrowerCity: e.target.value}))} placeholder="City *" aria-label="City" required className="px-3 py-2 rounded-lg border border-indigo-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <input value={address.borrowerState} onChange={e => setAddress(a => ({...a, borrowerState: e.target.value}))} placeholder="State" aria-label="State" className="px-3 py-2 rounded-lg border border-indigo-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              )}
              <input value={sig} onChange={e => setSig(e.target.value)} placeholder="Type your full legal name to sign…" aria-label="Your full legal name"
                className="w-full px-3 py-2 rounded-lg border border-indigo-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex items-center justify-between">
                <p className="text-xs text-indigo-600">By typing your name you are electronically signing this agreement.</p>
                <button onClick={sign} disabled={saving || !sig.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-indigo-700">
                  {saving ? 'Signing…' : 'Sign agreement'}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle size={20} className="text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">You have signed this agreement</p>
                <p className="text-xs text-green-600">Signed on {fmtDate(isBorrower ? a.borrowerSignedAt : a.cosignerSignedAt)}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
