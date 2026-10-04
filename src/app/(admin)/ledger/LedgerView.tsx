'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Table, Badge, Button, PageHeader, Input, Modal, Textarea } from '@/components/ui'
import { formatUSD, type Cents } from '@/lib/money'

type Account = {
  code: string; name: string; type: string; normalBalance: string; subledger: string | null
  description: string | null; status: string; approvedAt: string | null; approvalNote: string | null
}
type TbRow = { code: string; name: string; debit: Cents; credit: Cents; balance: Cents }
type TrialBalance = { rows: TbRow[]; totalDebit: Cents; totalCredit: Cents; balanced: boolean }
type Entry = {
  id: string; entryNumber: string; effectiveDate: string; type: string; description: string
  lines: { account: string; memberId: string | null; loanId: string | null; debit: Cents; credit: Cents }[]
}

const TYPE_LABEL: Record<string, string> = {
  asset: 'Asset', contra_asset: 'Contra-asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense',
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throw new Error(data?.error || `Failed to load ${url}`)
  return data as T
}

export default function LedgerView({ canApprove }: { canApprove: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [tb, setTb] = useState<TrialBalance | null>(null)
  const [asOf, setAsOf] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [checks, setChecks] = useState<{ ok: boolean; problems: string[] } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showApprove, setShowApprove] = useState(false)
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const load = useCallback(async () => {
    try {
      const [a, t, e, c] = await Promise.all([
        getJson<{ accounts: Account[] }>('/api/ledger/accounts'),
        getJson<TrialBalance>(`/api/ledger/trial-balance${asOf ? `?asOf=${asOf}` : ''}`),
        getJson<{ entries: Entry[] }>('/api/ledger/entries'),
        getJson<{ ok: boolean; problems: string[] }>('/api/ledger/invariants'),
      ])
      setAccounts(a.accounts); setTb(t); setEntries(e.entries); setChecks(c)
    } catch (err: any) {
      setError(err.message)
    }
  }, [asOf])
  useEffect(() => { load() }, [load])

  const proposed = accounts.filter((a) => a.status === 'proposed')
  const approved = accounts.find((a) => a.status === 'approved' && a.approvalNote)

  async function approve(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/ledger/accounts/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note, confirm: confirmed }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) { setError(data?.error || 'Could not record the approval.'); return }
    setShowApprove(false); setNote(''); setConfirmed(false)
    setMessage(`${data.approved} accounts approved. The ledger can now accept postings.`)
    load()
  }

  const nonZero = tb?.rows.filter((r) => r.debit !== 0 || r.credit !== 0) ?? []

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <PageHeader
        title="Ledger"
        sub="The club’s double-entry books in exact cents. Posted entries are final; corrections are reversing entries."
        action={
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="/ledger/opening" className="text-sm text-indigo-700 underline">Opening balances (M4) →</a>
            <a href="/ledger/comparison" className="text-sm text-indigo-700 underline">Nightly comparison (M5) →</a>
            <a href="/ledger/reads" className="text-sm text-indigo-700 underline">Ledger reads (M6) →</a>
          </div>
        }
      />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      {proposed.length > 0 ? (
        <Card className="p-5 border-amber-200 bg-amber-50/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-amber-900">Chart of accounts awaiting the accountant’s confirmation</p>
              <p className="mt-1 text-sm text-amber-800">
                {proposed.length} proposed accounts (Gate #1 A13). Nothing can be posted until they are approved. The accountant
                should confirm in particular whether member capital (2000) is a liability or equity.
              </p>
            </div>
            {canApprove && <Button onClick={() => setShowApprove(true)}>Record approval</Button>}
          </div>
        </Card>
      ) : approved && (
        <Card className="p-5 border-emerald-200 bg-emerald-50/60">
          <p className="font-semibold text-emerald-900">Chart of accounts approved</p>
          <p className="mt-1 text-sm text-emerald-800">
            {approved.approvedAt ? new Date(approved.approvedAt).toLocaleDateString() : ''} — {approved.approvalNote}
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">Trial balance</h2>
              <p className="text-xs text-gray-500">Regenerated from posted entries for any date.</p>
            </div>
            <Input label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          {tb && (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <span>Debits <strong>{formatUSD(tb.totalDebit)}</strong></span>
                <span>Credits <strong>{formatUSD(tb.totalCredit)}</strong></span>
                <Badge variant={tb.balanced ? 'green' : 'red'}>{tb.balanced ? 'Balanced' : 'Does not balance'}</Badge>
              </div>
              {nonZero.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No postings{asOf ? ' up to this date' : ' yet'}.</p>
              ) : (
                <ul className="mt-4 divide-y divide-gray-100 text-sm">
                  {nonZero.map((r) => (
                    <li key={r.code} className="flex justify-between gap-3 py-2">
                      <span className="min-w-0"><span className="font-mono text-gray-500">{r.code}</span> {r.name}</span>
                      <span className="font-medium tabular-nums">{formatUSD(r.balance)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-gray-900">Integrity checks</h2>
          <p className="text-xs text-gray-500">Every entry balances, reversals mirror their originals, no loan balance is negative, maker ≠ checker.</p>
          {checks && (checks.ok
            ? <p className="mt-4"><Badge variant="green">All ledger checks pass</Badge></p>
            : <ul className="mt-4 list-disc pl-5 text-sm text-red-700">{checks.problems.map((p) => <li key={p}>{p}</li>)}</ul>)}
        </Card>
      </div>

      <Card>
        <div className="px-5 pt-5">
          <h2 className="font-semibold text-gray-900">Journal</h2>
        </div>
        {entries.length === 0 ? (
          <p className="py-16 text-center text-gray-400 text-sm">No entries yet. Postings begin once the chart of accounts is approved and opening balances are loaded (migration step M4).</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {entries.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <p className="font-medium text-gray-900">
                  <span className="font-mono text-indigo-600">{e.entryNumber}</span> · {e.effectiveDate} · {e.description}
                </p>
                <ul className="mt-1 text-xs text-gray-600">
                  {e.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className={l.credit ? 'pl-6' : ''}>{l.account}{l.memberId ? ` · ${l.memberId}` : ''}{l.loanId ? ` · ${l.loanId}` : ''}</span>
                      <span className="tabular-nums">{l.debit ? `Dr ${formatUSD(l.debit)}` : `Cr ${formatUSD(l.credit)}`}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="px-5 pt-5">
          <h2 className="font-semibold text-gray-900">Chart of accounts</h2>
          <p className="text-xs text-gray-500">Proposed in the architecture (docs/architecture/04 §4); the accountant confirms it.</p>
        </div>
        <Table headers={['Code', 'Account', 'Type', 'Normal balance', 'Sub-ledger', 'Status']}>
          {accounts.map((a) => (
            <tr key={a.code} className="align-top">
              <td className="px-4 py-3 font-mono text-xs text-gray-600">{a.code}</td>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{a.name}</p>
                {a.description && <p className="text-xs text-gray-500 max-w-md">{a.description}</p>}
              </td>
              <td className="px-4 py-3 text-xs text-gray-600">{TYPE_LABEL[a.type] ?? a.type}</td>
              <td className="px-4 py-3 text-xs text-gray-600 capitalize">{a.normalBalance}</td>
              <td className="px-4 py-3 text-xs text-gray-600">{a.subledger ? `per ${a.subledger}` : '—'}</td>
              <td className="px-4 py-3"><Badge variant={a.status === 'approved' ? 'green' : a.status === 'proposed' ? 'amber' : 'gray'}>{a.status}</Badge></td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal open={showApprove} onClose={() => setShowApprove(false)} title="Record the accountant’s approval">
        <form onSubmit={approve} className="space-y-3">
          <p className="text-sm text-gray-600">
            This approves all {proposed.length} proposed accounts. An approved account’s type, normal balance and sub-ledger
            can never change afterwards, so only record this once the accountant has confirmed the chart in writing.
          </p>
          <Textarea label="Who confirmed it, and when" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Jane Doe CPA, letter dated 2026-10-15; member capital classified as a liability" required />
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            The club’s accountant has approved these accounts.
          </label>
          <Button type="submit" className="w-full" disabled={!confirmed || note.trim().length < 10}>Approve chart of accounts</Button>
        </form>
      </Modal>
    </div>
  )
}
