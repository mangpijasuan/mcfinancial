// Member statements (product map: Finance → Statements): a member's
// accounts in the ledger for a month or a year — the balance at the start,
// every movement, and the balance at the end.
//
// A statement is built only from posted entries, so regenerating it later
// gives the same result. Once its months are closed (month-end close),
// nothing can be posted into them and the statement is final; until then
// it is provisional. Statements start at the cutover: before it, the
// ledger holds one opening entry per member and the yearly totals stand in
// for the detail.
import type { Prisma } from '@prisma/client'
import { type Cents, ZERO, add, fromBigInt, subtract } from '@/lib/money'
import { type IsoDate, dateOnly, isoDateOf } from '@/lib/dates'
import { ledgerOpening } from './autoPost'
import { periodEnd } from './reconciliation'

type Db = Pick<Prisma.TransactionClient, 'journalEntry' | 'journalLine' | 'loan' | 'ledgerPeriod' | 'member'>

export type StatementPeriod = { period: string; kind: 'month' | 'year'; label: string; final: boolean }

export type StatementLine = { date: IsoDate; entryNumber: string; description: string; amountCents: Cents }

export type StatementSection = {
  key: 'capital' | 'loan' | 'fees' | 'held' | 'payable'
  title: string
  /** What a rising balance means for the member, in words for the page. */
  note: string
  loanId: string | null
  openingCents: Cents
  closingCents: Cents
  lines: StatementLine[]
}

export type Statement = {
  memberId: string
  memberName: string
  period: string
  label: string
  from: IsoDate
  to: IsoDate
  final: boolean
  sections: StatementSection[]
}

// The member's own accounts, in the order a statement shows them. The sign
// turns debits and credits into "up" and "down" for that account.
const MEMBER_ACCOUNTS = [
  { code: '2000', key: 'capital', title: 'Your capital', note: 'What you have put into the club, less withdrawals.', sign: 'credit' },
  { code: '1110', key: 'fees', title: 'Fees you owe', note: 'Late fees charged and not yet paid.', sign: 'debit' },
  { code: '2100', key: 'held', title: 'Payments held for you', note: 'Money you paid that is not yet applied, such as a loan overpayment.', sign: 'credit' },
  { code: '2200', key: 'payable', title: 'Withdrawals to be paid to you', note: 'Approved withdrawals the club has not paid out yet.', sign: 'credit' },
] as const
const LOANS = { code: '1100', sign: 'debit' } as const

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`

/** Months and years a statement can cover, newest first; null before opening balances are posted. */
export async function statementPeriods(db: Db, today: IsoDate): Promise<StatementPeriod[] | null> {
  const opening = await ledgerOpening(db)
  if (!opening) return null
  const first = opening.cutover.slice(0, 7)
  const current = today.slice(0, 7)
  const closed = new Set((await db.ledgerPeriod.findMany({ where: { status: 'closed' }, select: { period: true } })).map((p) => p.period))

  const months: string[] = []
  for (let p = first; p <= current; p = nextMonth(p)) months.push(p)
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]
  const yearFinal = (y: string) => y < current.slice(0, 4) && months.filter((m) => m.startsWith(y)).every((m) => closed.has(m))
  return [
    ...months.reverse().map((m): StatementPeriod => ({ period: m, kind: 'month', label: monthLabel(m), final: closed.has(m) })),
    ...years.reverse().map((y): StatementPeriod => ({ period: y, kind: 'year', label: `Year ${y}${y === current.slice(0, 4) ? ' (to date)' : ''}`, final: yearFinal(y) })),
  ]
}

function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}

/**
 * The member's statement for `period` ("2026-09" or "2026"); null when the
 * member does not exist or the period is not one statementPeriods offers.
 */
export async function memberStatement(db: Db, memberId: string, period: string, today: IsoDate): Promise<Statement | null> {
  const offered = (await statementPeriods(db, today))?.find((p) => p.period === period)
  const member = await db.member.findUnique({ where: { id: memberId }, select: { legalName: true } })
  if (!offered || !member) return null
  const from: IsoDate = offered.kind === 'month' ? `${period}-01` : `${period}-01-01`
  const end: IsoDate = offered.kind === 'month' ? periodEnd(period) : `${period}-12-31`
  // A period still running ends today.
  const to: IsoDate = end < today ? end : today

  const loanIds = (await db.loan.findMany({ where: { borrowerId: memberId }, select: { loanId: true } })).map((l) => l.loanId)
  const lines = await db.journalLine.findMany({
    where: {
      entry: { effectiveDate: { lte: dateOnly(to) } },
      OR: [
        { memberId, accountCode: { in: MEMBER_ACCOUNTS.map((a) => a.code) } },
        { accountCode: LOANS.code, loanId: { in: loanIds } },
      ],
    },
    select: { accountCode: true, loanId: true, debitCents: true, creditCents: true, entry: { select: { effectiveDate: true, entryNumber: true, description: true } } },
    orderBy: [{ entry: { effectiveDate: 'asc' } }, { entry: { entryNumber: 'asc' } }, { lineNo: 'asc' }],
  })

  const build = (key: StatementSection['key'], title: string, note: string, loanId: string | null, sign: 'debit' | 'credit', rows: typeof lines): StatementSection => {
    let opening = ZERO
    const byEntry = new Map<string, StatementLine>()
    for (const row of rows) {
      const debit = fromBigInt(row.debitCents)
      const credit = fromBigInt(row.creditCents)
      const amount = sign === 'debit' ? subtract(debit, credit) : subtract(credit, debit)
      const date = isoDateOf(row.entry.effectiveDate)
      if (date < from) { opening = add(opening, amount); continue }
      // Lines of one entry on one account show as one movement.
      const seen = byEntry.get(row.entry.entryNumber)
      byEntry.set(row.entry.entryNumber, seen
        ? { ...seen, amountCents: add(seen.amountCents, amount) }
        : { date, entryNumber: row.entry.entryNumber, description: row.entry.description, amountCents: amount })
    }
    const movements = [...byEntry.values()]
    const closing = movements.reduce((sum, l) => add(sum, l.amountCents), opening)
    return { key, title, note, loanId, openingCents: opening, closingCents: closing, lines: movements }
  }

  const sections: StatementSection[] = []
  const [capital, ...rest] = MEMBER_ACCOUNTS
  sections.push(build(capital.key, capital.title, capital.note, null, capital.sign, lines.filter((l) => l.accountCode === capital.code)))
  for (const loanId of [...new Set(lines.filter((l) => l.accountCode === LOANS.code).map((l) => l.loanId!))].sort()) {
    sections.push(build('loan', `Loan ${loanId}`, 'What you still owe on this loan.', loanId, LOANS.sign, lines.filter((l) => l.accountCode === LOANS.code && l.loanId === loanId)))
  }
  for (const account of rest) {
    sections.push(build(account.key, account.title, account.note, null, account.sign, lines.filter((l) => l.accountCode === account.code)))
  }

  return {
    memberId, memberName: member.legalName, period, label: offered.label, from, to, final: offered.final,
    // A section with nothing in it is left out, except the member's capital.
    sections: sections.filter((s) => s.key === 'capital' || s.lines.length > 0 || s.openingCents !== ZERO || s.closingCents !== ZERO),
  }
}
