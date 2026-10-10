'use client'
import { useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, CircleCheck, CreditCard, Handshake, Landmark, ListOrdered } from 'lucide-react'
import { cn, fmtDate } from '@/lib/utils'
import { Empty, PageHeader, PageSkeleton, Panel, Pill, Progress, Row, Rows, button, surface, type Tone } from '@/components/portal/kit'
import { formatUSD, type Cents } from '@/lib/money'
import type { CosignedLoan, LoanStage, MemberLoan } from '@/modules/loans/memberView'

const usd = (c: number) => formatUSD(c as Cents)

const STAGE: Record<LoanStage, { label: string; tone: Tone }> = {
  repaying: { label: 'Being repaid', tone: 'blue' },
  awaiting_payout: { label: 'Waiting to be paid out', tone: 'navy' },
  paid_off: { label: 'Paid off', tone: 'green' },
  written_off: { label: 'Written off', tone: 'gray' },
}

const INSTALLMENT: Record<string, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'green' },
  partly_paid: { label: 'Part paid', tone: 'amber' },
  overdue: { label: 'Late', tone: 'red' },
  due: { label: 'Due', tone: 'gray' },
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={cn('mt-0.5 font-semibold tabular-nums', strong ? 'text-emerald-700' : 'text-gray-900')}>{value}</dd>
    </div>
  )
}

function LoanCard({ loan }: { loan: MemberLoan }) {
  const stage = STAGE[loan.stage]
  const paidShare = loan.amountCents > 0 ? Math.min(100, Math.round((loan.paidCents / loan.amountCents) * 100)) : 0
  return (
    <section className="space-y-4" aria-labelledby={`loan-${loan.loanId}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={`loan-${loan.loanId}`} className="text-lg font-semibold text-gray-900">Loan {loan.loanId}</h2>
        <Pill tone={stage.tone} dot>{stage.label}</Pill>
        <span className="w-full text-sm text-gray-500 sm:w-auto">
          {fmtDate(loan.loanDate)} · {loan.termMonths} months · interest-free{loan.cosigner ? ` · co-signer ${loan.cosigner}` : ''}
        </span>
      </div>

      {loan.overdue && (
        <div role="alert" className="flex gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-inset ring-red-600/20">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
          <p>
            {loan.overdue.amountCents !== null
              ? <><strong>{usd(loan.overdue.amountCents)}</strong> is late{loan.overdue.daysPastDue ? ` (${loan.overdue.daysPastDue} days)` : ''}. Please pay it as soon as you can, or talk to the Treasurer.</>
              : <>A payment on this loan is late. Please pay it as soon as you can, or talk to the Treasurer.</>}
          </p>
        </div>
      )}

      <div className={cn(surface, 'grid gap-6 p-5 sm:p-6 md:grid-cols-[1.1fr_1fr]')}>
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Still to repay</p>
          <p className="text-4xl font-semibold tracking-tight text-gray-900 tabular-nums">{usd(loan.outstandingCents)}</p>
          {loan.stage !== 'awaiting_payout' && (
            <>
              <Progress value={paidShare} label="Share of the loan repaid" />
              <p className="text-xs text-gray-500">{paidShare}% repaid</p>
            </>
          )}
        </div>
        <dl className="grid grid-cols-2 content-center gap-x-4 gap-y-4 border-t border-gray-100 pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <Figure label="Loan" value={usd(loan.amountCents)} />
          <Figure label="Paid so far" value={usd(loan.paidCents)} strong />
          <Figure label="Monthly payment" value={usd(loan.monthlyDueCents)} />
          {loan.payoffCents !== null
            ? <Figure label="To pay it off today" value={usd(loan.payoffCents)} />
            : <Figure label="Term" value={`${loan.termMonths} months`} />}
        </dl>
      </div>

      {loan.stage === 'repaying' && (
        <div className={cn(surface, 'flex flex-wrap items-center justify-between gap-3 px-5 py-4')}>
          <p className="flex items-center gap-3 text-sm text-gray-700">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-navy/[0.06] text-navy"><CalendarClock size={18} aria-hidden /></span>
            <span>
              {loan.nextDue
                ? <>Next payment: <strong className="tabular-nums">{usd(loan.nextDue.amountCents)}</strong> due <strong>{fmtDate(loan.nextDue.date)}</strong></>
                : 'No payment is due right now.'}
              {loan.feesOutstandingCents > 0 && <> · late fees owed: <strong>{usd(loan.feesOutstandingCents)}</strong></>}
            </span>
          </p>
          <Link href="/portal/pay" className={button.primary}><CreditCard size={16} aria-hidden /> Make a payment</Link>
        </div>
      )}
      {loan.stage === 'awaiting_payout' && (
        <p className="rounded-2xl bg-navy/[0.04] px-4 py-3 text-sm text-navy ring-1 ring-inset ring-navy/10">
          This loan is approved. Once the agreement is signed and the money is paid out, its repayment schedule starts here.
          {' '}<Link href="/portal/agreements" className="font-medium underline underline-offset-2">See the agreement</Link>
        </p>
      )}

      {loan.schedule ? (
        <Panel title="Repayment schedule" icon={ListOrdered} sub="Each payment pays the oldest unpaid month first; the last month absorbs any rounding." flush>
          <ScrollArea label="Repayment schedule">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50/70 text-left text-xs font-medium text-gray-500">
                  <th className="px-5 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Due</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loan.schedule.map((it) => (
                  <tr key={it.number} className={it.status === 'overdue' ? 'bg-red-50/40' : undefined}>
                    <td className="px-5 py-3 text-gray-500">{it.number}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-900">{fmtDate(it.dueDate)}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{usd(it.amount)}</td>
                    <td className="px-3 py-3 text-right text-gray-600">{usd(it.paid)}</td>
                    <td className="px-5 py-3"><Pill tone={INSTALLMENT[it.status].tone}>{INSTALLMENT[it.status].label}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Panel>
      ) : loan.stage !== 'awaiting_payout' && (
        <p className="text-xs text-gray-500">This loan was made before the club kept month-by-month schedules, so only its totals are shown.</p>
      )}

      {loan.payments.length > 0 && (
        <Panel title={`Payments (${loan.payments.length})`} icon={CircleCheck} flush>
          <Rows>
            {loan.payments.map((p) => (
              <Row key={p.paymentId} icon={CircleCheck} tone="green"
                title={fmtDate(p.date)}
                meta={<>{p.method || '—'} · <span className="font-mono">{p.paymentId}</span></>}
                end={<span className="text-sm font-semibold text-gray-900 tabular-nums">{usd(p.amountCents)}</span>}
              />
            ))}
          </Rows>
        </Panel>
      )}
    </section>
  )
}

export default function PortalLoan() {
  const [data, setData] = useState<{ loans: MemberLoan[]; cosigned: CosignedLoan[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/portal/loans')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p role="alert" className="text-sm text-red-700">Your loan could not be loaded. Please reload the page.</p>
  if (!data) return <PageSkeleton />

  const current = data.loans.filter((l) => l.stage === 'repaying' || l.stage === 'awaiting_payout')
  const past = data.loans.filter((l) => l.stage === 'paid_off' || l.stage === 'written_off')

  return (
    <div className="space-y-8">
      <PageHeader title="My Loan" sub="Your loan’s schedule, what you have paid, and what is left." />

      {current.length === 0 && (
        <div className={surface}>
          <Empty icon={Landmark} title="You have no loan at the moment">
            Your dashboard shows whether you can borrow and how much.{' '}
            <Link href="/portal/dashboard" className="inline-flex min-h-6 items-center font-medium text-navy underline underline-offset-2">Go to my dashboard</Link>
          </Empty>
        </div>
      )}
      {current.map((loan) => <LoanCard key={loan.loanId} loan={loan} />)}

      {data.cosigned.length > 0 && (
        <Panel title="Loans you co-sign" icon={Handshake} sub="As co-signer you answer for these loans if the borrower cannot pay." flush>
          <Rows>
            {data.cosigned.map((l) => (
              <Row key={l.loanId} icon={Handshake} tone={l.overdue ? 'red' : 'gray'}
                title={<>{l.loanId} · {l.borrowerName}</>}
                meta={<span className="inline-flex flex-wrap gap-1.5">{l.overdue && <Pill tone="red">Late</Pill>}<Pill tone={STAGE[l.stage].tone}>{STAGE[l.stage].label}</Pill></span>}
                end={<span className="text-sm font-semibold text-gray-900 tabular-nums">{usd(l.outstandingCents)} left</span>}
              />
            ))}
          </Rows>
        </Panel>
      )}

      {past.length > 0 && (
        <details className={cn(surface, 'group')}>
          <summary className="cursor-pointer list-none px-5 py-4 text-[15px] font-semibold text-gray-900 marker:hidden">
            <span className="inline-flex items-center gap-2">Earlier loans ({past.length}) <span className="text-gray-400 transition-transform group-open:rotate-90" aria-hidden>›</span></span>
          </summary>
          <div className="space-y-10 px-5 pb-6">
            {past.map((loan) => <LoanCard key={loan.loanId} loan={loan} />)}
          </div>
        </details>
      )}
    </div>
  )
}
