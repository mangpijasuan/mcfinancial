'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, Table, EmptyState, Badge, Button, Input, PageHeader, StatCard } from '@/components/ui'
import { formatUSD, type Cents } from '@/lib/money'
import type { OpeningReport } from '@/modules/accounting/opening'

type Report = Omit<OpeningReport, 'posted'> & { posted: { cutover: string; entryNumber: string } | null; openingHash: string }

const money = (c: Cents | null | undefined) => (c === null || c === undefined ? '—' : formatUSD(c))

export default function OpeningView({ canPropose }: { canPropose: boolean }) {
  const [cutover, setCutover] = useState('2026-01-01')
  const [bank, setBank] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmLoans, setConfirmLoans] = useState(false)

  const load = useCallback(async () => {
    setError('')
    const q = new URLSearchParams({ cutover, ...(bank ? { bankBalance: bank } : {}) })
    const res = await fetch(`/api/ledger/opening?${q}`, { cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body) { setError(body?.error || 'Could not build the report.'); return }
    setReport(body)
  }, [cutover, bank])
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function propose() {
    setError(''); setMessage('')
    const res = await fetch('/api/ledger/opening', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cutover, bankBalance: bank, confirmLoans }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) { setError(body?.error || 'Could not propose.'); return }
    setMessage(`Sent for approval (${body.approvalRequest.publicId}). A second person reviews this report and approves it on the Approvals page; then everything is posted in one go.`)
  }

  const equity = report?.openingEquityCents ?? 0
  return (
    <div className="p-4 sm:p-8 space-y-6">
      <PageHeader
        title="Opening balances"
        sub="Migration step M4: the ledger's starting point at the cutover, then everything recorded since. Nothing is posted until a second person approves."
        action={<Link href="/ledger" className="inline-flex min-h-6 items-center text-sm text-indigo-700 underline">← Ledger</Link>}
      />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {report?.posted && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Opening balances were posted from {report.posted.cutover} ({report.posted.entryNumber}). The checks below now compare the ledger with the old records.
        </p>
      )}

      <Card className="p-5">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Input label="Cutover (first day in the ledger)" type="date" value={cutover} onChange={(e) => setCutover(e.target.value)} />
          <Input label="Bank balance the day before ($)" inputMode="decimal" placeholder="from the bank statement" value={bank} onChange={(e) => setBank(e.target.value)} />
          <Button type="submit" variant="secondary">Update report</Button>
        </form>
      </Card>

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Member capital" value={money(report.memberCapital.totalCents)} sub={`${report.memberCapital.members} members' archive totals`} />
            <StatCard label="Bank" value={money(report.bankCents)} sub={report.bankCents === null ? 'enter the statement balance' : `on ${report.openingDate}`} color="teal" />
            <StatCard label="Loans receivable" value={money(report.loansTotalCents)} sub={`${report.loansAtCutover.length} loans open at the cutover`} color="blue" />
            <StatCard label="Opening equity (9000)" value={money(report.openingEquityCents)} sub={equity > 0 ? 'more assets than member capital' : equity < 0 ? 'less assets than member capital' : 'the books tie'} color={equity < 0 ? 'red' : 'navy'} />
          </div>
          <Card className="p-5 text-sm text-gray-700 space-y-2">
            <p>
              <strong>Opening equity</strong> is cash plus loans owed to the club, minus what the club owes its members.
              {' '}Zero means the records tie. Anything else is the club&apos;s historical surplus or shortfall: fees never recorded, losses,
              withdrawals never recorded, or data errors. It must be explained to the board and moved to the right accounts before the ledger
              becomes the system of record.
            </p>
            <p className="text-gray-500">
              Since the cutover, {report.replay.contributions.count} contributions ({money(report.replay.contributions.totalCents)}),
              {' '}{report.replay.withdrawals.count} withdrawals ({money(report.replay.withdrawals.totalCents)}),
              {' '}{report.replay.loanDisbursements.count} loan payouts ({money(report.replay.loanDisbursements.totalCents)}) and
              {' '}{report.replay.loanRepayments.count} loan repayments ({money(report.replay.loanRepayments.totalCents)}) are posted on their own dates.
            </p>
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Items to review ({report.anomalies.length})</h2>
            </div>
            {report.anomalies.length === 0
              ? <p className="py-6 text-center text-sm text-gray-400">Nothing unusual in the records.</p>
              : <ul className="divide-y divide-gray-100">
                {report.anomalies.map((a) => (
                  <li key={a.code} className="px-5 py-3 text-sm">
                    <p className="font-medium text-gray-900">{a.message}</p>
                    <p className="text-xs text-gray-500">{a.count} {a.totalCents !== undefined ? `· ${money(a.totalCents)}` : ''} {a.items?.length ? `· ${a.items.slice(0, 12).join(', ')}${a.items.length > 12 ? '…' : ''}` : ''}</p>
                  </li>
                ))}
              </ul>}
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Loans open at the cutover</h2>
              <p className="text-xs text-gray-400">Loan amount less repayments before the cutover. The Treasurer confirms each balance before proposing.</p>
            </div>
            <Table headers={['Loan', 'Borrower', 'Made', 'Balance at cutover']}>
              {report.loansAtCutover.length === 0
                ? <EmptyState message="No loans were open at the cutover." />
                : report.loansAtCutover.map((l) => (
                  <tr key={l.loanId}>
                    <td className="px-4 py-2 font-mono text-xs"><Link className="underline" href={`/loans/${l.loanId}`}>{l.loanId}</Link></td>
                    <td className="px-4 py-2">{l.borrower}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{l.loanDate}</td>
                    <td className="px-4 py-2 tabular-nums font-semibold">{money(l.balanceCents)}</td>
                  </tr>
                ))}
            </Table>
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Differences with the old records ({report.checks.memberCapital.length + report.checks.loans.length})</h2>
              <p className="text-xs text-gray-400">The ledger after posting, against the stored member totals and loan balances. Each one needs an explanation.</p>
            </div>
            <Table headers={['What', 'Ledger', 'Old record', 'Difference']}>
              {report.checks.memberCapital.length + report.checks.loans.length === 0
                ? <EmptyState message="The ledger agrees with the old records." />
                : [
                  ...report.checks.memberCapital.map((c) => (
                    <tr key={`m-${c.memberId}`}>
                      <td className="px-4 py-2">Capital of {c.name} ({c.memberId})</td>
                      <td className="px-4 py-2 tabular-nums">{money(c.ledgerCents)}</td>
                      <td className="px-4 py-2 tabular-nums">{money(c.legacyCents)}</td>
                      <td className="px-4 py-2 tabular-nums font-semibold">{money(c.differenceCents)}</td>
                    </tr>
                  )),
                  ...report.checks.loans.map((c) => (
                    <tr key={`l-${c.loanId}`}>
                      <td className="px-4 py-2">Loan {c.loanId} ({c.borrower})</td>
                      <td className="px-4 py-2 tabular-nums">{money(c.ledgerCents)}</td>
                      <td className="px-4 py-2 tabular-nums">{money(c.legacyCents)}</td>
                      <td className="px-4 py-2 tabular-nums font-semibold">{money(c.differenceCents)}</td>
                    </tr>
                  )),
                ]}
            </Table>
          </Card>

          <Card className="p-5 space-y-2 text-sm">
            <h2 className="font-semibold text-gray-700">Older loans moving onto the loan engine</h2>
            <p className="text-gray-600">{report.adoption.adopt.length ? report.adoption.adopt.join(', ') : 'None'}: their repayments match their schedule, so they get stored schedules and daily servicing.</p>
            {report.adoption.keepLegacy.length > 0 && (
              <ul className="list-disc pl-5 text-gray-600">
                {report.adoption.keepLegacy.map((k) => <li key={k.loanId}><span className="font-mono">{k.loanId}</span> stays as it is: {k.reason}.</li>)}
              </ul>
            )}
          </Card>

          {canPropose && !report.posted && (
            <Card className="p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">Propose posting</h2>
              <p className="text-sm text-gray-600">
                Posts {report.entries} opening entries dated {report.openingDate}, then everything since the cutover.
                A second person must approve; the chart of accounts must already be approved.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmLoans} onChange={(e) => setConfirmLoans(e.target.checked)} className="mt-1" />
                <span>I have checked the loan balances at the cutover against the club&apos;s records (and entered the bank balance from the statement).</span>
              </label>
              <Button onClick={propose} disabled={!confirmLoans || report.bankCents === null}>Send for approval</Button>
              {report.bankCents === null && <p className="text-xs text-amber-700">Enter the bank balance and update the report first.</p>}
              <Badge variant="gray">Plan {report.openingHash.slice(0, 12)}</Badge>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
