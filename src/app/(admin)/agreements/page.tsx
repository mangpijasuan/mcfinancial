'use client'
import { useEffect, useState, useCallback } from 'react'
import { FileSignature, Eye } from 'lucide-react'
import { Card, Table, EmptyState, Badge, Button, Modal, PageHeader, FilterBar, SearchInput, Select } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function statusBadge(s: string) {
  if (s === 'fully_signed')   return <Badge variant="green">✓ Fully signed</Badge>
  if (s === 'cosigner_signed') return <Badge variant="blue">Co-signer signed</Badge>
  if (s === 'borrower_signed') return <Badge variant="amber">Borrower signed</Badge>
  if (s === 'cancelled') return <Badge variant="red">Cancelled</Badge>
  return <Badge variant="gray">Pending</Badge>
}

export default function AgreementsPage() {
  const { can } = useStaff()
  const [rows, setRows]         = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState('')
  const [selected, setSelected] = useState<any>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError('')
      const p = new URLSearchParams({ search, status })
      const res = await fetch(`/api/agreements?${p}`)
      const data = await readJsonSafe<any>(res)
      if (!res.ok) throw new Error('Failed to load agreements.')
      setRows(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setRows([])
      setLoadError(err?.message || 'Failed to load agreements.')
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => { load() }, [load])

  async function cancelAgreement(agreementId: string) {
    if (!confirm(`Cancel application ${agreementId}? The loan and agreement are kept, marked cancelled.`)) return
    const res = await fetch(`/api/agreements/${agreementId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    if (res.ok) load()
    else alert((await res.json().catch(() => ({}))).error || 'Could not cancel this agreement.')
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Loan Application"
        sub={`${rows.length} agreements · ${rows.filter(r => r.status === 'fully_signed').length} fully signed`}
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search borrower or ID…" />
        <Select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="borrower_signed">Borrower signed</option>
          <option value="cosigner_signed">Co-signer signed</option>
          <option value="fully_signed">Fully signed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </FilterBar>

      {loadError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{loadError}</p>
      )}

      <Card>
        <Table loading={loading} headers={['Agreement ID', 'Loan ID', 'Borrower', 'Co-signer', 'Amount', 'Fee', 'Created', 'Status', 'Actions']}>
          {rows.length === 0 && !loading
            ? <EmptyState message="No agreements yet." />
            : rows.map(a => (
              <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{a.agreementId}</td>
                <td className="px-4 py-3 font-mono text-xs text-purple-600">{a.loanId}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{a.borrowerName}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{a.cosignerName || '—'}</td>
                <td className="px-4 py-3 font-semibold text-gray-900">{fmt$(a.loanAmount)}</td>
                <td className="px-4 py-3 text-amber-700 font-medium">{fmt$(a.applicationFee)}</td>
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                <td className="px-4 py-3">{statusBadge(a.status)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setSelected(a)}>
                    <Eye size={13} /> View
                    </Button>
                    {a.status !== 'cancelled' && can('loans.cancel') && (
                      <Button size="sm" variant="danger" onClick={() => cancelAgreement(a.agreementId)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          }
        </Table>
      </Card>

      {selected && (
        <AgreementModal
          agreement={selected}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load() }}
        />
      )}
    </div>
  )
}

function AgreementModal({ agreement: initial, onClose, onSaved }: any) {
  const { can } = useStaff()
  const [agreement, setAgreement] = useState(initial)
  const [sig, setSig]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function sign() {
    if (!sig.trim()) { setError('Please type your name to sign.'); return }
    try {
      setSaving(true)
      setError('')
      const res = await fetch(`/api/agreements/${agreement.agreementId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerType: 'lender', signatureText: sig.trim() }),
      })
      if (!res.ok) {
        const d = await readJsonSafe<any>(res)
        setError(d?.error || 'Failed to sign.')
        return
      }
      const updated = await readJsonSafe<any>(res)
      if (updated) setAgreement(updated)
      setSig('')
      onSaved()
    } catch {
      setError('Request failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }


  const a = agreement

  return (
    <Modal open title={`Agreement ${a.agreementId}`} onClose={onClose} width="max-w-2xl">
      {/* Agreement document */}
      <div className="bg-[#fffdf7] border border-amber-200 rounded-2xl mb-5 overflow-hidden shadow-xs">
        {/* Header */}
        <div className="text-center space-y-1 border-b border-amber-200 bg-linear-to-b from-amber-50 to-transparent px-6 py-5">
          <p className="text-lg font-bold font-serif tracking-wide text-gray-900">LOAN AGREEMENT</p>
          <p className="font-sans text-xs uppercase tracking-[0.2em] text-gray-500">Millionaires Club Financial Services</p>
        </div>

        <div className="px-6 py-5 space-y-4 text-[13px] leading-7 font-serif text-gray-800">
          <p>
            <span className="font-bold">${a.loanAmount.toLocaleString()}</span>
            {'  '}
            <span className="text-gray-500">Date: {fmtDate(a.createdAt)}</span>
          </p>
          <p>
            For above value received by{' '}
            <span className="border-b border-gray-400 px-1 font-bold">{a.borrowerName}</span>
            {' '}with a mailing address of{' '}
            <span className="border-b border-gray-400 px-1">{a.borrowerAddress || '________________'}</span>,
            City of <span className="border-b border-gray-400 px-1">{a.borrowerCity || '________________'}</span>,
            State of <span className="border-b border-gray-400 px-1">{a.borrowerState || '________________'}</span>,
            agrees to pay <span className="font-bold">Millionaires Club</span> with no interest.
          </p>

          <div className="rounded-xl border border-amber-100 bg-white/80 px-4 py-3">
            <p className="underline font-bold font-sans text-sm">TERM OF REPAYMENT</p>
            <p className="mt-2">
              <span className="font-bold">A. Payment:</span> The unpaid principal shall be payable in monthly
              installments of <span className="font-bold">${a.monthlyPayment.toFixed(2)}</span>, beginning on{' '}
              <span className="font-bold">{fmtDate(a.startDate)}</span> and ending on{' '}
              <span className="font-bold">{fmtDate(a.endDate)}</span>, at which time the remaining unpaid
              balance shall be due in full.
            </p>
            <p className="mt-2">
              <span className="font-bold">B. Late Fee:</span> The borrower agrees to pay a late charge of{' '}
              <span className="underline font-bold">$5.00</span> for each installment that remains unpaid more
              than 15 days after its due date.
            </p>
            <p className="mt-2">
              <span className="font-bold">C. Prepayment:</span> The borrower has the right to pay back the loan
              in full or make additional payments at any time with no penalty.
            </p>
            {a.applicationFee > 0 && (
              <p className="mt-2">
                <span className="font-bold">D. Application Fee:</span>{' '}
                <span className="font-bold">${a.applicationFee.toFixed(2)}</span> (non-refundable, per loan policy)
                {a.amountPaidOut != null && (
                  <>
                    , deducted from the loan when it is paid out. Amount financed:{' '}
                    <span className="font-bold">${a.loanAmount.toFixed(2)}</span>. Amount paid to the borrower:{' '}
                    <span className="font-bold">${a.amountPaidOut.toFixed(2)}</span>. The borrower repays the amount financed
                  </>
                )}.
              </p>
            )}
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-amber-200">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="font-sans text-xs text-gray-500 mb-1">Lender’s Name</p>
              <p className="font-bold">Millionaires Club</p>
              <p className="font-sans text-xs text-gray-500 mt-3 mb-1">Lender’s Signature</p>
              {a.lenderSignature
                ? <p className="text-green-700 font-bold" style={{fontFamily:'cursive'}}>{a.lenderSignature} ✓</p>
                : <p className="text-gray-400 italic">Not yet signed</p>}
              {a.lenderSignedAt && <p className="text-xs text-gray-400 mt-0.5">{fmtDate(a.lenderSignedAt)}</p>}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="font-sans text-xs text-gray-500 mb-1">Borrower’s Name</p>
              <p className="font-bold">{a.borrowerName}</p>
              <p className="font-sans text-xs text-gray-500 mt-3 mb-1">Borrower’s Signature</p>
              {a.borrowerSignature
                ? <p className="text-green-700 font-bold" style={{fontFamily:'cursive'}}>{a.borrowerSignature} ✓</p>
                : <p className="text-gray-400 italic">Not yet signed — member signs via portal</p>}
              {a.borrowerSignedAt && <p className="text-xs text-gray-400 mt-0.5">{fmtDate(a.borrowerSignedAt)}</p>}
            </div>
            {a.cosignerName && (
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="font-sans text-xs text-gray-500 mb-1">Co-signer’s Name</p>
                <p className="font-bold">{a.cosignerName}</p>
                <p className="font-sans text-xs text-gray-500 mt-3 mb-1">Co-signer’s Signature</p>
                {a.cosignerSignature
                  ? <p className="text-green-700 font-bold" style={{fontFamily:'cursive'}}>{a.cosignerSignature} ✓</p>
                  : <p className="text-gray-400 italic">Not yet signed — co-signer signs via portal</p>}
                {a.cosignerSignedAt && <p className="text-xs text-gray-400 mt-0.5">{fmtDate(a.cosignerSignedAt)}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lender signature: officers who may sign for the club */}
      {!a.lenderSignature && a.status !== 'cancelled' && can('agreements.sign_lender') && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
            <FileSignature size={15} /> Sign as Lender (Millionaires Club)
          </p>
          <div className="flex gap-3">
            <input
              value={sig} onChange={e => setSig(e.target.value)}
              placeholder="Type your full name to sign…" aria-label="Your full name"
              className="flex-1 px-3 py-2 rounded-lg border border-indigo-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
            <Button onClick={sign} disabled={saving || !sig.trim()}>
              {saving ? 'Signing…' : 'Sign'}
            </Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <p className="text-xs text-indigo-600">By typing your name you are electronically signing this agreement on behalf of Millionaires Club.</p>
        </div>
      )}

      <div className="flex justify-end mt-4">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
