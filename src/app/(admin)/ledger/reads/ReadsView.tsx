'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, Table, EmptyState, Badge, PageHeader, StatCard } from '@/components/ui'
import { formatUSD, type Cents } from '@/lib/money'
import type { ParityReport, ReadSource } from '@/modules/accounting/reads'
import type { Streak } from '@/modules/accounting/comparison'

type Reads = { source: ReadSource; parity: ParityReport | null; streak: (Streak & { target: number }) | null }

const money = (c: Cents) => formatUSD(c)
const TOTALS: { key: keyof ParityReport['totals']; label: string }[] = [
  { key: 'contributed', label: 'Contributions (archive + since the cutover)' },
  { key: 'withdrawn', label: 'Withdrawals since the cutover' },
  { key: 'capital', label: 'Member capital' },
  { key: 'outstanding', label: 'Loans outstanding (paid out)' },
]

export default function ReadsView() {
  const [reads, setReads] = useState<Reads | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/ledger/reads', { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok || !body) throw new Error(body?.error || 'Could not load the comparison.')
        setReads(body)
      })
      .catch((e) => setError(e.message))
  }, [])

  const back = <Link href="/ledger" className="text-sm text-indigo-700 underline">← Ledger</Link>
  const p = reads?.parity
  const differences = p ? p.members.length + p.loans.length : 0
  return (
    <div className="p-4 sm:p-8 space-y-6">
      <PageHeader title="Ledger reads" sub="Migration step M6: dashboards, statements, eligibility and loan balances read from the ledger, behind a switch." action={back} />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {reads && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Screens read from" value={reads.source.source === 'ledger' ? 'The ledger' : 'The records'} sub={`LEDGER_READS is ${reads.source.requested ? 'on' : 'off'}`} color={reads.source.source === 'ledger' ? 'green' : 'navy'} />
            <StatCard label="Figures that differ" value={p ? differences : '—'} sub={p ? `${p.checked.members} members, ${p.checked.loans} loans checked` : 'after opening balances'} color={!p ? 'navy' : differences ? 'amber' : 'green'} />
            <StatCard label="Clean days in a row" value={reads.streak ? `${reads.streak.days} of ${reads.streak.target}` : '—'} sub={reads.streak ? (reads.streak.met ? 'M5 met, month-end included' : reads.streak.includesMonthEnd ? 'month-end included' : 'needs a month-end too') : 'after opening balances'} color={reads.streak?.met ? 'green' : 'navy'} />
          </div>

          <Card className="p-5 space-y-2 text-sm text-gray-700">
            <p>{reads.source.reason}</p>
            <p>
              Turn it on once the <Link className="underline" href="/ledger/comparison">nightly comparison</Link> has run clean for {reads.streak?.target ?? 30} days
              including a month-end, and the Board has reviewed the first monthly report from the ledger. On the server, set <code>LEDGER_READS=true</code> in
              <code> .env.production</code> and restart the app. Setting it back to <code>false</code> returns every screen to the records.
            </p>
            <p className="text-gray-500">The figures keep their meaning either way; only where they come from changes. Until it is on, the records are what members and staff see.</p>
          </Card>

          {!p
            ? <Card className="p-5 text-sm text-gray-600">Nothing to compare until opening balances are posted (<Link className="underline" href="/ledger/opening">M4</Link>).</Card>
            : (
              <>
                <Card>
                  <div className="px-5 py-4 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-700">Club totals</h2></div>
                  <Table headers={['Figure', 'Records', 'Ledger', 'Difference']}>
                    {TOTALS.map(({ key, label }) => {
                      const t = p.totals[key]
                      const diff = t.ledgerCents - t.recordsCents
                      return (
                        <tr key={key}>
                          <td className="px-4 py-2">{label}</td>
                          <td className="px-4 py-2 tabular-nums">{money(t.recordsCents)}</td>
                          <td className="px-4 py-2 tabular-nums">{money(t.ledgerCents)}</td>
                          <td className="px-4 py-2">{diff === 0 ? <Badge variant="green">none</Badge> : <Badge variant="red">{money(diff as Cents)}</Badge>}</td>
                        </tr>
                      )
                    })}
                  </Table>
                </Card>

                <Card>
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h2 className="text-sm font-semibold text-gray-700">Members whose figures differ ({p.members.length})</h2>
                    <p className="text-xs text-gray-400">Shown on the member page, the portal and in loan eligibility.</p>
                  </div>
                  <Table headers={['Member', 'Figure', 'Records', 'Ledger', 'Difference']}>
                    {p.members.length === 0
                      ? <EmptyState message="Every member's contributions and withdrawals agree." />
                      : p.members.map((m) => (
                        <tr key={`${m.memberId}:${m.field}`}>
                          <td className="px-4 py-2"><Link href={`/members/${m.memberId}`} className="text-indigo-700 hover:underline">{m.name}</Link> <span className="text-xs text-gray-400">{m.memberId}</span></td>
                          <td className="px-4 py-2 text-xs text-gray-600">{m.field}</td>
                          <td className="px-4 py-2 tabular-nums">{money(m.recordsCents)}</td>
                          <td className="px-4 py-2 tabular-nums">{money(m.ledgerCents)}</td>
                          <td className="px-4 py-2 tabular-nums">{money(m.differenceCents)}</td>
                        </tr>
                      ))}
                  </Table>
                </Card>

                <Card>
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h2 className="text-sm font-semibold text-gray-700">Loans whose balance differs ({p.loans.length})</h2>
                    <p className="text-xs text-gray-400">Shown on the loan pages, the dashboard, the portal and in the repayment limit.</p>
                  </div>
                  <Table headers={['Loan', 'Borrower', 'Records', 'Ledger', 'Difference']}>
                    {p.loans.length === 0
                      ? <EmptyState message="Every paid-out loan's balance agrees." />
                      : p.loans.map((l) => (
                        <tr key={l.loanId}>
                          <td className="px-4 py-2"><Link href={`/loans/${l.loanId}`} className="font-mono text-xs text-indigo-700 hover:underline">{l.loanId}</Link></td>
                          <td className="px-4 py-2">{l.borrower}</td>
                          <td className="px-4 py-2 tabular-nums">{money(l.recordsCents)}</td>
                          <td className="px-4 py-2 tabular-nums">{money(l.ledgerCents)}</td>
                          <td className="px-4 py-2 tabular-nums">{money(l.differenceCents)}</td>
                        </tr>
                      ))}
                  </Table>
                </Card>
              </>
            )}
        </>
      )}
    </div>
  )
}
