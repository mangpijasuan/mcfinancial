// The club's records as plain tables, for spreadsheet downloads (CSV) and
// the read-only Google Sheets copy (docs/operations/data-export.md).
//
// Figures are the ones the app shows: member totals and loan balances come
// from the same source as the screens (src/modules/accounting/reads.ts).
// A table is a copy for reading; nothing here ever writes to the records.
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { fromBigInt, toLegacyDollars } from '@/lib/money'
import { withLoanBalances, withMemberFigures } from '@/modules/accounting/reads'
import { EXPORTS, type ExportKey } from './exportTables'

export { EXPORTS, EXPORT_KEYS, isExportKey, type ExportKey } from './exportTables'

type Db = PrismaClient | Prisma.TransactionClient
export type Cell = string | number | null
export type Table = { key: ExportKey; title: string; description: string; headers: string[]; rows: Cell[][] }

/** Calendar dates as YYYY-MM-DD; the time of day is not part of a record's date. */
const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)
/** Dollars rounded to the cent, as numbers a spreadsheet can add up. */
const usd = (n: number): number => Math.round(n * 100) / 100
const cents = (c: bigint | null): number | null => (c === null ? null : toLegacyDollars(fromBigInt(c)))

const table = (key: ExportKey, headers: string[], rows: Cell[][]): Table => ({ key, ...EXPORTS[key], headers, rows })

export async function buildExport(key: ExportKey, db: Db = prisma): Promise<Table> {
  switch (key) {
    case 'members': {
      const members = await withMemberFigures(db as PrismaClient, await db.member.findMany({ orderBy: { id: 'asc' } }))
      return table(key,
        ['Member ID', 'Legal name', 'Nickname', 'Status', 'Joined', 'Phone', 'Email', 'Beneficiary', 'Contributed before 2026', 'Contributed since 2026', 'Contributed in total', 'Months active', 'Loan eligibility', 'Can borrow up to', 'This month'],
        members.map((m) => [m.id, m.legalName, m.nickname, m.status, day(m.joinDate), m.phoneNo, m.email, m.beneficiary,
          usd(m.archiveLifetime), usd(m.contributions2026), usd(m.overallContributions), m.monthsActive, m.eligible, usd(m.maxLoanAmount), m.thisMonth]))
    }
    case 'contributions': {
      const rows = await db.contribution.findMany({ orderBy: [{ paymentDate: 'asc' }, { transactionId: 'asc' }] })
      return table(key,
        ['Transaction ID', 'Receipt', 'Member ID', 'Member name', 'Paid on', 'Amount', 'Method', 'Covers', 'Kind', 'Received by', 'Source', 'Reversed on', 'Reversal reason'],
        rows.map((c) => [c.transactionId, c.receiptNumber, c.memberId, c.memberName, day(c.paymentDate), cents(c.amountCents), c.paymentMethod,
          c.receiptCovers ?? c.monthYear, c.category, c.receivedBy, c.source, day(c.reversedAt), c.reversalReason]))
    }
    case 'loans': {
      const loans = await withLoanBalances(db as PrismaClient, await db.loan.findMany({ orderBy: [{ loanDate: 'asc' }, { loanId: 'asc' }] }))
      return table(key,
        ['Loan ID', 'Borrower ID', 'Borrower', 'Co-signer ID', 'Co-signer', 'Loan date', 'Amount', 'Term (months)', 'Monthly payment', 'Paid', 'Balance', 'Status', 'Stage', 'Next due', 'Last payment due', 'Overdue', 'Days past due'],
        loans.map((l) => [l.loanId, l.borrowerId, l.borrowerName, l.cosignerId, l.cosignerName, day(l.loanDate), usd(l.loanAmount), l.termMonths,
          usd(l.monthlyDue), usd(l.totalPaid), usd(l.balanceRemaining), l.status, l.lifecycle, day(l.nextDueDate), day(l.endDate), l.overdue ? 'Yes' : 'No', l.daysPastDue]))
    }
    case 'repayments': {
      const rows = await db.loanPayment.findMany({ orderBy: [{ paymentDate: 'asc' }, { eventSeq: 'asc' }] })
      return table(key,
        ['Payment ID', 'Loan ID', 'Borrower ID', 'Borrower', 'Paid on', 'Amount', 'Method', 'Received by', 'Source'],
        rows.map((p) => [p.paymentId, p.loanId, p.borrowerId, p.borrowerName, day(p.paymentDate), usd(p.amount), p.paymentMethod, p.receivedBy, p.source]))
    }
    case 'older_loans': {
      const rows = await db.historicalLoan.findMany({ orderBy: [{ year: 'asc' }, { loanId: 'asc' }] })
      return table(key,
        ['Loan ID', 'Year', 'Borrower ID', 'Borrower', 'Co-signer ID', 'Co-signer', 'Loan date', 'Amount', 'Paid', 'Balance', 'Status', 'Confirmed balance', 'Confirmed as of', 'Now live loan'],
        rows.map((h) => [h.loanId, h.year, h.borrowerId, h.borrowerName, h.cosignerId, h.cosignerName, day(h.loanDate), usd(h.loanAmount), usd(h.totalPaid),
          usd(h.balanceRemaining), h.status, cents(h.confirmedBalanceCents), day(h.balanceAsOf), h.importedLoanId]))
    }
    case 'withdrawals': {
      const rows = await db.withdrawal.findMany({ orderBy: [{ withdrawalDate: 'asc' }, { withdrawalId: 'asc' }] })
      return table(key,
        ['Withdrawal ID', 'Member ID', 'Member name', 'Date', 'Amount', 'Type', 'Reason', 'Processed by'],
        rows.map((w) => [w.withdrawalId, w.memberId, w.memberName, day(w.withdrawalDate), usd(w.amount), w.type, w.reason, w.processedBy]))
    }
    case 'ledger': {
      const lines = await db.journalLine.findMany({
        include: { entry: { select: { entryNumber: true, effectiveDate: true, type: true, description: true, reference: true } }, account: { select: { name: true } } },
        orderBy: [{ entry: { effectiveDate: 'asc' } }, { entry: { entryNumber: 'asc' } }, { lineNo: 'asc' }],
      })
      return table(key,
        ['Date', 'Entry', 'Type', 'Description', 'Reference', 'Line', 'Account', 'Account name', 'Member ID', 'Loan ID', 'Debit', 'Credit', 'Memo'],
        lines.map((l) => [day(l.entry.effectiveDate), l.entry.entryNumber, l.entry.type, l.entry.description, l.entry.reference, l.lineNo, l.accountCode, l.account.name,
          l.memberId, l.loanId, cents(l.debitCents), cents(l.creditCents), l.memo]))
    }
  }
}

/**
 * CSV for Excel, Numbers and Google Sheets. A text cell that starts like a
 * formula (= + - @, tab, return) gets a leading apostrophe, so a name typed
 * as "=HYPERLINK(...)" is shown as text and never runs as a formula.
 */
export function toCsv(t: Pick<Table, 'headers' | 'rows'>): string {
  const cell = (v: Cell) => {
    if (v === null) return ''
    if (typeof v === 'number') return String(v)
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  // A byte-order mark so Excel reads the accents in names correctly.
  return '\uFEFF' + [t.headers, ...t.rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
