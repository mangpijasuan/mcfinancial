'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { Card, Table, EmptyState, Button, Modal, Input, Select, PageHeader,
         FilterBar, SearchInput } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'

const METHODS = ['Cash', 'Online', 'Zelle', 'Venmo', 'Check', 'Other']

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export default function LoanPaymentsPage() {
  const { can } = useStaff()
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: Math.max(1, currentYear - 2021 + 1) }, (_, i) => String(currentYear - i))

  const [rows, setRows]       = useState<any[]>([])
  const [total, setTotal]     = useState(0)
  const [totalAmt, setTotalAmt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch]   = useState('')
  const [year, setYear]       = useState('')
  const [page, setPage]       = useState(1)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError('')
      const p = new URLSearchParams({ search, year, page: String(page), limit: '50' })
      const res = await fetch(`/api/loan-payments?${p}`)
      const data = await readJsonSafe<any>(res)
      if (!res.ok || !data) throw new Error('Failed to load loan payments.')
      setRows(data.payments ?? [])
      setTotal(data.total ?? 0)
      setTotalAmt(data.totalAmount ?? 0)
    } catch (err: any) {
      setRows([])
      setTotal(0)
      setTotalAmt(0)
      setLoadError(err?.message || 'Failed to load loan payments.')
    } finally {
      setLoading(false)
    }
  }, [search, year, page])

  useEffect(() => { setPage(1) }, [search, year])
  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Loan Payments"
        sub={`${total} records · ${fmt$(totalAmt)} collected`}
        action={can('loan_payments.record') ? <Button onClick={() => setShowAdd(true)}><Plus size={15} /> Record repayment</Button> : undefined}
      />

      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search borrower or loan ID…" />
        <Select aria-label="Year" value={year} onChange={e => setYear(e.target.value)}>
          <option value="">All years</option>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
      </FilterBar>

      {loadError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{loadError}</p>
      )}

      <Card>
        <Table loading={loading} headers={['Payment ID','Loan ID','Borrower','Year','Date','Amount','Method','Received by','Comments']}>
          {rows.length === 0 && !loading
            ? <EmptyState message="No loan payments found." />
            : rows.map(p => (
              <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{p.paymentId}</td>
                <td className="px-4 py-3 font-mono text-xs text-purple-600">{p.loanId}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{p.borrowerName}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(p.paymentDate).getFullYear()}</td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(p.paymentDate)}</td>
                <td className="px-4 py-3 font-semibold text-green-700">{fmt$(p.amount)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{p.paymentMethod || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{p.receivedBy || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{p.comments || '—'}</td>
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

      <RecordRepaymentModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />
    </div>
  )
}

function RecordRepaymentModal({ open, onClose, onSaved }: any) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm]   = useState({ loanId: '', paymentDate: today, amount: '', paymentMethod: 'Cash', receivedBy: '', comments: '' })
  const [loans, setLoans] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const res = await fetch('/api/loans?status=Active')
        const data = await readJsonSafe<any>(res)
        if (!res.ok) {
          setLoans([])
          return
        }
        setLoans(Array.isArray(data) ? data : [])
      } catch {
        setLoans([])
      }
    })()
  }, [open])

  function selectLoan(loanId: string) {
    const loan = loans.find(l => l.loanId === loanId)
    setSelected(loan)
    setForm(f => ({ ...f, loanId, amount: loan ? String(Math.round(loan.monthlyDue * 100) / 100) : '' }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.loanId) { setError('Please select a loan.'); return }
    try {
      setSaving(true)
      setError('')
      const res = await fetch('/api/loan-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (res.ok) {
        onSaved()
        return
      }
      const d = await readJsonSafe<any>(res)
      setError(d?.error || 'Failed to record payment.')
    } catch {
      setError('Request failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record loan repayment">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1">
          <Select label="Loan *" value={form.loanId} onChange={e => selectLoan(e.target.value)} required>
            <option value="">— Select active loan —</option>
            {loans.map(l => (
              <option key={l.loanId} value={l.loanId}>{l.loanId} · {l.borrowerName} · Balance: {fmt$(l.balanceRemaining)}</option>
            ))}
          </Select>
          {selected && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mt-1">
              Monthly due: <strong>{fmt$(selected.monthlyDue)}</strong> · Balance: <strong>{fmt$(selected.balanceRemaining)}</strong> · Next due: <strong>{fmtDate(selected.nextDueDate)}</strong>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Payment date *" type="date" value={form.paymentDate} onChange={set('paymentDate')} required />
          <Input label="Amount ($) *" type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} required />
          <Select label="Method" value={form.paymentMethod} onChange={set('paymentMethod')}>
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Input label="Received by" value={form.receivedBy} onChange={set('receivedBy')} />
          <div className="col-span-2"><Input label="Comments" value={form.comments} onChange={set('comments')} /></div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record repayment'}</Button>
        </div>
      </form>
    </Modal>
  )
}
