'use client'
import { useEffect, useState, useCallback } from 'react'
import { Card, Table, EmptyState, Badge, Button, PageHeader, Select, statusLabel } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'
import QuickBooksPanel from './QuickBooksPanel'

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try { return await res.json() } catch { return null }
}

const METHOD: Record<string, string> = { stripe: 'Card', ach: 'Bank (ACH)', zelle: 'Zelle' }

const statusVariant: Record<string, 'amber' | 'green' | 'red' | 'gray'> = {
  pending: 'amber', completed: 'green', rejected: 'red', failed: 'gray',
}

export default function PaymentsPage() {
  const { can } = useStaff()
  const [stripeIssues, setStripeIssues] = useState<{ eventId: string; type: string; lastError: string | null }[]>([])
  const [achReturns, setAchReturns] = useState<{ publicId: string; amount: number; qboInvoiceId: string | null; qboReturnFlaggedAt: string; member: { legalName: string } | null; memberId: string }[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [status, setStatus] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError('')
      const p = new URLSearchParams(status ? { status } : {})
      const res = await fetch(`/api/payments?${p}`)
      const data = await readJsonSafe<any>(res)
      if (!res.ok || !data) throw new Error('Failed to load payments.')
      setRows(data.payments ?? [])
      setStripeIssues(data.stripeIssues ?? [])
      setAchReturns(data.achReturns ?? [])
    } catch (err: any) {
      setRows([])
      setLoadError(err?.message || 'Failed to load payments.')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  async function confirm(id: string) {
    setBusyId(id)
    const res = await fetch(`/api/payments/${id}/confirm`, { method: 'POST' })
    const data = await readJsonSafe<any>(res)
    if (!res.ok) alert(data?.error || 'Failed to confirm payment.')
    else if (res.status === 202 && data?.approvalRequest) {
      alert(`Over the single sign-off limit: sent for a second approval (${data.approvalRequest.publicId}).`)
    }
    setBusyId(null)
    load()
  }

  async function reject(id: string) {
    const reason = window.prompt('Reason for rejecting this claim? (optional)') || undefined
    setBusyId(id)
    const res = await fetch(`/api/payments/${id}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    })
    const data = await readJsonSafe<any>(res)
    if (!res.ok) alert(data?.error || 'Failed to reject payment.')
    setBusyId(null)
    load()
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Online Payment Review"
        sub="Zelle claims awaiting confirmation, and the history of card and bank (ACH) payments."
      />

      {can('payments.manage_quickbooks') && <QuickBooksPanel onSynced={load} />}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="pending">Pending review</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Failed</option>
          <option value="">All</option>
        </Select>
      </div>

      {loadError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{loadError}</p>
      )}

      {stripeIssues.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <h2 className="font-semibold">Stripe payments needing attention</h2>
          <p className="text-sm">Failed postings retry automatically when the recovery job runs. Refunds and disputes require Treasurer reconciliation.</p>
          <ul className="mt-2 space-y-2 text-sm">{stripeIssues.map(issue => <li key={issue.eventId}>{issue.eventId} · {issue.type}: {issue.lastError}</li>)}</ul>
        </div>
      )}
      {achReturns.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <h2 className="font-semibold">Bank (ACH) payments that may have been returned</h2>
          <p className="text-sm">These were recorded, but QuickBooks now shows their invoice unpaid. Check the bank; if a transfer was returned, reverse the contribution or repayment. Nothing was changed automatically.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {achReturns.map((r) => <li key={r.publicId}>{r.publicId} · {r.member?.legalName ?? r.memberId} · {fmt$(r.amount)} · QuickBooks invoice {r.qboInvoiceId} · flagged {fmtDate(r.qboReturnFlaggedAt)}</li>)}
          </ul>
        </div>
      )}
      <Card>
        <Table loading={loading} headers={['ID', 'Member', 'Type', 'Amount', 'Method', 'Reference', 'Submitted', 'Status', 'Actions']}>
          {rows.length === 0 && !loading
            ? <EmptyState message="No payments found." />
            : rows.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{p.publicId}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{p.member?.legalName || p.memberId}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">
                  {p.type === 'contribution' ? 'Contribution' : `Loan payment${p.loanId ? ` · ${p.loanId}` : ''}`}
                </td>
                <td className="px-4 py-3 font-bold text-gray-900">{fmt$(p.amount)}</td>
                <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{METHOD[p.method] ?? p.method}</td>
                <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                  {p.method === 'ach' ? (p.qboInvoiceId ? `QuickBooks invoice ${p.qboInvoiceId}` : '—') : p.zelleReference || '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(p.createdAt)}</td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant[p.status] || 'gray'}>{statusLabel(p.status)}</Badge>
                  {p.qboReturnFlaggedAt && <p className="text-xs text-red-700 mt-1">Unpaid again in QuickBooks: check the bank</p>}
                  {(p.status === 'rejected' || (p.method === 'ach' && p.status === 'failed')) && p.rejectionReason && (
                    <p className="text-xs text-gray-400 mt-1">{p.rejectionReason}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {p.status === 'pending' && p.awaitingApproval ? (
                    <span className="text-xs text-amber-700">Awaiting second approval ({p.awaitingApproval})</span>
                  ) : p.status === 'pending' && p.method === 'zelle' && can('payments.review') ? (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busyId === p.id} onClick={() => confirm(p.id)}>Confirm</Button>
                      <Button size="sm" variant="danger" disabled={busyId === p.id} onClick={() => reject(p.id)}>Reject</Button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">
                      {p.reviewedBy ? `by ${p.reviewedBy}` : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))
          }
        </Table>
      </Card>
    </div>
  )
}
