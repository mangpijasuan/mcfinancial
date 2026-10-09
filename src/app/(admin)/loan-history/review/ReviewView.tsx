'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, Table, EmptyState, Badge, Button, Input, PageHeader, StatCard } from '@/components/ui'
import { formatUSD, type Cents } from '@/lib/money'
import type { ActiveLoan, ReviewItem } from '@/modules/loans/history'

type Review = {
  total: number; linked: number; exactAvailable: number; toReview: ReviewItem[]
  activeLoans: ActiveLoan[]; activeToConfirm: number; openingPosted: boolean
  members: { id: string; legalName: string; status: string }[]
}

const NO_MEMBER = '__none__'
const money = (c: Cents) => formatUSD(c)
const roleLabel = (role: string) => (role === 'borrower' ? 'Borrower' : 'Co-signer')

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { res, body: await res.json().catch(() => null) }
}

export default function ReviewView({ canLink }: { canLink: boolean }) {
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/loan-history/review', { cache: 'no-store' })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body) { setError(body?.error || 'Could not load the older loans.'); return }
    setReview(body)
  }, [])
  useEffect(() => { load() }, [load])

  async function act(url: string, body: unknown, done: (b: any) => string) {
    setError(''); setMessage(''); setBusy(true)
    const out = await post(url, body)
    setBusy(false)
    if (!out.res.ok) { setError(out.body?.error || 'That did not work. Please try again.'); return false }
    setMessage(done(out.body))
    await load()
    return true
  }

  const r = review
  return (
    <div className="p-4 sm:p-8 space-y-6">
      <PageHeader
        title="Link older loans"
        sub="Migration step M9: the 2021–2025 loans, linked to members by member ID. Once linked, nothing matches names again."
        action={<Link href="/loan-history" className="inline-flex min-h-6 items-center text-sm text-indigo-700 underline">← Loan History</Link>}
      />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      {r && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Linked to members" value={`${r.linked} of ${r.total}`} sub="loans with every name decided" color={r.linked === r.total ? 'green' : 'navy'} />
            <StatCard label="Names to review" value={r.toReview.length + r.exactAvailable} sub={r.exactAvailable ? `${r.exactAvailable} with an exact match` : 'shared or unknown names'} color={r.toReview.length + r.exactAvailable ? 'amber' : 'green'} />
            <StatCard label="Active balances to confirm" value={r.activeToConfirm} sub="needed before opening balances" color={r.activeToConfirm ? 'amber' : 'green'} />
          </div>
          {r.openingPosted && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Opening balances are posted, so balances can no longer be confirmed here. Names can still be linked.
            </p>
          )}

          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Exact matches</h2>
            {r.exactAvailable > 0
              ? <>
                <p className="text-sm text-gray-600">
                  {r.exactAvailable} name{r.exactAvailable === 1 ? '' : 's'} on older loans belong{r.exactAvailable === 1 ? 's' : ''} to exactly one member (legal name or nickname,
                  ignoring case and punctuation). Nothing partial: a shared or unknown name is left for you below.
                </p>
                {canLink && (
                  <Button disabled={busy} onClick={() => act('/api/loan-history/review/link-exact', {}, (b) => `Linked ${b.linked} name${b.linked === 1 ? '' : 's'} to their members.`)}>
                    Link {r.exactAvailable} exact match{r.exactAvailable === 1 ? '' : 'es'}
                  </Button>
                )}
              </>
              : <p className="text-sm text-gray-500">Every name that belongs to exactly one member is linked.</p>}
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Names to review ({r.toReview.length})</h2>
              <p className="text-xs text-gray-400">Names several members share, or that match no member. Pick the member, or record that there is none (someone who has left, a non-member co-signer).</p>
            </div>
            <Table headers={['Loan', 'Role', 'Name in the records', 'Member']}>
              {r.toReview.length === 0
                ? <EmptyState message="Nothing to review." />
                : r.toReview.map((item) => (
                  <tr key={`${item.id}:${item.role}`}>
                    <td className="px-4 py-3 whitespace-nowrap"><span className="font-mono text-xs text-indigo-600">{item.loanId}</span> <Badge>{item.year}</Badge></td>
                    <td className="px-4 py-3 text-xs text-gray-600">{roleLabel(item.role)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {item.name}
                      {item.candidates.length > 1 && <p className="text-xs font-normal text-amber-700">{item.candidates.length} members have this name</p>}
                      {item.candidates.length === 0 && <p className="text-xs font-normal text-gray-400">no member has this name</p>}
                    </td>
                    <td className="px-4 py-3">
                      {canLink
                        ? <LinkDecision item={item} members={r.members} busy={busy} onLink={(memberId, sameName) => act(`/api/loan-history/${item.id}/link`, { role: item.role, memberId, sameName },
                          (b) => `${item.name}: ${memberId ? 'linked' : 'recorded as no member'} on ${b.linked} loan${b.linked === 1 ? '' : 's'}.`)} />
                        : <span className="text-xs text-gray-400">waiting for the Treasurer</span>}
                    </td>
                  </tr>
                ))}
            </Table>
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Older loans marked Active ({r.activeLoans.length})</h2>
              <p className="text-xs text-gray-400">
                Confirm what each one still owed at the end of a day before the cutover, from your own records. A balance still owed moves the loan to the live loans;
                everything repaid before that day is recorded as one brought-forward repayment, so the ledger opens it at exactly your figure.
              </p>
            </div>
            {r.activeLoans.length === 0
              ? <p className="py-6 text-center text-sm text-gray-400">No older loan is marked Active.</p>
              : <ul className="divide-y divide-gray-100">
                {r.activeLoans.map((a) => (
                  <ActiveLoanRow key={a.id} loan={a} canConfirm={canLink && !r.openingPosted} busy={busy}
                    onConfirm={(balance, asOf) => act(`/api/loan-history/${a.id}/confirm`, { balance, asOf },
                      (b) => b.loanId ? `${a.loanId}: ${money(b.balanceCents)} owed, now in the live loans.` : `${a.loanId}: confirmed repaid in full.`)} />
                ))}
              </ul>}
          </Card>
        </>
      )}
    </div>
  )
}

function LinkDecision({ item, members, busy, onLink }: {
  item: ReviewItem; members: Review['members']; busy: boolean; onLink: (memberId: string | null, sameName: boolean) => Promise<boolean>
}) {
  const shared = item.candidates.length > 1
  const options = shared ? item.candidates : members
  const [choice, setChoice] = useState('')
  const [sameName, setSameName] = useState(!shared && item.sameName > 0)
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (choice) onLink(choice === NO_MEMBER ? null : choice, sameName) }}>
      <select aria-label={`Member for ${item.name} (${roleLabel(item.role).toLowerCase()}) on ${item.loanId}`} value={choice} onChange={(e) => setChoice(e.target.value)}
        className="max-w-[16rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
        <option value="">Choose…</option>
        {options.map((m) => <option key={m.id} value={m.id}>{m.legalName} · {m.id}{m.status !== 'Active' ? ` · ${m.status}` : ''}</option>)}
        <option value={NO_MEMBER}>No member record</option>
      </select>
      <Button size="sm" type="submit" disabled={busy || !choice}>Link</Button>
      {!shared && item.sameName > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={sameName} onChange={(e) => setSameName(e.target.checked)} />
          also the {item.sameName} other loan{item.sameName === 1 ? '' : 's'} with this name
        </label>
      )}
    </form>
  )
}

function ActiveLoanRow({ loan: a, canConfirm, busy, onConfirm }: {
  loan: ActiveLoan; canConfirm: boolean; busy: boolean; onConfirm: (balance: string, asOf: string) => Promise<boolean>
}) {
  const [balance, setBalance] = useState(String(a.recordBalanceCents / 100))
  const [asOf, setAsOf] = useState('2025-12-31')
  const person = (p: ActiveLoan['borrower']) => p.memberId
    ? <Link href={`/members/${p.memberId}`} className="text-indigo-700 hover:underline">{p.name} · {p.memberId}</Link>
    : p.link === 'no_member' ? <>{p.name} <span className="text-gray-400">(no member record)</span></> : <>{p.name} <span className="text-amber-700">(not linked)</span></>
  return (
    <li className="px-5 py-4 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-indigo-600">{a.loanId}</span>
        <Badge>{a.year}</Badge>
        <span className="text-gray-900">{money(a.loanCents)} loan made {a.loanDate}</span>
      </div>
      <p className="text-gray-600">Borrower: {person(a.borrower)}{a.cosigner && <> · Co-signer: {person(a.cosigner)}</>}</p>
      <p className="text-xs text-gray-500">
        The records say {money(a.recordPaidCents)} repaid, {money(a.recordBalanceCents)} owed.
        {a.liveLoan && <> A live loan with this ID already exists (copied by the old sync script): {money(a.liveLoan.repaidCents)} of repayments recorded, {money(a.liveLoan.balanceCents)} owed.</>}
      </p>
      {a.confirmed
        ? <p className="text-emerald-800">
          Confirmed {money(a.confirmed.balanceCents)} owed at the end of {a.confirmed.asOf} by {a.confirmed.by}.{' '}
          {a.confirmed.importedLoanId ? <Link href={`/loans/${a.confirmed.importedLoanId}`} className="underline">In the live loans</Link> : 'Repaid in full.'}
        </p>
        : a.blocker
          ? <p className="text-amber-700">{a.blocker}</p>
          : canConfirm && (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); onConfirm(balance, asOf) }}>
              <Input label={`Balance owed on ${a.loanId} ($)`} inputMode="decimal" required value={balance} onChange={(e) => setBalance(e.target.value)} />
              <Input label="At the end of" type="date" required value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              <Button type="submit" disabled={busy}>Confirm balance</Button>
            </form>
          )}
    </li>
  )
}
