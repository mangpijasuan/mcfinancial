'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, ExternalLink, ChevronRight } from 'lucide-react'
import { Card, Table, EmptyState, StatusBadge, EligibleBadge, RiskBadge, PaidBadge,
         Button, Modal, Input, Select, PageHeader, FilterBar, SearchInput } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'

export default function MembersPage() {
  const { can } = useStaff()
  const router = useRouter()
  const searchParams = useSearchParams()
  const PAGE_SIZE = 10
  const [members, setMembers]   = useState<any[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState(searchParams.get('q') || '')
  const [status, setStatus]     = useState('')
  const [risk, setRisk]         = useState('')
  const [paid, setPaid]         = useState('')
  const [page, setPage]         = useState(1)
  const [showAdd, setShowAdd]   = useState(false)
  const [error, setError]       = useState('')

  async function readJsonSafe(res: Response) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const p = new URLSearchParams({ search, status, risk, paid, page: String(page), limit: String(PAGE_SIZE) })
      const res = await fetch(`/api/members?${p}`)
      const data = await readJsonSafe(res)
      if (!res.ok || !data) throw new Error('Failed to load members.')
      setMembers(Array.isArray(data.members) ? data.members : [])
      setTotal(data.total ?? 0)
    } catch (err: any) {
      setMembers([])
      setTotal(0)
      setError(err?.message || 'Failed to load members.')
    } finally {
      setLoading(false)
    }
  }, [search, status, risk, paid, page])

  useEffect(() => {
    const query = searchParams.get('q') || ''
    setSearch((current) => (current === query ? current : query))
  }, [searchParams])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setShowAdd(true)
    router.replace('/members', { scroll: false })
  }, [router, searchParams])

  useEffect(() => { setPage(1) }, [search, status, risk, paid])
  useEffect(() => { fetchMembers() }, [fetchMembers])

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Members"
        sub={`${total} total`}
        action={can('members.create') ? <Button onClick={() => setShowAdd(true)}><Plus size={15} /> Add member</Button> : undefined}
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or ID…" />
        <Select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </Select>
        <Select value={risk} onChange={e => setRisk(e.target.value)}>
          <option value="">All risk levels</option>
          <option value="LOW">Low risk</option>
          <option value="HIGH">High risk</option>
        </Select>
        <Select value={paid} onChange={e => setPaid(e.target.value)}>
          <option value="">All payment status</option>
          <option value="PAID">Paid this month</option>
          <option value="NOT PAID">Not paid</option>
        </Select>
      </FilterBar>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        {/* Desktop / tablet table */}
        <div className="hidden md:block">
          <Table loading={loading} headers={['Member ID','Name','Nickname','Joined','Status','Contributions','Loan balance','Eligible','This month','Risk','']}>
            {members.length === 0 && !loading
              ? <EmptyState message="No members found." />
              : members.map(m => (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => router.push(`/members/${m.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-indigo-600">{m.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{m.legalName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{m.nickname || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(m.joinDate)}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-3 text-gray-700 font-medium">{fmt$(m.overallContributions)}</td>
                  <td className="px-4 py-3 text-gray-700">{m.currentLoanBalance > 0 ? fmt$(m.currentLoanBalance) : '—'}</td>
                  <td className="px-4 py-3"><EligibleBadge eligible={m.eligible} /></td>
                  <td className="px-4 py-3"><PaidBadge paid={m.thisMonth} /></td>
                  <td className="px-4 py-3"><RiskBadge risk={m.riskFlag} /></td>
                  <td className="px-4 py-3 text-gray-400"><ExternalLink size={14} /></td>
                </tr>
              ))
            }
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-gray-100">
          {loading ? (
            <p className="py-16 text-center text-gray-400 text-sm">Loading…</p>
          ) : members.length === 0 ? (
            <p className="py-16 text-center text-gray-400 text-sm">No members found.</p>
          ) : members.map(m => (
            <Link key={m.id} href={`/members/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-gray-50">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{m.legalName}</p>
                <p className="text-xs text-gray-400 font-mono">{m.id}{m.nickname ? ` · "${m.nickname}"` : ''}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <StatusBadge status={m.status} />
                  <EligibleBadge eligible={m.eligible} />
                  <PaidBadge paid={m.thisMonth} />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{fmt$(m.overallContributions)}</p>
                  <p className="text-xs text-gray-400">{m.currentLoanBalance > 0 ? `${fmt$(m.currentLoanBalance)} owed` : 'no loan'}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            </Link>
          ))}
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
              <Button variant="secondary" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          </div>
        )}
      </Card>

      <AddMemberModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); fetchMembers() }} />
    </div>
  )
}

function AddMemberModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ legalName: '', nickname: '', joinDate: new Date().toISOString().split('T')[0], status: 'Active', phoneNo: '', email: '', beneficiary: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    const res = await fetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) { onSaved() } else {
      const data = await readJsonSafe(res)
      setError(data?.error || 'Failed to save member.')
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add new member">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Legal name *" value={form.legalName} onChange={set('legalName')} required /></div>
          <Input label="Nickname" value={form.nickname} onChange={set('nickname')} />
          <Input label="Join date *" type="date" value={form.joinDate} onChange={set('joinDate')} required />
          <Select label="Status" value={form.status} onChange={set('status')}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
          <Input label="Phone" value={form.phoneNo} onChange={set('phoneNo')} />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} />
          <Input label="Beneficiary" value={form.beneficiary} onChange={set('beneficiary')} />
          <div className="col-span-2"><Input label="Notes" value={form.notes} onChange={set('notes')} /></div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add member'}</Button>
        </div>
      </form>
    </Modal>
  )
}

async function readJsonSafe(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}
