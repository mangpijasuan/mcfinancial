'use client'
import { useEffect, useId, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, ExternalLink, AlertTriangle, CheckCircle, AlertCircle, ChevronRight } from 'lucide-react'
import { Card, Table, EmptyState, LoanStatusBadge, Badge, Button, Modal, Input, Select,
         PageHeader, FilterBar, SearchInput } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'

export default function LoansPage() {
  const { can } = useStaff()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loans, setLoans]     = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch]   = useState('')
  const [status, setStatus]   = useState('')
  const [showNew, setShowNew] = useState(false)

  async function readJsonSafe(res: Response) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const p = new URLSearchParams({ search, status })
      const res = await fetch(`/api/loans?${p}`)
      const data = await readJsonSafe(res)
      if (!res.ok || !Array.isArray(data)) {
        setLoans([])
        setLoadError('Failed to load loans. Please refresh and try again.')
        return
      }
      setLoans(data)
    } catch {
      setLoans([])
      setLoadError('Failed to load loans. Please check server status and try again.')
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setShowNew(true)
    router.replace('/loans', { scroll: false })
  }, [router, searchParams])

  const totalOutstanding = loans.filter(l => l.status === 'Active').reduce((s, l) => s + l.balanceRemaining, 0)

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Loans"
        sub={`${loans.filter(l => l.status === 'Active').length} active · ${fmt$(totalOutstanding)} outstanding`}
        action={can('loans.create') ? <Button onClick={() => setShowNew(true)}><Plus size={15} /> New loan</Button> : undefined}
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search borrower or loan ID…" />
        <Select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Paid Off">Paid off</option>
          <option value="Cancelled">Cancelled</option>
        </Select>
      </FilterBar>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <Card>
        {/* Desktop / tablet table */}
        <div className="hidden md:block">
          <Table loading={loading} headers={['Loan ID','Borrower','Co-signer','Amount','Monthly due','Paid','Balance','Date','Term','Next due','Status','Agreement','']}>
            {loans.length === 0 && !loading
              ? <EmptyState message="No loans found." />
              : loans.map(l => (
                <tr key={l.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => router.push(`/loans/${l.loanId}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-indigo-600">{l.loanId}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{l.borrowerName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{l.cosignerName || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{fmt$(l.loanAmount)}</td>
                  <td className="px-4 py-3 text-gray-700">{fmt$(l.monthlyDue)}</td>
                  <td className="px-4 py-3 text-green-700 font-medium">{fmt$(l.totalPaid)}</td>
                  <td className="px-4 py-3 font-bold text-gray-900">{fmt$(l.balanceRemaining)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(l.loanDate)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{l.termMonths} mo.</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(l.nextDueDate)}</td>
                  <td className="px-4 py-3"><LoanStatusBadge status={l.status} overdue={l.overdue} /></td>
                  <td className="px-4 py-3">
                    {l.agreement
                      ? <Badge variant={l.agreement.status === 'fully_signed' ? 'green' : 'amber'}>
                          {l.agreement.status === 'fully_signed' ? '✓ Signed' : 'Pending'}
                        </Badge>
                      : <Badge variant="gray">—</Badge>
                    }
                  </td>
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
          ) : loans.length === 0 ? (
            <p className="py-16 text-center text-gray-400 text-sm">No loans found.</p>
          ) : loans.map(l => (
            <Link key={l.id} href={`/loans/${l.loanId}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-gray-50">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs text-indigo-600">{l.loanId}</p>
                  <LoanStatusBadge status={l.status} overdue={l.overdue} />
                </div>
                <p className="font-medium text-gray-900 truncate mt-0.5">{l.borrowerName}</p>
                {l.cosignerName && <p className="text-xs text-gray-400 truncate">Co-signer: {l.cosignerName}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900">{fmt$(l.balanceRemaining)}</p>
                  <p className="text-xs text-gray-400">of {fmt$(l.loanAmount)}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            </Link>
          ))}
        </div>
      </Card>

      <NewLoanModal open={showNew} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />
    </div>
  )
}

/** Members whose name or ID matches (two characters at least). */
async function findMembers(q: string): Promise<any[]> {
  if (q.length < 2) return []
  try {
    const res = await fetch(`/api/members?search=${encodeURIComponent(q)}&limit=10`)
    const d = await res.json().catch(() => null)
    return Array.isArray(d?.members) ? d.members : []
  } catch {
    return []
  }
}

function NewLoanModal({ open, onClose, onSaved }: any) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({ borrowerId: '', cosignerId: '', loanDate: today, termMonths: '12', loanAmount: '', borrowerAddress: '', borrowerCity: '', borrowerState: '', notes: '' })
  const [bSearch, setBSearch] = useState(''); const [bList, setBList] = useState<any[]>([]); const [bSelected, setBSelected] = useState<any>(null)
  const [cSearch, setCSearch] = useState(''); const [cList, setCList] = useState<any[]>([]); const [cSelected, setCSelected] = useState<any>(null)
  const [policy, setPolicy]   = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [violations, setViolations] = useState<string[]>([])
  // Gate #1 A10: how much is left to lend (null when the user cannot see the treasury).
  const [capacity, setCapacity] = useState<{ cents: number | null } | null>(null)
  useEffect(() => {
    if (!open) return
    fetch('/api/treasury', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((t) => setCapacity(t ? { cents: t.capacityCents } : null))
      .catch(() => setCapacity(null))
  }, [open])
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function readJsonSafe(res: Response) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  // A result that arrives after a newer search started is dropped, so a slow
  // answer for "Ad" cannot replace the one for "Ada".
  useEffect(() => {
    let current = true
    findMembers(bSearch).then((list) => { if (current) setBList(list) })
    return () => { current = false }
  }, [bSearch])
  useEffect(() => {
    let current = true
    findMembers(cSearch).then((list) => { if (current) setCList(list) })
    return () => { current = false }
  }, [cSearch])

  // Live policy check whenever borrower or amount or term changes
  useEffect(() => {
    if (!form.borrowerId || !form.loanAmount) { setPolicy(null); return }
    const t = setTimeout(async () => {
      setChecking(true)
      try {
        const res = await fetch('/api/loans/check-policy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId: form.borrowerId, amount: form.loanAmount, termMonths: form.termMonths }),
        })
        const data = await readJsonSafe(res)
        setPolicy(data)
      } catch {
        setPolicy(null)
      } finally {
        setChecking(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [form.borrowerId, form.loanAmount, form.termMonths])

  const monthlyDue = form.loanAmount && form.termMonths
    ? Math.round(parseFloat(form.loanAmount) / parseInt(form.termMonths) * 100) / 100 : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.borrowerId) { setError('Please select a borrower.'); return }
    if (!form.cosignerId) { setError('Please select an eligible co-signer.'); return }
    setSaving(true); setError(''); setViolations([])
    const res = await fetch('/api/loans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const d = await readJsonSafe(res)
    if (res.ok) {
      if (res.status === 202 && d?.approvalRequest) window.alert(`Sent for approval (${d.approvalRequest.publicId}). Someone else must approve it under Approvals before it takes effect.`)
      onSaved()
    } else {
      setError(d?.error || 'Failed to create loan.')
      if (Array.isArray(d?.violations)) setViolations(d.violations)
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New loan" width="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <MemberSearch label="Borrower *" query={bSearch} setQuery={setBSearch} list={bList} setList={setBList} selected={bSelected} setSelected={setBSelected} onPick={(id: string) => setForm(f => ({ ...f, borrowerId: id }))} />
          <MemberSearch label="Co-signer *" query={cSearch} setQuery={setCSearch} list={cList} setList={setCList} selected={cSelected} setSelected={setCSelected} onPick={(id: string) => setForm(f => ({ ...f, cosignerId: id }))} />
          <Input label="Loan date *" type="date" value={form.loanDate} onChange={set('loanDate')} required />
          <Select label="Term *" value={form.termMonths} onChange={set('termMonths')} required>
            {(Number(form.loanAmount) > 2500 ? [12, 24] : [12]).map(t => <option key={t} value={t}>{t} months</option>)}
          </Select>
          <Input label="Loan amount ($) *" type="number" min="1" max="5000" step="0.01" value={form.loanAmount} onChange={set('loanAmount')} required />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Monthly payment</label>
            <div className="px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm font-semibold text-indigo-700">
              {monthlyDue > 0 ? fmt$(monthlyDue) : '—'}
            </div>
          </div>
        </div>

        {/* Policy check panel */}
        {(checking || policy) && form.borrowerId && form.loanAmount && (
          <div className={`rounded-xl border p-4 space-y-2 ${
            checking ? 'bg-gray-50 border-gray-200' :
            policy?.eligible ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
              {checking ? '⏳ Checking policy…' : policy?.eligible
                ? <><CheckCircle size={13} className="text-green-600"/> Policy check passed</>
                : <><AlertTriangle size={13} className="text-red-600"/> Policy violations</>
              }
            </p>
            {!checking && policy && (
              <>
                {policy.errors?.map((e: string) => (
                  <p key={e} className="text-xs text-red-700 flex items-start gap-1.5">
                    <AlertCircle size={12} className="shrink-0 mt-0.5"/> {e}
                  </p>
                ))}
                {policy.warnings?.map((w: string) => (
                  <p key={w} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5"/> {w}
                  </p>
                ))}
                {policy.eligible && (
                  <div className="flex gap-4 pt-1 text-xs text-green-700">
                    <span>Max allowed: <strong>{fmt$(policy.maxLoanAmount)}</strong></span>
                    <span>Application fee: <strong>{fmt$(policy.applicationFee)}</strong></span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Application fee notice */}
        {policy?.eligible && policy.applicationFee > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            💰 Application fee of <strong>{fmt$(policy.applicationFee)}</strong> applies per loan policy. It is deducted from the payout (Gate #1 A8): the borrower receives the loan amount less the fee and repays the full loan amount.
          </div>
        )}

        {/* Lending capacity (Gate #1 A10) */}
        {capacity && (() => {
          const payout = policy?.eligible && form.loanAmount ? Math.round(parseFloat(form.loanAmount) * 100) - Math.round((policy.applicationFee ?? 0) * 100) : null
          const over = capacity.cents === null || (payout !== null && payout > capacity.cents)
          return (
            <div className={`rounded-lg border px-4 py-3 text-sm ${over ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
              {capacity.cents === null
                ? <>Lending capacity is unknown: the Treasurer must record the bank balance on the <a className="underline" href="/treasury">Treasury</a> page before any loan can be approved.</>
                : <>Lending capacity: <strong>{fmt$(capacity.cents / 100)}</strong>
                  {payout !== null && <> · this loan pays out <strong>{fmt$(payout / 100)}</strong>{over ? ', more than the club can lend now. It will be refused.' : '.'}</>}</>}
            </div>
          )
        })()}

        {/* Borrower address (for agreement) */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Borrower address (for loan agreement)</p>
          <div className="grid grid-cols-3 gap-3">
            <Input className="col-span-3" label="Street address" value={form.borrowerAddress} onChange={set('borrowerAddress')} placeholder="Optional — member can fill in when signing" />
            <Input label="City" value={form.borrowerCity} onChange={set('borrowerCity')} />
            <Input label="State" value={form.borrowerState} onChange={set('borrowerState')} />
          </div>
        </div>

        <Input label="Notes" value={form.notes} onChange={set('notes')} />

        {violations.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1">
            {violations.map(v => <p key={v} className="text-sm text-red-700">• {v}</p>)}
          </div>
        )}
        {error && !violations.length && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || (policy && !policy.eligible)}>
            {saving ? 'Creating…' : 'Create loan + generate agreement'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// Defined outside NewLoanModal: a component declared inside another's render is
// a new type on every render, so React would remount the input and drop focus
// after each keystroke.
function MemberSearch({ label, query, setQuery, list, setList, selected, setSelected, onPick }: any) {
  const inputId = useId()
  return (
    <div className="relative col-span-2">
      <label htmlFor={inputId} className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">{label}</label>
      <input id={inputId} value={query} onChange={e => { setQuery(e.target.value); setSelected(null); onPick('') }}
        placeholder="Type to search members…" autoComplete="off"
        className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500" />
      {list.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {list.map((m: any) => (
            <button key={m.id} type="button" onClick={() => { setSelected(m); setQuery(m.legalName); setList([]); onPick(m.id) }}
              className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm border-b border-gray-100 last:border-0">
              <span className="font-medium">{m.legalName}</span>
              <span className="text-gray-400 text-xs ml-2">{m.id} · {m.status} · {m.monthsActive} mo</span>
            </button>
          ))}
        </div>
      )}
      {selected && <p className="text-xs text-green-600 mt-1">✓ {selected.legalName} ({selected.id})</p>}
    </div>
  )
}
