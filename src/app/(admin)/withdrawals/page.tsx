'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { Card, Table, EmptyState, Badge, Button, Modal, Input, Select,
         PageHeader, FilterBar, SearchInput } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export default function WithdrawalsPage() {
  const { can } = useStaff()
  const [rows, setRows]         = useState<any[]>([])
  const [total, setTotal]       = useState(0)
  const [totalAmt, setTotalAmt] = useState(0)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch]     = useState('')
  const [type, setType]         = useState('')
  const [page, setPage]         = useState(1)
  const [showAdd, setShowAdd]   = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError('')
      const p = new URLSearchParams({ search, type, page: String(page), limit: '50' })
      const res = await fetch(`/api/withdrawals?${p}`)
      const data = await readJsonSafe<any>(res)
      if (!res.ok || !data) throw new Error('Failed to load withdrawals.')
      setRows(data.withdrawals ?? [])
      setTotal(data.total ?? 0)
      setTotalAmt(data.totalAmount ?? 0)
    } catch (err: any) {
      setRows([])
      setTotal(0)
      setTotalAmt(0)
      setLoadError(err?.message || 'Failed to load withdrawals.')
    } finally {
      setLoading(false)
    }
  }, [search, type, page])

  useEffect(() => { setPage(1) }, [search, type])
  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Withdrawals"
        sub={`${total} records · ${fmt$(totalAmt)} total withdrawn`}
        action={can('withdrawals.record') ? <Button onClick={() => setShowAdd(true)}><Plus size={15} /> Record withdrawal</Button> : undefined}
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search member…" />
        <Select aria-label="Withdrawal type" value={type} onChange={e => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="Partial">Partial</option>
          <option value="Full Exit">Full exit</option>
        </Select>
      </FilterBar>

      {loadError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{loadError}</p>
      )}

      <Card>
        <Table loading={loading} headers={['ID', 'Member ID', 'Member', 'Date', 'Amount', 'Type', 'Reason', 'Processed by']}>
          {rows.length === 0 && !loading
            ? <EmptyState message="No withdrawals recorded yet." />
            : rows.map(w => (
              <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{w.withdrawalId}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{w.memberId}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{w.memberName}</td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(w.withdrawalDate)}</td>
                <td className="px-4 py-3 font-bold text-gray-900">{fmt$(w.amount)}</td>
                <td className="px-4 py-3">
                  <Badge variant={w.type === 'Full Exit' ? 'red' : 'amber'}>
                    {w.type}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{w.reason || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{w.processedBy || '—'}</td>
              </tr>
            ))
          }
        </Table>
        {total > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>Showing {Math.min((page-1)*50+1,total)}–{Math.min(page*50,total)} of {total}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page===1} onClick={() => setPage(p=>p-1)}>← Prev</Button>
              <Button variant="secondary" size="sm" disabled={page*50>=total} onClick={() => setPage(p=>p+1)}>Next →</Button>
            </div>
          </div>
        )}
      </Card>

      <RecordWithdrawalModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />
    </div>
  )
}

function RecordWithdrawalModal({ open, onClose, onSaved }: any) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm]         = useState({ memberId: '', withdrawalDate: today, amount: '', type: 'Partial', reason: '', processedBy: '', notes: '' })
  const [memberSearch, setMemberSearch] = useState('')
  const [members, setMembers]   = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    if (memberSearch.length < 2) { setMembers([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members?search=${memberSearch}&limit=10`)
        const d = await readJsonSafe<any>(res)
        if (!res.ok || !d) {
          setMembers([])
          return
        }
        setMembers(d.members ?? [])
      } catch {
        setMembers([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [memberSearch])

  function pick(m: any) {
    setSelected(m); setForm(f => ({ ...f, memberId: m.id }))
    setMemberSearch(m.legalName); setMembers([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.memberId) { setError('Please select a member.'); return }
    try {
      setSaving(true)
      setError('')
      const res = await fetch('/api/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await readJsonSafe<any>(res)
      if (res.ok) {
        if (res.status === 202 && d?.approvalRequest) window.alert(`Sent for approval (${d.approvalRequest.publicId}). Someone else must approve it under Approvals before it takes effect.`)
        onSaved()
        return
      }
      setError(d?.error || 'Failed to save.')
    } catch {
      setError('Request failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record withdrawal">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Member search */}
        <div className="relative">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Member *</label>
          <input value={memberSearch} onChange={e => { setMemberSearch(e.target.value); setSelected(null); setForm(f => ({ ...f, memberId: '' })) }}
            placeholder="Type to search…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500" />
          {members.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {members.map(m => (
                <button key={m.id} type="button" onClick={() => pick(m)}
                  className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 text-sm border-b border-gray-100 last:border-0">
                  <span className="font-medium">{m.legalName}</span>
                  <span className="text-gray-400 text-xs ml-2">{m.id} · {m.status}</span>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="mt-1.5 text-xs bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-green-600 font-semibold">✓ {selected.legalName}</span>
              <span className="text-gray-400 ml-2">Overall contributions: {fmt$(selected.overallContributions)}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Withdrawal date *" type="date" value={form.withdrawalDate} onChange={set('withdrawalDate')} required />
          <Input label="Amount ($) *" type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} required />
          <Select label="Type *" value={form.type} onChange={set('type')}>
            <option value="Partial">Partial withdrawal</option>
            <option value="Full Exit">Full exit (leave club)</option>
          </Select>
          <Input label="Processed by" value={form.processedBy} onChange={set('processedBy')} placeholder="Admin name" />
          <div className="col-span-2"><Input label="Reason" value={form.reason} onChange={set('reason')} placeholder="e.g. Emergency, relocation…" /></div>
          <div className="col-span-2"><Input label="Notes" value={form.notes} onChange={set('notes')} /></div>
        </div>

        {form.type === 'Full Exit' && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            ⚠ Full Exit will mark this member as <strong>Inactive</strong> automatically.
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} variant={form.type === 'Full Exit' ? 'danger' : 'primary'}>
            {saving ? 'Saving…' : form.type === 'Full Exit' ? 'Record & mark inactive' : 'Record withdrawal'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
