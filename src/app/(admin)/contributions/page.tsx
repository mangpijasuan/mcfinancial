'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { Card, Table, EmptyState, Button, Modal, Input, Select, PageHeader,
         FilterBar, SearchInput, Badge, Textarea } from '@/components/ui'
import { fmt$, fmtDate, monthYearOptions } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'

const MONTHS = monthYearOptions()
const METHODS = ['Cash', 'Online', 'Zelle', 'Venmo', 'Check', 'Auto-pay', 'Other']

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function currentMonthYear() {
  const d = new Date()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]}-${d.getFullYear()}`
}

export default function ContributionsPage() {
  const { can } = useStaff()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [rows, setRows]       = useState<any[]>([])
  const [total, setTotal]     = useState(0)
  const [totalAmt, setTotalAmt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch]   = useState('')
  const [month, setMonth]     = useState('')
  const [method, setMethod]   = useState('')
  const [page, setPage]       = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [notice, setNotice]   = useState('')
  const [reversing, setReversing] = useState<any>(null)

  const [reportMonth, setReportMonth] = useState(currentMonthYear())
  const [reportMembers, setReportMembers] = useState<any[]>([])
  const [reportContribs, setReportContribs] = useState<any[]>([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError('')
      const p = new URLSearchParams({ search, month, method, page: String(page), limit: '50' })
      const res = await fetch(`/api/contributions?${p}`)
      const data = await readJsonSafe<any>(res)
      if (!res.ok || !data) throw new Error('Failed to load contributions.')
      setRows(data.contributions ?? [])
      setTotal(data.total ?? 0)
      setTotalAmt(data.totalAmount ?? 0)
    } catch (err: any) {
      setRows([])
      setTotal(0)
      setTotalAmt(0)
      setLoadError(err?.message || 'Failed to load contributions.')
    } finally {
      setLoading(false)
    }
  }, [search, month, method, page])

  useEffect(() => { setPage(1) }, [search, month, method])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setShowAdd(true)
    router.replace('/contributions', { scroll: false })
  }, [router, searchParams])

  useEffect(() => {
    if (month) setReportMonth(month)
  }, [month])

  const loadMonthlyReport = useCallback(async () => {
    if (!reportMonth) return
    try {
      setReportLoading(true)
      setReportError('')

      const [membersRes, contribRes] = await Promise.all([
        fetch('/api/members?status=Active&limit=1000'),
        fetch(`/api/contributions?month=${encodeURIComponent(reportMonth)}&limit=2000&page=1`),
      ])

      const membersData = await readJsonSafe<any>(membersRes)
      const contribData = await readJsonSafe<any>(contribRes)

      if (!membersRes.ok || !contribRes.ok || !membersData || !contribData) {
        throw new Error('Failed to load monthly report data.')
      }

      setReportMembers(Array.isArray(membersData.members) ? membersData.members : [])
      setReportContribs(Array.isArray(contribData.contributions) ? contribData.contributions : [])
    } catch (err: any) {
      setReportError(err?.message || 'Failed to load monthly report data.')
      setReportMembers([])
      setReportContribs([])
    } finally {
      setReportLoading(false)
    }
  }, [reportMonth])

  useEffect(() => { loadMonthlyReport() }, [loadMonthlyReport])

  const contribByMember = new Map<string, any>()
  for (const c of reportContribs) {
    if (!c.reversedAt && !contribByMember.has(c.memberId)) contribByMember.set(c.memberId, c)
  }

  const reportRows = [...reportMembers]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((m) => {
      const c = contribByMember.get(m.id)
      return {
        memberId: m.id,
        legalName: m.legalName,
        nickname: m.nickname,
        joinDate: m.joinDate,
        month: reportMonth,
        amount: c?.amount ?? null,
        comments: c?.comments ?? null,
        paid: !!c,
      }
    })

  const reportPaidCount = reportRows.filter(r => r.paid).length
  const reportTotalAmount = reportRows.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return (
    <div className="p-4 sm:p-8">
      <div className="print:hidden">
        <PageHeader
          title="Contributions"
          sub={`${total} records · ${fmt$(totalAmt)} total`}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => window.print()}>Print monthly report</Button>
              {can('contributions.record') && <Button onClick={() => setShowAdd(true)}><Plus size={15} /> Record payment</Button>}
            </div>
          }
        />

        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search member or ID…" />
          <Select value={month} onChange={e => setMonth(e.target.value)}>
            <option value="">All months</option>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Select value={method} onChange={e => setMethod(e.target.value)}>
            <option value="">All methods</option>
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
        </FilterBar>

        {loadError && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{loadError}</p>
        )}
        {notice && <p className="mb-4 text-sm text-emerald-800 bg-emerald-50 px-3 py-2 rounded-lg">{notice}</p>}

        <Card>
          <Table loading={loading} headers={['Receipt','Member','Paid on','Amount','Covers','Method','Received by','Comments','']}>
            {rows.length === 0 && !loading
              ? <EmptyState message="No contributions found." />
              : rows.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${c.reversedAt ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    {c.receiptNumber
                      ? <Link className="text-indigo-600 underline" href={`/contributions/${c.transactionId}/receipt`}>{c.receiptNumber}</Link>
                      : <span className="text-gray-400" title="Recorded before receipts were issued">{c.transactionId}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.memberName}</p>
                    <p className="font-mono text-xs text-gray-500">{c.memberId}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(c.paymentDate)}</td>
                  <td className={`px-4 py-3 font-semibold ${c.reversedAt ? 'text-gray-500 line-through' : 'text-green-700'}`}>{fmt$(c.amount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {c.reversedAt
                      ? <Badge variant="red">Reversed</Badge>
                      : c.category === 'voluntary' ? <Badge variant="purple">Voluntary</Badge> : (c.receiptCovers || '—')}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.paymentMethod || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.receivedBy || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{c.reversedAt ? `Reversed: ${c.reversalReason}` : (c.comments || '—')}</td>
                  <td className="px-4 py-3 text-right">
                    {!c.reversedAt && can('contributions.reverse') && (
                      <Button size="sm" variant="ghost" onClick={() => setReversing(c)}>Reverse</Button>
                    )}
                  </td>
                </tr>
              ))
            }
          </Table>
          {total > 50 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
              <span>Showing {Math.min((page - 1) * 50 + 1, total)}–{Math.min(page * 50, total)} of {total}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
                <Button variant="secondary" size="sm" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next →</Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6 print:mt-0 print:border-none print:shadow-none">
        <div className="px-5 py-4 border-b border-gray-200 print:px-0">
          <div className="flex items-center justify-between gap-3 print:block">
            <div>
              <h2 className="text-base font-bold text-gray-900">Monthly Contributions Report</h2>
              <p className="text-xs text-gray-500 mt-0.5">Full member list for {reportMonth}</p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Select value={reportMonth} onChange={e => setReportMonth(e.target.value)}>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Button variant="secondary" onClick={() => window.print()}>Print</Button>
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {reportRows.length} members · {reportPaidCount} paid · {reportRows.length - reportPaidCount} not paid · {fmt$(reportTotalAmount)} collected
          </p>
          {reportError && <p className="text-xs text-red-600 mt-1">{reportError}</p>}
        </div>

        <Table loading={reportLoading} headers={['Member ID','Name','Nickname','Joined','Month','Amount','Comment']}>
          {reportRows.length === 0 && !reportLoading
            ? <EmptyState message="No members found for report." />
            : reportRows.map((r) => (
              <tr key={r.memberId} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{r.memberId}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{r.legalName}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{r.nickname || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(r.joinDate)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{r.month}</td>
                <td className="px-4 py-3 font-semibold text-green-700">{r.amount != null ? fmt$(r.amount) : '—'}</td>
                <td className="px-4 py-3 text-xs">
                  {r.paid ? (r.comments || '—') : 'Not paid'}
                </td>
              </tr>
            ))
          }
        </Table>
      </Card>

      <RecordContributionModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={(created: any) => {
        setShowAdd(false)
        setNotice(`Receipt ${created.receiptNumber} issued: ${created.receiptCovers}.`)
        load()
      }} />
      <ReverseModal contribution={reversing} onClose={() => setReversing(null)} onDone={(message: string) => { setReversing(null); setNotice(message); load() }} />
    </div>
  )
}

function ReverseModal({ contribution: c, onClose, onDone }: any) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { setReason(''); setError('') }, [c])
  if (!c) return null
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/contributions/${c.transactionId}/reverse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    })
    const data = await readJsonSafe<any>(res)
    if (!res.ok) { setError(data?.error || 'Could not reverse.'); return }
    onDone(res.status === 202
      ? `Reversal sent for approval (${data.approvalRequest.publicId}). A second person approves it on the Approvals page.`
      : 'Contribution reversed.')
  }
  return (
    <Modal open onClose={onClose} title={`Reverse ${c.receiptNumber ?? c.transactionId}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-600">
          {fmt$(c.amount)} from {c.memberName}, paid {fmtDate(c.paymentDate)}. The record stays, marked reversed; it stops counting
          towards dues and totals. A second person (Treasurer) must approve.
        </p>
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. recorded for the wrong member" />
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger">Send for approval</Button>
        </div>
      </form>
    </Modal>
  )
}

function RecordContributionModal({ open, onClose, onSaved }: any) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({ memberId: '', paymentDate: today, amount: '20', paymentMethod: 'Cash', receivedBy: '', comments: '', category: 'dues' })
  const [memberSearch, setMemberSearch] = useState('')
  const [members, setMembers]   = useState<any[]>([])
  const [selectedMember, setSelectedMember] = useState<any>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))

  function setAutoPayDate(dateValue: string) {
    const date = new Date(dateValue)
    if (Number.isNaN(date.getTime())) return dateValue
    date.setDate(15)
    return date.toISOString().split('T')[0]
  }

  const derivedMonthYear = (() => {
    const d = new Date(form.paymentDate)
    if (Number.isNaN(d.getTime())) return '—'
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[d.getMonth()]}-${d.getFullYear()}`
  })()

  useEffect(() => {
    if (memberSearch.length < 2) { setMembers([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members?search=${memberSearch}&status=Active&limit=10`)
        const data = await readJsonSafe<any>(res)
        if (!res.ok || !data) {
          setMembers([])
          return
        }
        setMembers(data.members ?? [])
      } catch {
        setMembers([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [memberSearch])

  function selectMember(m: any) {
    setSelectedMember(m)
    setForm(f => ({ ...f, memberId: m.id }))
    setMemberSearch(m.legalName)
    setMembers([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.memberId) { setError('Please select a member.'); return }
    try {
      setSaving(true)
      setError('')
      const res = await fetch('/api/contributions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (res.ok) {
        onSaved(await readJsonSafe<any>(res))
        return
      }
      const d = await readJsonSafe<any>(res)
      setError(d?.error || 'Failed to save. Check fields and try again.')
    } catch {
      setError('Request failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record contribution">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Member search */}
        <div className="relative">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Member *</label>
          <input value={memberSearch} onChange={e => { setMemberSearch(e.target.value); setSelectedMember(null); setForm(f => ({ ...f, memberId: '' })) }}
            placeholder="Type name or ID to search…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500" />
          {members.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {members.map(m => (
                <button key={m.id} type="button" onClick={() => selectMember(m)}
                  className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 text-sm border-b border-gray-100 last:border-0">
                  <span className="font-medium">{m.legalName}</span>
                  <span className="text-gray-400 text-xs ml-2">{m.id} {m.nickname && `· ${m.nickname}`}</span>
                </button>
              ))}
            </div>
          )}
          {selectedMember && (
            <p className="text-xs text-green-600 mt-1">✓ {selectedMember.legalName} ({selectedMember.id})</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Payment date *" type="date" value={form.paymentDate} onChange={set('paymentDate')} required />
          <Select label="Applies to" value={form.category} onChange={set('category')}>
            <option value="dues">Monthly dues</option>
            <option value="voluntary">Voluntary (not dues)</option>
          </Select>
          <Input label="Amount ($) *" type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} required />
          <Select label="Payment method" value={form.paymentMethod} onChange={e => {
            const nextMethod = e.target.value
            setForm(f => ({
              ...f,
              paymentMethod: nextMethod,
              paymentDate: nextMethod === 'Auto-pay' ? setAutoPayDate(f.paymentDate) : f.paymentDate,
            }))
          }}>
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Input label="Received by" value={form.receivedBy} onChange={set('receivedBy')} placeholder="Collector name" />
          <Input label="Comments" value={form.comments} onChange={set('comments')} />
        </div>

        <p className="text-xs text-gray-500">
          {form.category === 'dues'
            ? 'Dues pay the oldest unpaid month first; anything extra is held as credit for the next months. The receipt shows which months it covered.'
            : 'A voluntary contribution adds to the member’s capital but does not count towards monthly dues.'}
          {' '}Paid in {derivedMonthYear}.
        </p>
        {form.paymentMethod === 'Auto-pay' && (
          <p className="text-xs text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg">
            Auto-pay contributions are recorded on the 15th of the selected month.
          </p>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </form>
    </Modal>
  )
}
