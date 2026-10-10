'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarCheck, CircleCheck, Coins, CreditCard, FileText, HandCoins, Landmark, Receipt, Undo2, Wallet } from 'lucide-react'
import { eligibilityText, fmt$, fmtDate } from '@/lib/utils'
import { formatUSD } from '@/lib/money'
import { periodLabel } from '@/modules/contributions/dues'
import type { DuesData } from '@/components/contributions/DuesPanel'
import { Empty, PageSkeleton, Panel, Pill, Progress, Row, Rows, Stat, button, surface, type Tone } from '@/components/portal/kit'
import { cn } from '@/lib/utils'

const DUES_STATUS: Record<string, { tone: Tone; label: string }> = {
  paid: { tone: 'green', label: 'Paid' },
  partly_paid: { tone: 'amber', label: 'Part paid' },
  overdue: { tone: 'red', label: 'Unpaid' },
  due: { tone: 'gray', label: 'Due' },
  upcoming: { tone: 'gray', label: 'Upcoming' },
}

function DuesLine({ d }: { d: DuesData }) {
  if (d.overdueMonths > 0) {
    return <p className="text-sm text-red-800"><strong>{formatUSD(d.arrearsCents)}</strong> unpaid for {d.overdueMonths} past {d.overdueMonths === 1 ? 'month' : 'months'}.</p>
  }
  if (d.coveredThrough && d.coveredThrough >= d.currentPeriod) {
    return <p className="text-sm text-emerald-800">Paid through <strong>{periodLabel(d.coveredThrough)}</strong>{d.creditCents > 0 ? ` · ${formatUSD(d.creditCents)} credit` : ''}.</p>
  }
  return <p className="text-sm text-gray-700">{periodLabel(d.currentPeriod)} is due.</p>
}

export default function PortalDashboard() {
  const [member, setMember] = useState<any>(null)
  const [dues, setDues] = useState<DuesData | null>(null)

  useEffect(() => {
    fetch('/api/portal/me').then(r => r.json()).then(setMember)
    fetch('/api/portal/dues').then(r => (r.ok ? r.json() : null)).then(setDues).catch(() => setDues(null))
  }, [])

  if (!member) return <PageSkeleton />

  const activeLoan = member.loansAsBorrower?.[0]
  const hasLoan = activeLoan && activeLoan.status === 'Active'
  const eligible = member.eligible === 'YES'
  const paidThisMonth = member.thisMonth === 'PAID'
  const lifetime = member.archiveLifetime + member.contributions2026
  // Join dates are stored as midnight UTC: read the year in UTC, or it slips back a year west of London.
  const joinYear = new Date(member.joinDate).getUTCFullYear()
  const repaid = hasLoan && activeLoan.loanAmount > 0 ? (activeLoan.totalPaid / activeLoan.loanAmount) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Who, where they stand, and what to do next. */}
      <section className="relative overflow-hidden rounded-3xl bg-navy bg-[radial-gradient(130%_140%_at_100%_0%,#2f4778_0%,#1b2a4a_55%,#15213b_100%)] p-6 text-white shadow-lg shadow-navy/20 sm:p-8">
        {/* A thin gold line along the top: the club's colours, decoration only. */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-gold via-gold/60 to-transparent" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-sm text-white/80">Welcome back</p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{member.legalName}</h1>
              <p className="mt-1 text-sm text-white/80">
                {member.id}{member.nickname && ` · “${member.nickname}”`} · Member since {fmtDate(member.joinDate)}
              </p>
            </div>
            <span className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset',
              paidThisMonth ? 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30' : 'bg-gold/15 text-amber-100 ring-gold/40',
            )}>
              <span className={cn('size-2 rounded-full', paidThisMonth ? 'bg-emerald-300' : 'bg-gold')} aria-hidden />
              {paidThisMonth ? 'Paid this month' : 'This month not paid yet'}
            </span>
          </div>
          <div className="md:text-right">
            <p className="text-sm text-white/80">Total contributed</p>
            <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{fmt$(lifetime)}</p>
            <div className="mt-4 flex flex-wrap gap-2 md:justify-end">
              <Link href="/portal/pay" className={button.gold}><CreditCard size={16} aria-hidden /> Make a payment</Link>
              <Link href="/portal/statements" className={button.ghostDark}><FileText size={16} aria-hidden /> Statements</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        <Stat icon={CalendarCheck} label="Months active" value={member.monthsActive} hint={`Since ${joinYear}`} />
        <Stat icon={Coins} label="Paid this year" value={fmt$(member.contributions2026)} hint="Contributions in 2026" />
        <div className="col-span-2 md:col-span-1">
          {/* The full reason, in plain words, when the member cannot borrow now. */}
          <Stat icon={HandCoins} label="Borrowing"
            value={eligible ? `Up to ${fmt$(member.maxLoanAmount)}` : 'Not now'}
            hint={eligible ? 'Interest-free. Contact your club admin to apply.' : eligibilityText(member.eligible)} />
        </div>
      </div>

      {dues && dues.obligations.length > 0 && (
        <Panel title="Monthly dues" icon={Wallet}
          sub={dues.monthlyCents !== null ? `${formatUSD(dues.monthlyCents)} a month` : undefined}
          action={<Link href="/portal/history" className={button.link}>Receipts <ArrowRight size={14} aria-hidden /></Link>}>
          <div className="space-y-4">
            <DuesLine d={dues} />
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {dues.obligations.slice(0, 6).map((o) => {
                const s = DUES_STATUS[o.status] ?? DUES_STATUS.due
                return (
                  <li key={o.period} className="rounded-xl bg-gray-50 px-2 py-3 text-center ring-1 ring-inset ring-gray-900/5">
                    <p className="text-xs font-medium text-gray-500">{periodLabel(o.period)}</p>
                    <p className="my-1 text-sm font-semibold text-gray-900 tabular-nums">{formatUSD(o.amountCents)}</p>
                    <Pill tone={s.tone}>{s.label}</Pill>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-gray-500">Each payment counts towards your oldest unpaid month first; anything extra covers the months ahead.</p>
          </div>
        </Panel>
      )}

      <Panel title="Your loan" icon={Landmark}
        action={hasLoan && activeLoan.overdue ? <Pill tone="red" dot>Overdue</Pill> : hasLoan ? <Pill tone="blue" dot>Being repaid</Pill> : undefined}>
        {hasLoan ? (
          <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
            <div className="space-y-3">
              <p className="font-mono text-xs text-gray-500">{activeLoan.loanId}</p>
              <div>
                <p className="text-3xl font-semibold tracking-tight text-gray-900 tabular-nums">{fmt$(activeLoan.balanceRemaining)}</p>
                <p className="text-sm text-gray-500">left to repay of {fmt$(activeLoan.loanAmount)}</p>
              </div>
              <Progress value={repaid} label="Share of the loan repaid" />
              <Link href="/portal/loan" className={button.link}>See the schedule and payoff →</Link>
            </div>
            <dl className="grid grid-cols-2 content-center gap-x-4 gap-y-4 border-t border-gray-100 pt-5 text-sm md:border-l md:border-t-0 md:pl-6 md:pt-0">
              <div><dt className="text-xs text-gray-500">Monthly payment</dt><dd className="font-semibold text-gray-900 tabular-nums">{fmt$(activeLoan.monthlyDue)}</dd></div>
              <div><dt className="text-xs text-gray-500">Next payment</dt><dd className="font-semibold text-gray-900">{fmtDate(activeLoan.nextDueDate)}</dd></div>
              <div><dt className="text-xs text-gray-500">Paid so far</dt><dd className="font-semibold text-emerald-700 tabular-nums">{fmt$(activeLoan.totalPaid)}</dd></div>
              <div><dt className="text-xs text-gray-500">Last payment due</dt><dd className="font-semibold text-gray-900">{fmtDate(activeLoan.endDate)}</dd></div>
            </dl>
          </div>
        ) : (
          <Empty icon={Landmark} title="No loan being repaid">
            {eligible ? <>You can borrow up to <strong className="text-gray-900">{fmt$(member.maxLoanAmount)}</strong>, interest-free.</> : 'Your borrowing status is shown above.'}
          </Empty>
        )}
      </Panel>

      <section className={cn(surface, 'overflow-hidden')} aria-labelledby="recent">
        <div className="px-5 pt-5 pb-3">
          <h2 id="recent" className="text-[15px] font-semibold text-gray-900">Recent contributions</h2>
        </div>
        {member.contributions?.length === 0 ? (
          <div className="border-t border-gray-100"><Empty icon={Receipt} title="No contributions recorded yet" /></div>
        ) : (
          <Rows>
            {member.contributions?.map((c: any) => (
              <Row key={c.id}
                icon={c.reversedAt ? Undo2 : CircleCheck} tone={c.reversedAt ? 'gray' : 'green'}
                title={c.reversedAt ? 'Reversed' : c.category === 'voluntary' ? 'Voluntary contribution' : (c.receiptCovers || c.monthYear)}
                meta={<>Paid {fmtDate(c.paymentDate)} · {c.paymentMethod || '—'}
                  {c.receiptNumber && <> · <Link className="font-medium text-navy underline underline-offset-2" href={`/portal/receipts/${c.transactionId}`}>Receipt</Link></>}</>}
                end={<span className={cn('text-sm font-semibold tabular-nums', c.reversedAt ? 'text-gray-400 line-through' : 'text-gray-900')}>{fmt$(c.amount)}</span>}
              />
            ))}
          </Rows>
        )}
        <div className="border-t border-gray-100 px-5 py-3">
          <Link href="/portal/history" className={button.link}>View full payment history →</Link>
        </div>
      </section>
    </div>
  )
}
