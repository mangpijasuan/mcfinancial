// The monthly contributions report (docs/operations/monthly-report.md):
// every member with what they paid in the month, the month's totals, and
// the loan repayments received. Downloaded as PDF (./monthlyReportPdf) or
// CSV from the Contributions page.
//
// A payment belongs to the month it was received in (its payment date, in
// the club's time zone), so the report adds up to the money that came in.
// Reversed contributions are left out. Members listed: everyone active,
// and anyone else who paid in the month.
import type { Prisma } from '@prisma/client'
import { type Cents, ZERO, fromBigInt, sum } from '@/lib/money'
import { isoDateOf, todayIso } from '@/lib/dates'
import { legacyCents } from '@/modules/accounting/legacyActivity'
import { BROUGHT_FORWARD_METHOD } from '@/modules/loans/history'

type Db = Prisma.TransactionClient

export type ReportPayment = { date: string; amountCents: Cents; method: string | null; receivedBy: string | null; covers: string | null; note: string | null; receipt: string | null; voluntary: boolean }

export type ReportMember = {
  memberId: string
  name: string
  nickname: string | null
  joined: string
  status: string
  paidCents: Cents
  payments: ReportPayment[]
}

export type ReportRepayment = { loanId: string; borrower: string; memberId: string; date: string; amountCents: Cents; method: string | null; receivedBy: string | null }

export type MonthlyReport = {
  /** YYYY-MM */
  month: string
  /** "October 2026" */
  label: string
  generatedOn: string
  members: ReportMember[]
  repayments: ReportRepayment[]
  totals: {
    activeMembers: number
    paidMembers: number
    unpaidMembers: number
    collectedCents: Cents
    duesCents: Cents
    voluntaryCents: Cents
    payments: number
    repaymentsCents: Cents
    /** By payment method, largest first; "Not given" for payments without one. */
    byMethod: { method: string; cents: Cents; count: number }[]
  }
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/** A YYYY-MM month that has started, or null. */
export function reportMonth(value: string | null, today: string): string | null {
  const month = value ?? today.slice(0, 7)
  return MONTH.test(month) && month <= today.slice(0, 7) ? month : null
}

export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))

/** The month's first day, and the next month's, as dates to query between (a day either side for time zones). */
function queryRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  return { gte: new Date(Date.UTC(y, m - 1, 0)), lt: new Date(Date.UTC(y, m, 2)) }
}

export async function buildMonthlyReport(db: Db, month: string, now: Date = new Date()): Promise<MonthlyReport> {
  const range = queryRange(month)
  const inMonth = (d: Date) => isoDateOf(d).startsWith(month)
  const [members, contributions, loanPayments] = await Promise.all([
    db.member.findMany({ select: { id: true, legalName: true, nickname: true, joinDate: true, status: true } }),
    db.contribution.findMany({ where: { reversedAt: null, paymentDate: range }, orderBy: [{ paymentDate: 'asc' }, { entryTimestamp: 'asc' }] }),
    db.loanPayment.findMany({ where: { paymentDate: range }, orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }] }),
  ])

  const paid = new Map<string, ReportPayment[]>()
  for (const c of contributions.filter((x) => inMonth(x.paymentDate))) {
    const list = paid.get(c.memberId) ?? []
    list.push({
      date: isoDateOf(c.paymentDate), amountCents: fromBigInt(c.amountCents), method: c.paymentMethod, receivedBy: c.receivedBy,
      covers: c.receiptCovers, note: c.comments, receipt: c.receiptNumber, voluntary: c.category === 'voluntary',
    })
    paid.set(c.memberId, list)
  }

  const rows: ReportMember[] = members
    .filter((m) => m.status === 'Active' || paid.has(m.id))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map((m) => {
      const payments = paid.get(m.id) ?? []
      return {
        memberId: m.id, name: m.legalName, nickname: m.nickname, joined: isoDateOf(m.joinDate), status: m.status,
        paidCents: sum(payments.map((p) => p.amountCents)), payments,
      }
    })

  const borrowers = new Map(members.map((m) => [m.id, m.legalName]))
  const repayments: ReportRepayment[] = loanPayments
    .filter((p) => inMonth(p.paymentDate) && p.paymentMethod !== BROUGHT_FORWARD_METHOD)
    .map((p) => ({
      loanId: p.loanId, borrower: borrowers.get(p.borrowerId)!, memberId: p.borrowerId,
      date: isoDateOf(p.paymentDate), amountCents: legacyCents(p.amount).amount, method: p.paymentMethod, receivedBy: p.receivedBy,
    }))

  const all = rows.flatMap((r) => r.payments)
  const methods = new Map<string, { cents: Cents; count: number }>()
  for (const p of all) {
    const key = p.method?.trim() || 'Not given'
    const m = methods.get(key) ?? { cents: ZERO, count: 0 }
    methods.set(key, { cents: sum([m.cents, p.amountCents]), count: m.count + 1 })
  }
  const active = rows.filter((r) => r.status === 'Active')
  const paidActive = active.filter((r) => r.payments.length > 0).length

  return {
    month, label: monthLabel(month), generatedOn: todayIso(now),
    members: rows,
    repayments,
    totals: {
      activeMembers: active.length,
      paidMembers: paidActive,
      unpaidMembers: active.length - paidActive,
      collectedCents: sum(all.map((p) => p.amountCents)),
      duesCents: sum(all.filter((p) => !p.voluntary).map((p) => p.amountCents)),
      voluntaryCents: sum(all.filter((p) => p.voluntary).map((p) => p.amountCents)),
      payments: all.length,
      repaymentsCents: sum(repayments.map((r) => r.amountCents)),
      byMethod: [...methods].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.cents - a.cents || a.method.localeCompare(b.method)),
    },
  }
}

/** Distinct values, in order, joined for one cell. */
export const joinValues = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].join('; ')

/** The report as spreadsheet rows: one per member, payments in the month combined. */
export function monthlyReportRows(report: MonthlyReport) {
  return {
    headers: ['Member ID', 'Name', 'Nickname', 'Joined', 'Status', 'Paid', 'Paid on', 'Method', 'Received by', 'Covers', 'Receipts', 'Note'],
    rows: report.members.map((m) => [
      m.memberId, m.name, m.nickname, m.joined, m.status,
      m.payments.length ? m.paidCents / 100 : null,
      joinValues(m.payments.map((p) => p.date)),
      joinValues(m.payments.map((p) => p.method)),
      joinValues(m.payments.map((p) => p.receivedBy)),
      joinValues(m.payments.map((p) => p.covers)),
      joinValues(m.payments.map((p) => p.receipt)),
      joinValues(m.payments.map((p) => p.note)),
    ]),
  }
}

