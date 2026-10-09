'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Card, LoanStatusBadge, Badge, Button, Spinner, Input, Select, Modal, Textarea, ScrollArea } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { formatUSD, type Cents } from '@/lib/money'

type Split = { fees: Cents; principal: Cents; unapplied: Cents }
type Servicing = {
  lifecycle: string
  policyVersion: string | null
  principalCents: Cents
  applicationFeeCents: Cents
  disbursement: { on: string; amountCents: Cents; method: string | null; reference: string | null; journalEntry: string | null } | null
  installments: { number: number; dueDate: string; amount: Cents; paid: Cents; remaining: Cents; status: string }[]
  fees: { feeId: string; installmentNumber: number; amountCents: Cents; assessedOn: string; status: string; waivedOn: string | null; waiverReason: string | null; journalEntry: string | null }[]
  payments: { paymentId: string; journalEntry: string | null; split: Split | null }[]
  outstandingPrincipalCents: Cents
  feesOutstandingCents: Cents
  payoffCents: Cents
  unappliedCents: Cents
  delinquency: { status: string | null; daysPastDue: number; servicedOn: string | null; overdueCents: Cents }
  chargedOffOn: string | null
  chargeOffEntry: string | null
  agreement: { agreementId: string; status: string } | null
  lateFeesEnabled: boolean
  can: { disburse: boolean; repay: boolean; writeOff: boolean; cancel: boolean }
}

const STAGES: { key: string; label: string }[] = [
  { key: 'approved', label: 'Approved' },
  { key: 'agreement_signed', label: 'Agreement signed' },
  { key: 'disbursed', label: 'Paid out' },
  { key: 'paid_off', label: 'Paid off' },
]
const STAGE_NOTE: Record<string, string> = {
  approved: 'Waiting for the borrower, co-signer and the club to sign the agreement.',
  agreement_signed: 'Everyone has signed. Record the payout once the money is sent.',
  disbursed: 'Being repaid. Delinquency is checked every day from the schedule.',
  paid_off: 'Fully repaid.',
  charged_off: 'Written off after Board approval. Recoveries are not supported yet.',
  cancelled: 'Cancelled before any money was paid out.',
}
const INSTALLMENT_BADGE: Record<string, { variant: 'green' | 'amber' | 'red' | 'gray'; label: string }> = {
  paid: { variant: 'green', label: 'Paid' },
  partly_paid: { variant: 'amber', label: 'Part paid' },
  overdue: { variant: 'red', label: 'Overdue' },
  due: { variant: 'gray', label: 'Due' },
}
const METHODS = ['Zelle', 'Bank transfer', 'Check', 'Cash']

const today = () => new Date().toLocaleDateString('en-CA')

function Ledger({ entry }: { entry: string | null }) {
  return entry
    ? <span className="font-mono text-xs text-gray-500">{entry}</span>
    : <span className="text-xs text-gray-400" title="Posts once the accountant approves the chart of accounts (Gate #1 A13)">not in the ledger yet</span>
}

export default function LoanDetail({ id, can }: { id: string; can: { disburse: boolean; waive: boolean; writeOff: boolean } }) {
  const router = useRouter()
  const [loan, setLoan] = useState<any>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [disburse, setDisburse] = useState({ open: false, disbursedOn: today(), method: 'Zelle', reference: '' })
  const [waive, setWaive] = useState<{ feeId: string; reason: string } | null>(null)
  const [writeOff, setWriteOff] = useState<{ reason: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/loans/${id}`, { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) { setError(data?.error || 'Could not load the loan.'); return }
    setLoan(data)
  }, [id])
  useEffect(() => { load() }, [load])

  async function post(url: string, body: unknown, done: string) {
    setError(''); setMessage('')
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    if (!res.ok) { setError(data?.error || 'Something went wrong.'); return false }
    setMessage(res.status === 202
      ? `Sent for approval (${data.approvalRequest.publicId}). It takes effect once a second person approves it on the Approvals page.`
      : done)
    await load()
    return true
  }

  if (!loan) return <div className="p-8">{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <Spinner />}</div>

  const s: Servicing | null = loan.servicing
  const pct = loan.loanAmount > 0 ? Math.round((loan.totalPaid / loan.loanAmount) * 100) : 0
  const splits = new Map((s?.payments ?? []).map((p) => [p.paymentId, p]))
  const stageIndex = s ? STAGES.findIndex((st) => st.key === s.lifecycle) : -1

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/loans')}><ArrowLeft size={15} /> Back</Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">{loan.loanId}</h1>
            <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
          </div>
          <p className="text-sm text-gray-500">{loan.borrowerName} {loan.cosignerName ? `· Co-signer: ${loan.cosignerName}` : ''}</p>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      {s && (
        <Card className="p-5 mb-6">
          <ol className="flex flex-wrap items-center gap-2 text-xs mb-3" aria-label="Loan stage">
            {STAGES.map((st, i) => {
              const done = stageIndex >= i
              const current = s.lifecycle === st.key
              return (
                <li key={st.key} className="flex items-center gap-2">
                  <span
                    aria-current={current ? 'step' : undefined}
                    className={`rounded-full px-2.5 py-1 font-semibold ${current ? 'bg-[#1B2A4A] text-white' : done ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}
                  >{st.label}</span>
                  {i < STAGES.length - 1 && <span className="text-gray-300">→</span>}
                </li>
              )
            })}
            {(s.lifecycle === 'charged_off' || s.lifecycle === 'cancelled') && (
              <li><span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800">{s.lifecycle === 'cancelled' ? 'Cancelled' : 'Written off'}</span></li>
            )}
          </ol>
          <p className="text-sm text-gray-600">{STAGE_NOTE[s.lifecycle]}</p>
          {s.lifecycle === 'approved' && s.agreement && (
            <p className="mt-2 text-sm"><Link className="text-blue-700 underline" href="/agreements">Agreement {s.agreement.agreementId}</Link> · {s.agreement.status.replace('_', ' ')}</p>
          )}
          {s.can.disburse && can.disburse && (
            <div className="mt-3"><Button onClick={() => setDisburse((d) => ({ ...d, open: true }))}>Record payout</Button></div>
          )}
          {s.disbursement && (
            <div className="mt-3 rounded-lg bg-gray-50 px-4 py-3 text-sm">
              Paid out <strong>{formatUSD(s.disbursement.amountCents)}</strong> on {fmtDate(s.disbursement.on)} by {s.disbursement.method}
              {s.disbursement.reference ? ` (ref. ${s.disbursement.reference})` : ''}: {formatUSD(s.principalCents)} less the {formatUSD(s.applicationFeeCents)} application fee.{' '}
              <Ledger entry={s.disbursement.journalEntry} />
            </div>
          )}
          {s.lifecycle === 'disbursed' && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              {s.delinquency.status === 'delinquent'
                ? <Badge variant="red">Delinquent · {s.delinquency.daysPastDue} days past due</Badge>
                : <Badge variant="green">Current{s.delinquency.daysPastDue > 0 ? ` · ${s.delinquency.daysPastDue} days late, within grace` : ''}</Badge>}
              <span className="text-gray-500">Checked {s.delinquency.servicedOn ? fmtDate(s.delinquency.servicedOn) : 'at the last payment'}</span>
              {s.can.writeOff && can.writeOff && (
                <Button variant="danger" size="sm" onClick={() => setWriteOff({ reason: '' })}>Propose write-off</Button>
              )}
            </div>
          )}
          {s.lifecycle === 'charged_off' && (
            <p className="mt-2 text-sm">Written off on {fmtDate(s.chargedOffOn)}. <Ledger entry={s.chargeOffEntry} /></p>
          )}
        </Card>
      )}

      <Card className="p-5 mb-6">
        <div className="flex justify-between text-sm mb-3">
          <span className="text-gray-500">Repayment progress</span>
          <span className="font-semibold">{pct}% paid</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3 mb-4">
          <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div><p className="text-xs text-gray-400">Loan amount</p><p className="text-lg font-bold text-gray-900">{fmt$(loan.loanAmount)}</p></div>
          <div><p className="text-xs text-gray-400">Total paid</p><p className="text-lg font-bold text-green-600">{fmt$(loan.totalPaid)}</p></div>
          <div><p className="text-xs text-gray-400">Principal left</p><p className="text-lg font-bold text-gray-900">{fmt$(loan.balanceRemaining)}</p></div>
          {s
            ? <div><p className="text-xs text-gray-400">Payoff today</p><p className="text-lg font-bold text-gray-900">{formatUSD(s.payoffCents)}</p></div>
            : <div><p className="text-xs text-gray-400">Monthly due</p><p className="text-lg font-bold text-gray-900">{fmt$(loan.monthlyDue)}</p></div>}
        </div>
        {s && s.feesOutstandingCents > 0 && <p className="mt-3 text-center text-sm text-amber-700">Includes {formatUSD(s.feesOutstandingCents)} in unpaid fees.</p>}
        {s && s.unappliedCents > 0 && <p className="mt-3 text-center text-sm text-gray-600">{formatUSD(s.unappliedCents)} overpaid, held for the member.</p>}
      </Card>

      <Card className="p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            ['Loan date', fmtDate(loan.loanDate)],
            ['Term', `${loan.termMonths} months`],
            ['Monthly due', s ? formatUSD(s.installments[0].amount) : fmt$(loan.monthlyDue)],
            ['Last installment', fmtDate(loan.endDate)],
            ['Next due', fmtDate(loan.nextDueDate)],
            ['Borrower ID', loan.borrowerId],
            ['Co-signer', loan.cosignerName || '—'],
            ['Notes', loan.notes || '—'],
          ].map(([l, v]) => (
            <div key={l} className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{l}</p>
              <p className="font-medium text-gray-900 wrap-break-word">{v}</p>
            </div>
          ))}
        </div>
        {!s && <p className="mt-4 text-xs text-gray-500">This loan was made before repayment schedules were stored. Its balance and overdue flag are kept by hand until it is migrated.</p>}
      </Card>

      {s && (
        <Card className="mb-6">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Repayment schedule</h2>
            <p className="text-xs text-gray-400">Due on the {loan.dueDay ?? 10}th of each month; the last installment absorbs any rounding. Policy {s.policyVersion}.</p>
          </div>
          <ScrollArea label="Repayment schedule">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-2 text-left">#</th><th className="px-4 py-2 text-left">Due</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Paid</th><th className="px-4 py-2 text-left">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.installments.map((it) => {
                  const badge = INSTALLMENT_BADGE[it.status]
                  return (
                    <tr key={it.number}>
                      <td className="px-3 py-2 text-gray-500">{it.number}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(it.dueDate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatUSD(it.amount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatUSD(it.paid)}</td>
                      <td className="px-4 py-2"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      )}

      {s && (s.fees.length > 0 || s.lifecycle === 'disbursed') && (
        <Card className="mb-6">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Late fees</h2>
            {!s.lateFeesEnabled && <p className="text-xs text-gray-400">Late fees are switched off until counsel confirms the state’s limits (Gate #1 A7).</p>}
          </div>
          {s.fees.length === 0
            ? <p className="py-6 text-center text-sm text-gray-400">No fees charged.</p>
            : <div className="divide-y divide-gray-100">
              {s.fees.map((f) => (
                <div key={f.feeId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{f.feeId} · installment {f.installmentNumber} · {formatUSD(f.amountCents)}</p>
                    <p className="text-xs text-gray-400">Charged {fmtDate(f.assessedOn)} · <Ledger entry={f.journalEntry} />
                      {f.status === 'waived' && <> · waived {fmtDate(f.waivedOn)}: {f.waiverReason}</>}</p>
                  </div>
                  {f.status === 'waived'
                    ? <Badge variant="gray">Waived</Badge>
                    : can.waive && s.lifecycle === 'disbursed' && <Button size="sm" variant="secondary" onClick={() => setWaive({ feeId: f.feeId, reason: '' })}>Propose waiver</Button>}
                </div>
              ))}
            </div>}
        </Card>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Payment history ({loan.payments?.length || 0})</h2>
        </div>
        {loan.payments?.length === 0
          ? <p className="py-10 text-center text-sm text-gray-400">No payments recorded yet.</p>
          : <div className="divide-y divide-gray-100">
            {loan.payments?.map((p: any) => {
              const posted = splits.get(p.paymentId)
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{p.paymentId}</p>
                    <p className="text-xs text-gray-400">{fmtDate(p.paymentDate)} · {p.paymentMethod || '—'} {p.receivedBy ? `· ${p.receivedBy}` : ''}</p>
                    {posted?.split && (
                      <p className="text-xs text-gray-500">
                        {formatUSD(posted.split.principal)} principal
                        {posted.split.fees > 0 ? ` · ${formatUSD(posted.split.fees)} fees` : ''}
                        {posted.split.unapplied > 0 ? ` · ${formatUSD(posted.split.unapplied)} overpaid` : ''} · <Ledger entry={posted.journalEntry} />
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-700">{fmt$(p.amount)}</p>
                    {p.comments && <p className="text-xs text-gray-400">{p.comments}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        }
      </Card>

      <Modal open={disburse.open} onClose={() => setDisburse((d) => ({ ...d, open: false }))} title="Record payout">
        {s && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault()
            if (await post(`/api/loans/${id}/disburse`, { disbursedOn: disburse.disbursedOn, method: disburse.method, reference: disburse.reference }, 'Payout recorded.')) {
              setDisburse((d) => ({ ...d, open: false }))
            }
          }}>
            <p className="text-sm text-gray-600">
              Send the borrower <strong>{formatUSD((s.principalCents - s.applicationFeeCents) as Cents)}</strong>: the {formatUSD(s.principalCents)} loan
              less the {formatUSD(s.applicationFeeCents)} application fee (Gate #1 A8). They repay the full {formatUSD(s.principalCents)}.
            </p>
            <Input label="Date paid out" type="date" required value={disburse.disbursedOn} max={today()} onChange={(e) => setDisburse((d) => ({ ...d, disbursedOn: e.target.value }))} />
            <Select label="Method" value={disburse.method} onChange={(e) => setDisburse((d) => ({ ...d, method: e.target.value }))}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
            <Input label="Reference (optional)" value={disburse.reference} placeholder="Zelle confirmation or check number" onChange={(e) => setDisburse((d) => ({ ...d, reference: e.target.value }))} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDisburse((d) => ({ ...d, open: false }))}>Cancel</Button>
              <Button type="submit">Record payout</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={waive !== null} onClose={() => setWaive(null)} title="Propose a fee waiver">
        {waive && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault()
            if (await post(`/api/loan-fees/${waive.feeId}/waive`, { reason: waive.reason }, 'Fee waived.')) setWaive(null)
          }}>
            <p className="text-sm text-gray-600">A second person (Treasurer) must approve the waiver.</p>
            <Textarea label="Reason" required value={waive.reason} onChange={(e) => setWaive({ ...waive, reason: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setWaive(null)}>Cancel</Button>
              <Button type="submit">Send for approval</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={writeOff !== null} onClose={() => setWriteOff(null)} title="Propose a write-off">
        {writeOff && s && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault()
            if (await post(`/api/loans/${id}/write-off`, { reason: writeOff.reason }, 'Loan written off.')) setWriteOff(null)
          }}>
            <p className="text-sm text-gray-600">
              Writes off {formatUSD(s.payoffCents)} as a loan loss. Two Board members must approve it, and the borrower cannot borrow again.
            </p>
            <Textarea label="Reason (collection steps taken)" required value={writeOff.reason} onChange={(e) => setWriteOff({ reason: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setWriteOff(null)}>Cancel</Button>
              <Button type="submit" variant="danger">Send for approval</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
