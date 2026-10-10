'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button, Card, Select } from '@/components/ui'
import { fmtDate } from '@/lib/utils'

type Item = { id: string; name: string; type: string }
type Status = {
  configured: boolean
  connected: boolean
  ready: boolean
  environment?: string
  realmId?: string
  connectedAt?: string
  connectedBy?: string
  duesItem?: { id: string; name: string } | null
  loanItem?: { id: string; name: string } | null
}

const RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'QuickBooks is connected. Choose the products for dues and loan repayments below.' },
  cancelled: { ok: false, text: 'QuickBooks was not connected: the sign-in was cancelled.' },
  expired: { ok: false, text: 'That QuickBooks sign-in had expired. Please connect again.' },
  error: { ok: false, text: 'QuickBooks could not be connected. Please try again; if it keeps failing, check the server’s QuickBooks settings.' },
}

/**
 * The Treasurer's QuickBooks connection, which lets members pay by bank
 * transfer (ACH) through QuickBooks invoices (docs/operations/quickbooks.md).
 */
export default function QuickBooksPanel({ onSynced }: { onSynced: () => void }) {
  const params = useSearchParams()
  const result = RESULT[params.get('quickbooks') ?? '']
  const [status, setStatus] = useState<Status | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [dues, setDues] = useState('')
  const [loan, setLoan] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/quickbooks')
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) { setMessage('QuickBooks status could not be loaded.'); return }
    setStatus(data.status)
    setItems(data.items ?? [])
    setDues(data.status.duesItem?.id ?? '')
    setLoan(data.status.loanItem?.id ?? '')
    if (data.error) setMessage(data.error)
  }, [])
  useEffect(() => { load() }, [load])

  async function call(method: 'PATCH' | 'DELETE' | 'POST', url: string, body?: unknown) {
    setBusy(true); setMessage('')
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setMessage(data?.error ?? 'That did not work. Please try again.'); return null }
    return data
  }

  if (!status) return null

  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-800">Bank payments (ACH) through QuickBooks</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Members can pay by bank transfer on a QuickBooks invoice. Paid invoices are recorded here automatically, every few minutes.
          </p>
        </div>
        {status.connected && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.ready ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
            {status.ready ? 'Members can pay by bank' : 'Choose products to finish'}
          </span>
        )}
      </div>

      {result && <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{result.text}</p>}
      {message && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>}

      {!status.configured ? (
        <p className="mt-3 text-sm text-gray-600">
          Not set up on this server yet: the club’s Intuit app settings (QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI) go in
          {' '}<code>.env.production</code>. See <code>docs/operations/quickbooks.md</code>.
        </p>
      ) : !status.connected ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href="/api/quickbooks/connect" className="inline-flex min-h-9 items-center rounded-lg bg-[#1B2A4A] px-4 text-sm font-semibold text-white hover:bg-[#243660]">Connect QuickBooks</a>
          <p className="text-xs text-gray-500">You sign in to Intuit and choose the club’s company. Only a QuickBooks admin can approve it.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-gray-500">
            Company {status.realmId}{status.environment === 'sandbox' ? ' (sandbox: test company, no real money)' : ''} · connected {fmtDate(status.connectedAt ?? null)} by {status.connectedBy}
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              const data = await call('PATCH', '/api/quickbooks', { duesItemId: dues, loanItemId: loan })
              if (data) { setStatus(data.status); setMessage('') }
            }}
          >
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              Product for monthly dues
              <Select aria-label="QuickBooks product for monthly dues" value={dues} onChange={(e) => setDues(e.target.value)} required>
                <option value="">Choose…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              Product for loan repayments
              <Select aria-label="QuickBooks product for loan repayments" value={loan} onChange={(e) => setLoan(e.target.value)} required>
                <option value="">Choose…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </label>
            <Button type="submit" size="sm" disabled={busy || !dues || !loan}>Save products</Button>
          </form>
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
            <Button size="sm" variant="secondary" disabled={busy || !status.ready} onClick={async () => {
              const data = await call('POST', '/api/quickbooks/sync')
              if (data) { setMessage(''); onSynced() }
            }}>Check QuickBooks now</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
              if (!window.confirm('Disconnect QuickBooks? Members will no longer be able to pay by bank until it is connected again.')) return
              const data = await call('DELETE', '/api/quickbooks')
              if (data) setStatus(data.status)
            }}>Disconnect</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
