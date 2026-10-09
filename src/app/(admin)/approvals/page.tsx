'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Badge, Button, PageHeader, Select } from '@/components/ui'
import { formatUSD, type Cents } from '@/lib/money'

type Request = {
  id: string; publicId: string; label: string; summary: string; amountCents: number | null; status: string
  requestedBy: { name: string; email: string }; requestedAt: string; decidedAt: string | null; decisionNote: string | null
  resultRef: string | null; approvalsRequired: number
  decisions: { decider: { name: string }; decision: string; note: string | null; at: string }[]
  canDecide: boolean; blockedReason: string | null; isMine: boolean
}

const statusVariant: Record<string, 'amber' | 'green' | 'red' | 'gray'> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }

export default function ApprovalsPage() {
  const [view, setView] = useState<'pending' | 'decided'>('pending')
  const [requests, setRequests] = useState<Request[]>([])
  const [enforced, setEnforced] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/approvals?view=${view}`, { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) { setError(data?.error || 'Could not load approvals.'); return }
    setRequests(data.requests); setEnforced(data.makerCheckerEnforced)
  }, [view])
  useEffect(() => { load() }, [load])

  async function act(r: Request, verb: 'approve' | 'reject' | 'cancel') {
    let note: string | null = null
    if (verb === 'reject') {
      note = window.prompt(`Why are you rejecting ${r.publicId}?`)
      if (!note) return
    }
    if (verb === 'approve' && !window.confirm(`Approve ${r.publicId}? It takes effect immediately:\n\n${r.summary}`)) return
    setBusy(r.id); setError(''); setMessage('')
    const res = await fetch(`/api/approvals/${r.id}/${verb}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }),
    })
    const data = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) { setError(data?.error || 'That did not work.'); load(); return }
    setMessage(verb === 'approve'
      ? (data.status === 'approved' ? `Approved; done${data.resultRef ? ` (${data.resultRef})` : ''}.` : 'Approval recorded; another approval is still needed.')
      : verb === 'reject' ? 'Rejected. Nothing was changed.' : 'Withdrawn.')
    load()
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <PageHeader
        title="Approvals"
        sub="Maker / checker: actions that need a second person. Whoever proposed something can never approve it."
      />
      {enforced === false && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Maker/checker is <strong>not yet switched on</strong> for Zelle confirmations, withdrawals and loans: they take effect with one
          person, as before. It is switched on once the officers are named (Gate #1 A4). Manual journal entries always need a second person.
        </p>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      <div className="flex gap-3">
        <Select aria-label="Show" value={view} onChange={(e) => setView(e.target.value as 'pending' | 'decided')}>
          <option value="pending">Waiting for approval</option>
          <option value="decided">Recently decided</option>
        </Select>
      </div>

      <div className="space-y-3">
        {requests.length === 0 && <Card><p className="py-16 text-center text-gray-400 text-sm">{view === 'pending' ? 'Nothing is waiting for approval.' : 'No decisions yet.'}</p></Card>}
        {requests.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-indigo-600">{r.publicId}</span>
                  <Badge variant={statusVariant[r.status] ?? 'gray'}>{r.status}</Badge>
                  <span className="text-xs text-gray-500">{r.label}</span>
                </div>
                <p className="mt-1 font-medium text-gray-900 wrap-break-word">{r.summary}</p>
                {r.amountCents !== null && <p className="text-sm text-gray-700">{formatUSD(r.amountCents as Cents)}</p>}
                <p className="mt-1 text-xs text-gray-500">
                  Proposed by {r.requestedBy.name} · {new Date(r.requestedAt).toLocaleString()}
                  {r.approvalsRequired > 1 ? ` · needs ${r.approvalsRequired} approvals` : ''}
                </p>
                {r.decisions.map((d, i) => (
                  <p key={i} className="text-xs text-gray-600">
                    {d.decision === 'approve' ? 'Approved' : 'Rejected'} by {d.decider.name} · {new Date(d.at).toLocaleString()}{d.note ? ` — ${d.note}` : ''}
                  </p>
                ))}
                {r.resultRef && <p className="text-xs text-emerald-700">Result: {r.resultRef}</p>}
                {r.status === 'cancelled' && r.decisionNote && <p className="text-xs text-gray-500">{r.decisionNote}</p>}
              </div>
              {r.status === 'pending' && (
                <div className="flex flex-col items-stretch gap-2 md:items-end md:shrink-0">
                  {r.canDecide ? (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy === r.id} onClick={() => act(r, 'approve')}>Approve</Button>
                      <Button size="sm" variant="danger" disabled={busy === r.id} onClick={() => act(r, 'reject')}>Reject</Button>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 md:text-right max-w-xs">{r.blockedReason}</p>
                  )}
                  {r.isMine && <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => act(r, 'cancel')}>Withdraw</Button>}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
