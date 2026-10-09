'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, Table, EmptyState, Badge, Button, PageHeader, StatCard } from '@/components/ui'
import { formatUSD } from '@/lib/money'
import type { ComparisonDetails, ComparisonRunSummary, Streak } from '@/modules/accounting/comparison'

type Status =
  | { started: false; target: number }
  | {
      started: true
      target: number
      cutover: string
      streak: Streak
      latest: { runDate: string; ranAt: string; ok: boolean; differences: number; details: ComparisonDetails; emailedTo: string | null } | null
      history: ComparisonRunSummary[]
    }

const KIND_LABELS: Record<string, string> = {
  contribution: 'Contribution', contribution_reversal: 'Contribution reversal', withdrawal: 'Withdrawal',
  loan_payment: 'Loan repayment', loan_payout: 'Loan payout', loan_write_off: 'Loan write-off',
  loan_fee: 'Late fee', loan_fee_waiver: 'Late-fee waiver',
}

export default function ComparisonView({ canRun }: { canRun: boolean }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/ledger/comparison', { cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body) { setError(body?.error || 'Could not load the comparison.'); return }
    setStatus(body)
  }, [])
  useEffect(() => { load() }, [load])

  async function runNow() {
    setError(''); setRunning(true)
    const res = await fetch('/api/ledger/comparison', { method: 'POST' })
    const body = await res.json().catch(() => null)
    setRunning(false)
    if (!res.ok || !body) { setError(body?.error || 'Could not run the comparison.'); return }
    setStatus(body)
  }

  const back = <Link href="/ledger" className="inline-flex min-h-6 items-center text-sm text-indigo-700 underline">← Ledger</Link>
  if (status && !status.started) {
    return (
      <div className="p-4 sm:p-8 space-y-6">
        <PageHeader title="Nightly comparison" sub="Migration step M5: the ledger against the old records, every night." action={back} />
        <Card className="p-5 text-sm text-gray-600">
          The comparison starts once opening balances are posted (<Link className="underline" href="/ledger/opening">M4</Link>).
          Until then the old records are the only books.
        </Card>
      </div>
    )
  }

  const s = status?.started ? status : null
  const d = s?.latest?.details
  return (
    <div className="p-4 sm:p-8 space-y-6">
      <PageHeader
        title="Nightly comparison"
        sub="Migration step M5: every money event is written to the ledger and the old records together; each night the two are compared. The ledger becomes the system of record after 30 clean days in a row, including a month-end."
        action={back}
      />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {s && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Clean days in a row"
              value={`${s.streak.days} / ${s.target}`}
              sub={s.streak.days ? `since ${s.streak.from}` : 'no clean run yet'}
              color={s.streak.met ? 'teal' : 'navy'}
            />
            <StatCard
              label="Month-end included"
              value={s.streak.includesMonthEnd ? 'Yes' : 'Not yet'}
              sub="a month's last day must be in the run"
              color={s.streak.includesMonthEnd ? 'teal' : 'navy'}
            />
            <StatCard
              label="Last run"
              value={s.latest ? (s.latest.ok ? 'No differences' : `${s.latest.differences} difference(s)`) : '—'}
              sub={s.latest ? `${s.latest.runDate}${s.latest.emailedTo ? ` · alert sent to ${s.latest.emailedTo}` : ''}` : 'schedule npm run ledger:compare'}
              color={s.latest && !s.latest.ok ? 'red' : 'blue'}
            />
          </div>
          {s.streak.met && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              The M5 exit criterion is met. The next step (M6) moves dashboards, statements and balances to read from the ledger, after the board reviews the first ledger-based monthly report.
            </p>
          )}
          {canRun && (
            <div><Button variant="secondary" onClick={runNow} disabled={running}>{running ? 'Comparing…' : 'Run the comparison now'}</Button></div>
          )}

          {d && !s.latest!.ok && (
            <Card>
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Differences on {s.latest!.runDate}</h2>
                <p className="text-xs text-gray-400">Each one needs an explanation and a fix (a correcting entry or a corrected record) before the count can start again.</p>
              </div>
              <Table headers={['What', 'Ledger', 'Records', 'Detail']}>
                {[
                  ...d.invariants.map((p) => (
                    <tr key={`i-${p}`}><td className="px-4 py-2" colSpan={4}>Ledger rule broken: {p}</td></tr>
                  )),
                  ...d.memberCapital.map((m) => (
                    <tr key={`m-${m.memberId}`}>
                      <td className="px-4 py-2">Capital of {m.name} ({m.memberId})</td>
                      <td className="px-4 py-2 tabular-nums">{formatUSD(m.ledgerCents)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatUSD(m.legacyCents)}</td>
                      <td className="px-4 py-2 tabular-nums">difference {formatUSD(m.differenceCents)}</td>
                    </tr>
                  )),
                  ...d.loans.map((l) => (
                    <tr key={`l-${l.loanId}`}>
                      <td className="px-4 py-2">Loan <Link className="underline" href={`/loans/${l.loanId}`}>{l.loanId}</Link> ({l.borrower})</td>
                      <td className="px-4 py-2 tabular-nums">{formatUSD(l.ledgerCents)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatUSD(l.legacyCents)}</td>
                      <td className="px-4 py-2 tabular-nums">difference {formatUSD(l.differenceCents)}</td>
                    </tr>
                  )),
                  ...d.unposted.map((u) => (
                    <tr key={`u-${u.kind}-${u.id}`}>
                      <td className="px-4 py-2">{KIND_LABELS[u.kind] ?? u.kind} {u.id}</td>
                      <td className="px-4 py-2 text-gray-400">not posted</td>
                      <td className="px-4 py-2 tabular-nums">{formatUSD(u.cents)}</td>
                      <td className="px-4 py-2">{u.date}</td>
                    </tr>
                  )),
                ]}
              </Table>
            </Card>
          )}

          <Card>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Recent runs</h2>
            </div>
            <Table headers={['Day', 'Result', 'Ran at']}>
              {s.history.length === 0
                ? <EmptyState message="No comparison has run yet. Schedule npm run ledger:compare nightly (deploy guide, step 10)." />
                : s.history.map((r) => (
                  <tr key={`${r.runDate}-${r.ranAt}`}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.runDate}
                      {r.backdated && <span className="ml-2 text-xs text-gray-400" title="Run on a later day with --as-of: does not count towards the clean days">backdated</span>}
                    </td>
                    <td className="px-4 py-2">{r.ok ? <Badge variant="green">No differences</Badge> : <Badge variant="red">{r.differences} difference(s)</Badge>}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{new Date(r.ranAt).toLocaleString()}</td>
                  </tr>
                ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
