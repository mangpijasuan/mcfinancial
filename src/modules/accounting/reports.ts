// Financial reports from the ledger (product map: Admin → Reports): the
// balance sheet and the loan portfolio as of a date, the income statement
// and cash flow for a date range. Each is a query over posted entries, so
// any past date gives the same answer every time, and once its months are
// closed it can no longer change. The trial balance is on the Ledger page.
import type { Prisma } from '@prisma/client'
import { type Cents, ZERO, add, fromBigInt, negate, subtract, sum } from '@/lib/money'
import { type IsoDate, dateOnly, isIsoDate, isoDateOf } from '@/lib/dates'
import { LOAN_WITH_HISTORY, type LoanWithHistory, loanState } from '@/modules/loans/state'
import { trialBalance } from './ledger'

type Db = Prisma.TransactionClient

export type ReportLine = { code: string; name: string; amountCents: Cents }

const byDate = (from: IsoDate | null, to: IsoDate) => ({ effectiveDate: { ...(from ? { gte: dateOnly(from) } : {}), lte: dateOnly(to) } })

// ── Dates ──────────────────────────────────────────────────────────────

/** The date a report is as of: `asOf` if given, else today. Null when it is not a date. */
export function reportDate(asOf: string | null, today: IsoDate): IsoDate | null {
  if (!asOf) return today
  return isIsoDate(asOf) ? asOf : null
}

/** A date range: `from`–`to`, by default the year to date. Null when not dates or the wrong way round. */
export function reportRange(from: string | null, to: string | null, today: IsoDate): { from: IsoDate; to: IsoDate } | null {
  const end = reportDate(to, today)
  if (!end) return null
  const start = from ? reportDate(from, today) : `${end.slice(0, 4)}-01-01`
  if (!start || start > end) return null
  return { from: start, to: end }
}

// ── Balance sheet ──────────────────────────────────────────────────────

export type BalanceSheet = {
  asOf: IsoDate
  assets: ReportLine[]
  liabilities: ReportLine[]
  equity: ReportLine[]
  totalAssetsCents: Cents
  totalLiabilitiesCents: Cents
  totalEquityCents: Cents
  /** Assets equal liabilities plus equity: always so while the ledger balances. */
  balanced: boolean
}

export async function balanceSheet(db: Db, asOf: IsoDate): Promise<BalanceSheet> {
  const tb = await trialBalance(db, asOf)
  const lines = (types: string[]) => tb.rows
    .filter((r) => types.includes(r.type) && r.balance !== ZERO)
    // An allowance (contra-asset) reduces the assets it sits under.
    .map((r): ReportLine => ({ code: r.code, name: r.name, amountCents: r.type === 'contra_asset' ? negate(r.balance) : r.balance }))
  const total = (rows: ReportLine[]) => sum(rows.map((r) => r.amountCents))

  const assets = lines(['asset', 'contra_asset'])
  const liabilities = lines(['liability'])
  // Income less expenses is the club's surplus until it is transferred to
  // 3000 at year end, so it is shown with equity.
  const surplus = subtract(total(lines(['income'])), total(lines(['expense'])))
  const equity = [...lines(['equity']), ...(surplus !== ZERO ? [{ code: '', name: 'Surplus to date (income less expenses)', amountCents: surplus }] : [])]
  const totalAssetsCents = total(assets)
  const totalLiabilitiesCents = total(liabilities)
  const totalEquityCents = total(equity)
  return {
    asOf, assets, liabilities, equity, totalAssetsCents, totalLiabilitiesCents, totalEquityCents,
    balanced: totalAssetsCents === add(totalLiabilitiesCents, totalEquityCents),
  }
}

// ── Income statement ───────────────────────────────────────────────────

export type IncomeStatement = {
  from: IsoDate
  to: IsoDate
  income: ReportLine[]
  expenses: ReportLine[]
  totalIncomeCents: Cents
  totalExpensesCents: Cents
  /** Income less expenses; negative is a deficit. */
  surplusCents: Cents
}

export async function incomeStatement(db: Db, from: IsoDate, to: IsoDate): Promise<IncomeStatement> {
  const accounts = await db.ledgerAccount.findMany({ where: { type: { in: ['income', 'expense'] } }, orderBy: { code: 'asc' } })
  const sums = await db.journalLine.groupBy({
    by: ['accountCode'],
    where: { accountCode: { in: accounts.map((a) => a.code) }, entry: byDate(from, to) },
    _sum: { debitCents: true, creditCents: true },
  })
  const amount = new Map(sums.map((s) => [s.accountCode, subtract(fromBigInt(s._sum.debitCents!), fromBigInt(s._sum.creditCents!))]))
  const lines = (type: string, sign: 1 | -1) => accounts
    .filter((a) => a.type === type && amount.has(a.code))
    .map((a): ReportLine => ({ code: a.code, name: a.name, amountCents: sign === 1 ? amount.get(a.code)! : negate(amount.get(a.code)!) }))
  const income = lines('income', -1)
  const expenses = lines('expense', 1)
  const totalIncomeCents = sum(income.map((l) => l.amountCents))
  const totalExpensesCents = sum(expenses.map((l) => l.amountCents))
  return { from, to, income, expenses, totalIncomeCents, totalExpensesCents, surplusCents: subtract(totalIncomeCents, totalExpensesCents) }
}

// ── Cash flow ──────────────────────────────────────────────────────────

/** The bank and the clearing accounts money passes through on its way there. */
export const CASH_ACCOUNTS = ['1000', '1010', '1020', '1030'] as const

const FLOW_LABELS: Record<string, string> = {
  opening_balance: 'Opening balances (cutover)',
  contribution: 'Contributions received',
  loan_repayment: 'Loan repayments received',
  loan_disbursement: 'Loans paid out',
  withdrawal: 'Withdrawals paid to members',
  expense: 'Expenses paid',
  reversal: 'Reversals',
}

export type CashFlowRow = { type: string; label: string; entries: number; inflowCents: Cents; outflowCents: Cents; netCents: Cents }

export type CashFlow = {
  from: IsoDate
  to: IsoDate
  openingCents: Cents
  rows: CashFlowRow[]
  netCents: Cents
  closingCents: Cents
  /** Each cash account at the start and end. */
  accounts: { code: string; name: string; openingCents: Cents; closingCents: Cents }[]
  /** Entries that only moved money between the club's own accounts (a deposit, a Stripe payout). */
  internalMoves: number
}

export async function cashFlow(db: Db, from: IsoDate, to: IsoDate): Promise<CashFlow> {
  const codes = [...CASH_ACCOUNTS]
  const accounts = await db.ledgerAccount.findMany({ where: { code: { in: codes } }, orderBy: { code: 'asc' } })
  const balances = async (where: Prisma.JournalEntryWhereInput) => new Map((await db.journalLine.groupBy({
    by: ['accountCode'], where: { accountCode: { in: codes }, entry: where }, _sum: { debitCents: true, creditCents: true },
  })).map((s) => [s.accountCode, subtract(fromBigInt(s._sum.debitCents!), fromBigInt(s._sum.creditCents!))]))
  const before = await balances({ effectiveDate: { lt: dateOnly(from) } })
  const after = await balances(byDate(null, to))

  // The net cash effect of each entry in the range, grouped by what it was.
  const lines = await db.journalLine.findMany({
    where: { accountCode: { in: codes }, entry: byDate(from, to) },
    select: { entryId: true, debitCents: true, creditCents: true, entry: { select: { type: true } } },
  })
  const perEntry = new Map<string, { type: string; net: Cents }>()
  for (const l of lines) {
    const seen = perEntry.get(l.entryId) ?? { type: l.entry.type, net: ZERO }
    perEntry.set(l.entryId, { ...seen, net: add(seen.net, subtract(fromBigInt(l.debitCents), fromBigInt(l.creditCents))) })
  }
  const rows = new Map<string, CashFlowRow>()
  let internalMoves = 0
  for (const { type, net } of perEntry.values()) {
    if (net === ZERO) { internalMoves++; continue }
    const row = rows.get(type) ?? { type, label: FLOW_LABELS[type] ?? `Other (${type.replace(/_/g, ' ')})`, entries: 0, inflowCents: ZERO, outflowCents: ZERO, netCents: ZERO }
    rows.set(type, {
      ...row, entries: row.entries + 1, netCents: add(row.netCents, net),
      ...(net > 0 ? { inflowCents: add(row.inflowCents, net) } : { outflowCents: add(row.outflowCents, negate(net)) }),
    })
  }
  const order = Object.keys(FLOW_LABELS)
  const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : order.length)
  const total = (m: Map<string, Cents>) => sum([...m.values()])
  const openingCents = total(before)
  const sorted = [...rows.values()].sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type))
  return {
    from, to, openingCents, rows: sorted,
    netCents: sum(sorted.map((r) => r.netCents)),
    closingCents: total(after),
    accounts: accounts.map((a) => ({ code: a.code, name: a.name, openingCents: before.get(a.code) ?? ZERO, closingCents: after.get(a.code) ?? ZERO })),
    internalMoves,
  }
}

// ── Loan portfolio and aging ───────────────────────────────────────────

export const AGING_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30 days late' },
  { key: 'd31_60', label: '31–60 days late' },
  { key: 'd61_90', label: '61–90 days late' },
  { key: 'd90_plus', label: 'Over 90 days late' },
] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]['key']

export type PortfolioLoan = {
  loanId: string
  borrowerId: string
  borrowerName: string
  loanDate: IsoDate
  /** Principal still owed, from the ledger. */
  outstandingCents: Cents
  /** Days since the oldest unpaid installment fell due. */
  daysPastDue: number
  /** Installments due and unpaid. */
  overdueCents: Cents
  bucket: AgingBucket
}

export type LoanPortfolio = {
  asOf: IsoDate
  loans: PortfolioLoan[]
  buckets: { key: AgingBucket; label: string; count: number; outstandingCents: Cents }[]
  /** Equals Loans receivable (1100) on the balance sheet for the same date. */
  totalOutstandingCents: Cents
}

function bucketOf(daysPastDue: number): AgingBucket {
  if (daysPastDue === 0) return 'current'
  if (daysPastDue <= 30) return 'd1_30'
  if (daysPastDue <= 60) return 'd31_60'
  return daysPastDue <= 90 ? 'd61_90' : 'd90_plus'
}

/** The loan as it stood on `asOf`: only what had been paid, charged or waived by then. */
function loanAsOf(loan: LoanWithHistory, asOf: IsoDate): LoanWithHistory {
  return {
    ...loan,
    payments: loan.payments.filter((p) => isoDateOf(p.paymentDate) <= asOf),
    fees: loan.fees
      .filter((f) => isoDateOf(f.assessedOn) <= asOf)
      .map((f) => (f.waivedOn && isoDateOf(f.waivedOn) > asOf ? { ...f, waiverSeq: null } : f)),
  }
}

export async function loanPortfolio(db: Db, asOf: IsoDate): Promise<LoanPortfolio> {
  const owed = await db.journalLine.groupBy({
    by: ['loanId'], where: { accountCode: '1100', entry: byDate(null, asOf) }, _sum: { debitCents: true, creditCents: true },
  })
  // The database requires a loan on every line of this account.
  const outstanding = new Map(owed
    .map((s) => [s.loanId!, subtract(fromBigInt(s._sum.debitCents!), fromBigInt(s._sum.creditCents!))] as const)
    .filter(([, amount]) => amount !== ZERO))
  const rows = await db.loan.findMany({ where: { loanId: { in: [...outstanding.keys()] } }, include: LOAN_WITH_HISTORY })
  const byId = new Map(rows.map((l) => [l.loanId, l]))

  // Every loan the ledger carries has a schedule: opening balances moved
  // the older loans onto the loan engine.
  const loans = [...outstanding].map(([loanId, outstandingCents]): PortfolioLoan => {
    const loan = byId.get(loanId)!
    const { daysPastDue, overdueAmount } = loanState(loanAsOf(loan, asOf), asOf).delinquency
    return {
      loanId, borrowerId: loan.borrowerId, borrowerName: loan.borrowerName, loanDate: isoDateOf(loan.loanDate),
      outstandingCents, daysPastDue, overdueCents: overdueAmount, bucket: bucketOf(daysPastDue),
    }
  })
  // The loans needing attention lead the list: the latest first.
  loans.sort((a, b) => b.daysPastDue - a.daysPastDue || a.loanId.localeCompare(b.loanId))

  return {
    asOf, loans,
    buckets: AGING_BUCKETS.map(({ key, label }) => {
      const inBucket = loans.filter((l) => l.bucket === key)
      return { key, label, count: inBucket.length, outstandingCents: sum(inBucket.map((l) => l.outstandingCents)) }
    }),
    totalOutstandingCents: sum(loans.map((l) => l.outstandingCents)),
  }
}
