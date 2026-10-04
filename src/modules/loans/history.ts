// M9: loans from the 2021–2025 records, linked to members by ID.
//
// The old records name the borrower and co-signer; nothing else ties a
// loan to a member. Names are compared once, here, to propose links: a
// name links automatically only when exactly one member has it (legal name
// or nickname, ignoring case, punctuation and anything in brackets).
// Shared names and names that match no one go to the Treasurer, who picks
// the member or records that there is none. From then on everything reads
// the stored member IDs; no screen or report matches names.
//
// A loan the records still mark Active needs the Treasurer to confirm its
// balance. A balance still owed moves to the live loans (origin
// legacy_import) with one "brought forward" repayment for everything repaid
// before the confirmation date, so the ledger opens it at exactly the
// confirmed figure (docs/architecture/11, opening-balance recipe step 3).
// This must happen before opening balances are posted.
import type { Prisma } from '@prisma/client'
import { type Cents, ZERO, cents, formatUSD, fromBigInt, subtract, sum, toBigInt, toLegacyDollars } from '@/lib/money'
import { type IsoDate, dateOnly, isoDateOf, todayIso } from '@/lib/dates'
import { nextPublicId } from '@/lib/publicIds'
import { OperationError } from '@/lib/operationError'
import { recalcMemberLoanState } from '@/lib/memberLoanState'
import { type AuditContext, recordAudit } from '@/modules/audit'
import { ledgerOpening } from '@/modules/accounting/autoPost'
import { legacyCents } from '@/modules/accounting/legacyActivity'

type Tx = Prisma.TransactionClient

export type Role = 'borrower' | 'cosigner'
export type LinkKind = 'exact' | 'reviewed' | 'no_member'
export const ROLES: readonly Role[] = ['borrower', 'cosigner']
export const BROUGHT_FORWARD_METHOD = 'Brought forward'

// ── Names ─────────────────────────────────────────────────────────────────

/** A name as compared: lower case, letters only, without anything in brackets. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z]+/g, ' ').trim()
}

type MemberName = { id: string; legalName: string; nickname: string | null }

/** Each normalised legal name and nickname, and the members who have it. */
export function nameIndex(members: readonly MemberName[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const m of members) {
    for (const name of new Set([m.legalName, m.nickname ?? ''].map(normalizeName))) {
      if (!name) continue
      index.set(name, [...(index.get(name) ?? []), m.id])
    }
  }
  return index
}

export type NameMatch = { kind: 'exact'; memberId: string } | { kind: 'ambiguous'; memberIds: string[] } | { kind: 'none' }

/** Who a name belongs to: exactly one member, several, or no one. Never a partial match. */
export function matchName(name: string, index: Map<string, string[]>): NameMatch {
  const ids = index.get(normalizeName(name)) ?? []
  if (ids.length === 1) return { kind: 'exact', memberId: ids[0] }
  return ids.length > 1 ? { kind: 'ambiguous', memberIds: ids } : { kind: 'none' }
}

/** The fields screens show: the original record, and where it went. */
export const HISTORY_FIELDS = {
  id: true, loanId: true, year: true, borrowerName: true, cosignerName: true, borrowerId: true, cosignerId: true,
  loanDate: true, endDate: true, loanAmount: true, totalPaid: true, balanceRemaining: true, status: true, importedLoanId: true,
} as const

// ── Terms and balances ────────────────────────────────────────────────────

/** The loan's term in whole months, from its date to its end date (12 when there is no end date). */
export function historicalTerm(loanDate: IsoDate, endDate: IsoDate | null): number {
  if (!endDate) return 12
  const [y1, m1] = loanDate.split('-').map(Number)
  const [y2, m2] = endDate.split('-').map(Number)
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1))
}

/**
 * What was repaid before the confirmation date beyond the repayments already
 * recorded: the loan, less the confirmed balance, less those repayments.
 * Negative means the recorded repayments are already more than that.
 */
export function broughtForward(principal: Cents, confirmedBalance: Cents, recordedByAsOf: Cents): Cents {
  return subtract(subtract(principal, confirmedBalance), recordedByAsOf)
}

type Row = Prisma.HistoricalLoanGetPayload<object>
const nameOf = (row: Row, role: Role) => (role === 'borrower' ? row.borrowerName : row.cosignerName)
const linkOf = (row: Row, role: Role) => (role === 'borrower' ? row.borrowerLink : row.cosignerLink)
/** The roles a loan has: always a borrower, a co-signer when one is named. */
const rolesOf = (row: Row): Role[] => (row.cosignerName ? ['borrower', 'cosigner'] : ['borrower'])

/** Why an Active loan's balance cannot be confirmed yet, or null. */
export function confirmBlocker(row: Pick<Row, 'borrowerLink' | 'cosignerName' | 'cosignerLink'>): string | null {
  if (!row.borrowerLink) return 'Link the borrower first.'
  if (row.cosignerName && !row.cosignerLink) return 'Link the co-signer first.'
  return null
}

// ── The review queue ──────────────────────────────────────────────────────

export type ReviewItem = {
  id: string; loanId: string; year: number; role: Role; name: string
  /** Members who have exactly this name (several: a shared name). */
  candidates: { id: string; legalName: string; status: string }[]
  /** Other loans waiting with the same name. */
  sameName: number
}

export type ActiveLoan = {
  id: string; loanId: string; year: number; loanDate: IsoDate
  borrower: { name: string; memberId: string | null; link: string | null }
  cosigner: { name: string; memberId: string | null; link: string | null } | null
  loanCents: Cents; recordBalanceCents: Cents; recordPaidCents: Cents
  /** A live loan already carrying this ID (copied by the old sync script). */
  liveLoan: { balanceCents: Cents; repaidCents: Cents } | null
  confirmed: { balanceCents: Cents; asOf: IsoDate; by: string; at: string; importedLoanId: string | null } | null
  blocker: string | null
}

export async function historyReview(db: Tx) {
  const [members, rows, staff, opening] = await Promise.all([
    db.member.findMany({ select: { id: true, legalName: true, nickname: true, status: true }, orderBy: { id: 'asc' } }),
    db.historicalLoan.findMany({ orderBy: [{ year: 'asc' }, { loanId: 'asc' }] }),
    db.admin.findMany({ select: { id: true, name: true } }),
    ledgerOpening(db),
  ])
  const index = nameIndex(members)
  const byId = new Map(members.map((m) => [m.id, m]))
  const staffName = new Map(staff.map((s) => [s.id, s.name]))

  let exactAvailable = 0
  let linked = 0
  const open: Omit<ReviewItem, 'sameName'>[] = []
  for (const row of rows) {
    let done = true
    for (const role of rolesOf(row)) {
      if (linkOf(row, role)) continue
      done = false
      const name = nameOf(row, role)!
      const match = matchName(name, index)
      if (match.kind === 'exact') { exactAvailable += 1; continue }
      const ids = match.kind === 'ambiguous' ? match.memberIds : []
      open.push({
        id: row.id, loanId: row.loanId, year: row.year, role, name,
        candidates: ids.map((id) => ({ id, legalName: byId.get(id)!.legalName, status: byId.get(id)!.status })),
      })
    }
    if (done) linked += 1
  }
  const openNames = open.map((o) => normalizeName(o.name))
  const toReview: ReviewItem[] = open.map((o, i) => ({ ...o, sameName: openNames.filter((n) => n === openNames[i]).length - 1 }))

  const active = rows.filter((r) => r.status === 'Active')
  const live = await db.loan.findMany({
    where: { loanId: { in: active.map((r) => r.loanId) } },
    select: { loanId: true, balanceRemaining: true, payments: { select: { amount: true } } },
  })
  const liveById = new Map(live.map((l) => [l.loanId, l]))
  const person = (name: string, memberId: string | null, link: string | null) => ({ name, memberId, link })
  const activeLoans: ActiveLoan[] = active.map((r) => {
    const l = liveById.get(r.loanId)
    return {
      id: r.id, loanId: r.loanId, year: r.year, loanDate: isoDateOf(r.loanDate),
      borrower: person(r.borrowerName, r.borrowerId, r.borrowerLink),
      cosigner: r.cosignerName ? person(r.cosignerName, r.cosignerId, r.cosignerLink) : null,
      loanCents: legacyCents(r.loanAmount).amount, recordBalanceCents: legacyCents(r.balanceRemaining).amount, recordPaidCents: legacyCents(r.totalPaid).amount,
      liveLoan: l ? { balanceCents: legacyCents(l.balanceRemaining).amount, repaidCents: sum(l.payments.map((p) => legacyCents(p.amount).amount)) } : null,
      confirmed: r.confirmedBalanceCents === null ? null : {
        balanceCents: fromBigInt(r.confirmedBalanceCents), asOf: isoDateOf(r.balanceAsOf!),
        by: staffName.get(r.balanceConfirmedBy!) ?? r.balanceConfirmedBy!, at: r.balanceConfirmedAt!.toISOString(), importedLoanId: r.importedLoanId,
      },
      blocker: confirmBlocker(r),
    }
  })

  return {
    total: rows.length,
    linked,
    exactAvailable,
    toReview,
    activeLoans,
    activeToConfirm: activeLoans.filter((a) => !a.confirmed).length,
    openingPosted: opening !== null,
    members: members.map((m) => ({ id: m.id, legalName: m.legalName, status: m.status })),
  }
}

// ── Linking ───────────────────────────────────────────────────────────────

/**
 * Every change here (linking, confirming) holds one lock until its
 * transaction ends and reads only after taking it, so none acts on what
 * another has since changed (a link changed while its loan is confirmed).
 */
async function lockHistory(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('historical-loans'))::text`
}

const linkData = (role: Role, memberId: string | null, link: LinkKind) =>
  role === 'borrower' ? { borrowerId: memberId, borrowerLink: link } : { cosignerId: memberId, cosignerLink: link }

/** Link every name that belongs to exactly one member. Safe to run again. */
export async function linkExactMatches(tx: Tx, ctx: AuditContext) {
  await lockHistory(tx)
  const [members, rows] = await Promise.all([
    tx.member.findMany({ select: { id: true, legalName: true, nickname: true } }),
    tx.historicalLoan.findMany({ where: { OR: [{ borrowerLink: null }, { cosignerName: { not: null }, cosignerLink: null }] } }),
  ])
  const index = nameIndex(members)
  const links: { loanId: string; role: Role; memberId: string }[] = []
  for (const row of rows) {
    for (const role of rolesOf(row)) {
      if (linkOf(row, role)) continue
      const match = matchName(nameOf(row, role)!, index)
      if (match.kind !== 'exact') continue
      await tx.historicalLoan.update({ where: { id: row.id }, data: linkData(role, match.memberId, 'exact') })
      links.push({ loanId: row.loanId, role, memberId: match.memberId })
    }
  }
  if (links.length) {
    await recordAudit(tx, ctx, { action: 'loan_history.link_exact', entityType: 'historical_loan', entityId: 'exact-matches', after: { links } })
  }
  return { linked: links.length }
}

export type LinkInput = { id: string; role: Role; memberId: string | null; sameName: boolean }

/**
 * The Treasurer's decision for one name on one loan: this member, or no
 * member record. With sameName, also every other loan still waiting with
 * that name, unless several members share it.
 */
export async function linkName(tx: Tx, input: LinkInput, ctx: AuditContext) {
  await lockHistory(tx)
  const row = await tx.historicalLoan.findUnique({ where: { id: input.id } })
  if (!row) throw new OperationError(404, 'Loan not found.')
  const name = nameOf(row, input.role)
  if (!name) throw new OperationError(400, 'This loan has no co-signer.')
  if (row.importedLoanId) {
    throw new OperationError(409, `This loan was moved to the live loans as ${row.importedLoanId}; its members cannot change here.`)
  }
  if (input.memberId && !(await tx.member.findUnique({ where: { id: input.memberId }, select: { id: true } }))) {
    throw new OperationError(400, 'That member does not exist.')
  }

  const targets: { id: string; loanId: string; role: Role }[] = [{ id: row.id, loanId: row.loanId, role: input.role }]
  if (input.sameName) {
    const members = await tx.member.findMany({ select: { id: true, legalName: true, nickname: true } })
    if (matchName(name, nameIndex(members)).kind === 'ambiguous') {
      throw new OperationError(422, 'Several members have this name: link each loan on its own.')
    }
    const key = normalizeName(name)
    const others = await tx.historicalLoan.findMany({ where: { id: { not: row.id }, importedLoanId: null } })
    for (const other of others) {
      for (const role of rolesOf(other)) {
        if (!linkOf(other, role) && normalizeName(nameOf(other, role)!) === key) targets.push({ id: other.id, loanId: other.loanId, role })
      }
    }
  }
  const link: LinkKind = input.memberId ? 'reviewed' : 'no_member'
  for (const t of targets) await tx.historicalLoan.update({ where: { id: t.id }, data: linkData(t.role, input.memberId, link) })
  await recordAudit(tx, ctx, {
    action: 'loan_history.link', entityType: 'historical_loan', entityId: row.loanId,
    before: { role: input.role, memberId: input.role === 'borrower' ? row.borrowerId : row.cosignerId, link: linkOf(row, input.role) },
    after: { name, memberId: input.memberId, link, loans: targets.map((t) => `${t.loanId}:${t.role}`) },
  })
  return { linked: targets.length }
}

// ── Confirming an Active loan's balance ───────────────────────────────────

export type ConfirmInput = { id: string; balanceCents: Cents; asOf: IsoDate }

export async function confirmBalance(tx: Tx, input: ConfirmInput, actorId: string, ctx: AuditContext) {
  await lockHistory(tx)
  const row = await tx.historicalLoan.findUnique({ where: { id: input.id } })
  if (!row) throw new OperationError(404, 'Loan not found.')
  if (row.status !== 'Active') throw new OperationError(409, 'Only a loan the records mark Active needs a confirmed balance.')
  if (row.confirmedBalanceCents !== null) throw new OperationError(409, 'This balance has already been confirmed.')
  if (await ledgerOpening(tx)) {
    throw new OperationError(409, 'Opening balances are already posted: older loans must be confirmed before them.')
  }
  const blocker = confirmBlocker(row)
  if (blocker) throw new OperationError(422, blocker)
  const loanDate = isoDateOf(row.loanDate)
  if (input.asOf < loanDate || input.asOf > todayIso()) {
    throw new OperationError(422, `The balance date must be between the loan date (${loanDate}) and today.`)
  }
  const principal = legacyCents(row.loanAmount).amount
  if (input.balanceCents < 0 || input.balanceCents > principal) {
    throw new OperationError(422, `The balance must be between $0 and the ${formatUSD(principal)} loan.`)
  }

  // A live loan under the same ID is one the old sync script copied (the
  // migration marked those legacy_import); anything else is not this loan.
  const live = await tx.loan.findUnique({ where: { loanId: row.loanId }, include: { payments: true } })
  if (live && (live.origin !== 'legacy_import' || live.principalCents !== null)) {
    throw new OperationError(409, `A different live loan already uses the ID ${row.loanId}. Check it before confirming.`)
  }
  if ((live || input.balanceCents > 0) && !row.borrowerId) {
    throw new OperationError(422, 'A loan still owed, or already in the live loans, must belong to a member: link the borrower to one.')
  }

  const recordedByAsOf = live ? sum(live.payments.filter((p) => isoDateOf(p.paymentDate) <= input.asOf).map((p) => legacyCents(p.amount).amount)) : ZERO
  const forward = broughtForward(principal, input.balanceCents, recordedByAsOf)
  if (forward < 0) {
    throw new OperationError(422, `Repayments recorded up to ${input.asOf} already total ${formatUSD(recordedByAsOf)}, more than the loan less that balance.`)
  }

  let importedLoanId: string | null = null
  if (live || input.balanceCents > 0) {
    importedLoanId = row.loanId
    const borrower = (await tx.member.findUnique({ where: { id: row.borrowerId! }, select: { legalName: true } }))!
    const cosigner = row.cosignerId ? await tx.member.findUnique({ where: { id: row.cosignerId }, select: { legalName: true } }) : null
    const term = historicalTerm(loanDate, row.endDate ? isoDateOf(row.endDate) : null)
    const note = `Moved from the 2021–2025 records (M9): ${formatUSD(input.balanceCents)} owed at the end of ${input.asOf}, confirmed by the Treasurer.`
    if (!live) {
      await tx.loan.create({
        data: {
          loanId: row.loanId, origin: 'legacy_import',
          borrowerId: row.borrowerId!, borrowerName: borrower.legalName,
          cosignerId: row.cosignerId, cosignerName: cosigner?.legalName ?? row.cosignerName,
          loanDate: row.loanDate, endDate: row.endDate, termMonths: term,
          loanAmount: toLegacyDollars(principal), monthlyDue: Math.round((toLegacyDollars(principal) / term) * 100) / 100,
          totalPaid: 0, balanceRemaining: toLegacyDollars(principal), notes: note,
        },
      })
    }
    // The copy may name the wrong member of a shared name: the loan and its
    // repayments follow the members the Treasurer linked.
    if (live) await tx.loanPayment.updateMany({ where: { loanId: row.loanId }, data: { borrowerId: row.borrowerId!, borrowerName: borrower.legalName } })
    if (forward > 0) {
      const asOf = dateOnly(input.asOf)
      await tx.loanPayment.create({
        data: {
          paymentId: nextPublicId('LP'), loanId: row.loanId, borrowerId: row.borrowerId!, borrowerName: borrower.legalName,
          paymentDate: asOf, amount: toLegacyDollars(forward), paymentMethod: BROUGHT_FORWARD_METHOD, source: 'legacy_import',
          monthYear: `${asOf.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}-${asOf.getUTCFullYear()}`,
          comments: `Repaid by ${input.asOf} according to the 2021–2025 records (M9).`,
        },
      })
    }
    // The loan's figures from its repayments, the brought-forward one included.
    const payments = await tx.loanPayment.findMany({ where: { loanId: row.loanId }, select: { amount: true } })
    const repaid = sum(payments.map((p) => legacyCents(p.amount).amount))
    const balance = repaid >= principal ? ZERO : subtract(principal, repaid)
    await tx.loan.update({
      where: { loanId: row.loanId },
      data: {
        origin: 'legacy_import', notes: live ? [live.notes, note].filter(Boolean).join(' ') : note,
        borrowerId: row.borrowerId!, borrowerName: borrower.legalName,
        cosignerId: row.cosignerId, cosignerName: cosigner?.legalName ?? row.cosignerName,
        totalPaid: toLegacyDollars(repaid), balanceRemaining: toLegacyDollars(balance),
        status: balance > 0 ? 'Active' : 'Paid Off', lifecycle: balance > 0 ? 'disbursed' : 'paid_off',
        nextDueDate: balance > 0 ? row.endDate : null, overdue: false,
      },
    })
    // Everyone whose loans changed: the linked members, and whoever the copy named.
    const affected = new Set([row.borrowerId!, row.cosignerId, live?.borrowerId, live?.cosignerId].filter((id): id is string => !!id))
    for (const memberId of affected) await recalcMemberLoanState(tx, memberId)
  }

  await tx.historicalLoan.update({
    where: { id: row.id },
    data: {
      confirmedBalanceCents: toBigInt(input.balanceCents), balanceAsOf: dateOnly(input.asOf),
      balanceConfirmedBy: actorId, balanceConfirmedAt: new Date(), importedLoanId,
    },
  })
  await recordAudit(tx, ctx, {
    action: 'loan_history.confirm_balance', entityType: 'historical_loan', entityId: row.loanId,
    before: {
      status: row.status, recordBalance: row.balanceRemaining,
      liveLoan: live ? { balanceRemaining: live.balanceRemaining, totalPaid: live.totalPaid, borrowerId: live.borrowerId, cosignerId: live.cosignerId } : null,
    },
    after: { balanceCents: input.balanceCents, asOf: input.asOf, broughtForwardCents: importedLoanId ? forward : 0, importedLoanId },
  })
  return { loanId: importedLoanId, balanceCents: input.balanceCents, broughtForwardCents: importedLoanId ? forward : cents(0) }
}

// ── For opening balances ──────────────────────────────────────────────────

/**
 * Why opening balances at this cutover cannot go ahead because of older
 * loans: one marked Active without a confirmed balance, or one confirmed as
 * of the cutover or later. That says nothing of the balance at the cutover,
 * and a brought-forward repayment would land after it and post as cash
 * received.
 */
export async function historyOpeningBlockers(db: Pick<Tx, 'historicalLoan'>, cutover: IsoDate) {
  const [unconfirmed, late] = await Promise.all([
    db.historicalLoan.findMany({ where: { status: 'Active', confirmedBalanceCents: null }, select: { loanId: true, balanceRemaining: true }, orderBy: { loanId: 'asc' } }),
    db.historicalLoan.findMany({ where: { confirmedBalanceCents: { not: null }, balanceAsOf: { gte: dateOnly(cutover) } }, select: { loanId: true }, orderBy: { loanId: 'asc' } }),
  ])
  return {
    unconfirmed: unconfirmed.map((r) => ({ loanId: r.loanId, cents: legacyCents(r.balanceRemaining).amount })),
    confirmedTooLate: late.map((r) => r.loanId),
  }
}
