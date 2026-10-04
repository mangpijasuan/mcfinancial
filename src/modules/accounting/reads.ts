// M6: screens read balances from the ledger, behind a switch.
//
// Until the switch is on, every screen reads the stored figures as before
// (the "records"). With LEDGER_READS=true, and once opening balances are
// posted, the same figures come from the ledger instead:
//
// - a member's contributions: their member-capital (2000) postings other
//   than withdrawals: the archive total at the cutover plus every
//   contribution since, less reversals. The records' overallContributions
//   (archive + contributions tracked since) is the same quantity.
// - a member's withdrawals: their withdrawal postings on 2000, net of any
//   reversal; the records' are withdrawals dated from the cutover.
// - a loan's balance: its receivable (1100), for a loan whose money has
//   moved (paid out or paid off). Before the payout the ledger holds nothing
//   for it, so the stored figure stands.
//
// The quantities do not change meaning, only where they come from, so the
// switch can be turned on and off (docs/architecture/11, M6). The parity
// report puts both side by side before anyone turns it on.
import { Prisma } from '@prisma/client'
import { type Cents, ZERO, add, fromBigInt, subtract, sum, toLegacyDollars } from '@/lib/money'
import { type IsoDate, dateOnly } from '@/lib/dates'
import { ledgerOpening } from './autoPost'
import { LOANS_RECEIVABLE, MEMBER_CAPITAL, legacyCents } from './legacyActivity'

type Db = Prisma.TransactionClient

export type ReadSource = {
  source: 'ledger' | 'records'
  /** LEDGER_READS=true in the server's settings. */
  requested: boolean
  /** Why this source, in a sentence for the page. */
  reason: string
  cutover: IsoDate | null
}

export const ledgerReadsRequested = () => process.env.LEDGER_READS === 'true'

/** Where balances come from right now: the ledger only when asked for and opening balances exist. */
export async function readSource(db: Pick<Db, 'journalEntry'>): Promise<ReadSource> {
  const requested = ledgerReadsRequested()
  const opened = await ledgerOpening(db)
  const cutover = opened?.cutover ?? null
  if (!requested) return { source: 'records', requested, reason: 'LEDGER_READS is off: screens show the stored figures.', cutover }
  if (!opened) return { source: 'records', requested, reason: 'LEDGER_READS is on, but opening balances are not posted yet: screens show the stored figures.', cutover }
  return { source: 'ledger', requested, reason: 'LEDGER_READS is on: screens show the ledger.', cutover }
}

// ── Members ───────────────────────────────────────────────────────────────

export type MemberFigures = { contributedCents: Cents; withdrawnCents: Cents; capitalCents: Cents }
/** The ledger's contributions, split as screens show them: the archive total at the cutover, and everything since. */
export type LedgerMemberFigures = MemberFigures & { archiveCents: Cents; sinceCents: Cents }
const NONE: LedgerMemberFigures = { contributedCents: ZERO, withdrawnCents: ZERO, capitalCents: ZERO, archiveCents: ZERO, sinceCents: ZERO }

/** Each member's contributions and withdrawals as the ledger holds them. */
/** memberIds, when given, must not be empty. */
export async function ledgerMemberFigures(db: Pick<Db, '$queryRaw'>, memberIds?: string[]): Promise<Map<string, LedgerMemberFigures>> {
  const only = memberIds ? Prisma.sql`AND l."memberId" IN (${Prisma.join(memberIds)})` : Prisma.empty
  const rows = await db.$queryRaw<{ memberId: string; kind: 'withdrawal' | 'opening' | 'since'; credit: bigint; debit: bigint }[]>`
    SELECT l."memberId",
           CASE WHEN e."type" = 'withdrawal' OR (e."type" = 'reversal' AND r."type" = 'withdrawal') THEN 'withdrawal'
                WHEN e."type" = 'opening_balance' THEN 'opening' ELSE 'since' END AS "kind",
           COALESCE(SUM(l."creditCents"), 0)::bigint AS "credit", COALESCE(SUM(l."debitCents"), 0)::bigint AS "debit"
    FROM "JournalLine" l
    JOIN "JournalEntry" e ON e."id" = l."entryId"
    LEFT JOIN "JournalEntry" r ON r."id" = e."reversesEntryId"
    WHERE l."accountCode" = ${MEMBER_CAPITAL} AND l."memberId" IS NOT NULL ${only}
    GROUP BY 1, 2`
  const out = new Map<string, LedgerMemberFigures>()
  for (const row of rows) {
    const f = out.get(row.memberId) ?? { ...NONE }
    const credit = fromBigInt(row.credit)
    const debit = fromBigInt(row.debit)
    if (row.kind === 'withdrawal') f.withdrawnCents = add(f.withdrawnCents, subtract(debit, credit))
    else if (row.kind === 'opening') f.archiveCents = add(f.archiveCents, subtract(credit, debit))
    else f.sinceCents = add(f.sinceCents, subtract(credit, debit))
    f.contributedCents = add(f.archiveCents, f.sinceCents)
    f.capitalCents = subtract(f.contributedCents, f.withdrawnCents)
    out.set(row.memberId, f)
  }
  return out
}

/** The same figures from the records: the stored total, and withdrawals dated from the cutover. */
export async function recordMemberFigures(db: Pick<Db, 'member' | 'withdrawal'>, cutover: IsoDate): Promise<Map<string, MemberFigures>> {
  const [members, withdrawals] = await Promise.all([
    db.member.findMany({ select: { id: true, overallContributions: true } }),
    db.withdrawal.findMany({ where: { amount: { gt: 0 }, withdrawalDate: { gte: dateOnly(cutover) } }, select: { memberId: true, amount: true } }),
  ])
  const withdrawn = new Map<string, Cents>()
  for (const w of withdrawals) withdrawn.set(w.memberId, add(withdrawn.get(w.memberId) ?? ZERO, legacyCents(w.amount).amount))
  return new Map(members.map((m) => {
    const contributedCents = legacyCents(m.overallContributions).amount
    const withdrawnCents = withdrawn.get(m.id) ?? ZERO
    return [m.id, { contributedCents, withdrawnCents, capitalCents: subtract(contributedCents, withdrawnCents) }]
  }))
}

/**
 * The member as the loan policy should see them: with the ledger's
 * contributions when reading from it, else unchanged (archive + tracked).
 */
export async function forLoanPolicy<T extends { id: string }>(db: Pick<Db, 'journalEntry' | '$queryRaw'>, member: T): Promise<T & { contributions?: number }> {
  const src = await readSource(db)
  if (src.source === 'records') return member
  return { ...member, contributions: toLegacyDollars((await ledgerMemberFigures(db, [member.id])).get(member.id)?.contributedCents ?? ZERO) }
}

/**
 * Members with their contribution figures from the ledger when reading from
 * it: the archive total, contributions since, and the two together (screens
 * show either the parts or the total).
 */
export async function withMemberFigures<T extends { id: string; overallContributions: number; archiveLifetime: number; contributions2026: number }>(db: Db, members: T[]): Promise<T[]> {
  const src = await readSource(db)
  if (src.source === 'records' || members.length === 0) return members
  const figures = await ledgerMemberFigures(db, members.map((m) => m.id))
  return members.map((m) => {
    const f = figures.get(m.id) ?? NONE
    return { ...m, archiveLifetime: toLegacyDollars(f.archiveCents), contributions2026: toLegacyDollars(f.sinceCents), overallContributions: toLegacyDollars(f.contributedCents) }
  })
}

// ── Loans ─────────────────────────────────────────────────────────────────

/** Loans the ledger carries: their money has moved. */
export const LEDGER_LOAN_STAGES = ['disbursed', 'paid_off'] as const
const inLedger = (lifecycle: string) => (LEDGER_LOAN_STAGES as readonly string[]).includes(lifecycle)

/** Each loan's receivable (1100) as the ledger holds it. */
export async function ledgerLoanBalances(db: Pick<Db, 'journalLine'>, loanIds?: string[]): Promise<Map<string, Cents>> {
  const groups = await db.journalLine.groupBy({
    by: ['loanId'],
    where: { accountCode: LOANS_RECEIVABLE, loanId: loanIds ? { in: loanIds } : { not: null } },
    _sum: { debitCents: true, creditCents: true },
  })
  return new Map(groups.map((g) => [g.loanId!, subtract(fromBigInt(g._sum.debitCents!), fromBigInt(g._sum.creditCents!))]))
}

/** Loans with balanceRemaining replaced by the ledger's figure when reading from it. */
export async function withLoanBalances<T extends { loanId: string; lifecycle: string; balanceRemaining: number }>(db: Db, loans: T[]): Promise<T[]> {
  const src = await readSource(db)
  const carried = loans.filter((l) => inLedger(l.lifecycle))
  if (src.source === 'records' || carried.length === 0) return loans
  const balances = await ledgerLoanBalances(db, carried.map((l) => l.loanId))
  return loans.map((l) => (inLedger(l.lifecycle) ? { ...l, balanceRemaining: toLegacyDollars(balances.get(l.loanId) ?? ZERO) } : l))
}

/** What active loans still owe, in dollars, from the current source. */
export async function outstandingDollars(db: Db): Promise<number> {
  const active = await db.loan.findMany({ where: { status: 'Active' }, select: { loanId: true, lifecycle: true, balanceRemaining: true } })
  const shown = await withLoanBalances(db, active)
  return toLegacyDollars(sum(shown.map((l) => legacyCents(l.balanceRemaining).amount)))
}

// ── The side-by-side check ────────────────────────────────────────────────

export type ParityReport = {
  readSource: ReadSource
  members: { memberId: string; name: string; field: 'contributions' | 'withdrawals'; recordsCents: Cents; ledgerCents: Cents; differenceCents: Cents }[]
  loans: { loanId: string; borrower: string; recordsCents: Cents; ledgerCents: Cents; differenceCents: Cents }[]
  totals: Record<'contributed' | 'withdrawn' | 'capital' | 'outstanding', { recordsCents: Cents; ledgerCents: Cents }>
  checked: { members: number; loans: number }
}

/**
 * Every figure the switch changes, from both sources, and where they differ.
 * Null until opening balances are posted (there is no ledger to read).
 */
export async function readsParity(db: Db): Promise<ParityReport | null> {
  const src = await readSource(db)
  if (!src.cutover) return null
  const [records, ledger, people, loans] = await Promise.all([
    recordMemberFigures(db, src.cutover),
    ledgerMemberFigures(db),
    db.member.findMany({ select: { id: true, legalName: true }, orderBy: { id: 'asc' } }),
    db.loan.findMany({ where: { lifecycle: { in: [...LEDGER_LOAN_STAGES] } }, select: { loanId: true, borrowerName: true, balanceRemaining: true }, orderBy: { loanId: 'asc' } }),
  ])
  const balances = await ledgerLoanBalances(db)

  const memberDiffs: ParityReport['members'] = []
  for (const p of people) {
    const r = records.get(p.id)!
    const l = ledger.get(p.id) ?? NONE
    if (r.contributedCents !== l.contributedCents) {
      memberDiffs.push({ memberId: p.id, name: p.legalName, field: 'contributions', recordsCents: r.contributedCents, ledgerCents: l.contributedCents, differenceCents: subtract(l.contributedCents, r.contributedCents) })
    }
    if (r.withdrawnCents !== l.withdrawnCents) {
      memberDiffs.push({ memberId: p.id, name: p.legalName, field: 'withdrawals', recordsCents: r.withdrawnCents, ledgerCents: l.withdrawnCents, differenceCents: subtract(l.withdrawnCents, r.withdrawnCents) })
    }
  }
  const loanDiffs: ParityReport['loans'] = loans.flatMap((loan) => {
    const recordsCents = legacyCents(loan.balanceRemaining).amount
    const ledgerCents = balances.get(loan.loanId) ?? ZERO
    return recordsCents === ledgerCents ? [] : [{ loanId: loan.loanId, borrower: loan.borrowerName, recordsCents, ledgerCents, differenceCents: subtract(ledgerCents, recordsCents) }]
  })

  const total = (m: Map<string, MemberFigures>, k: keyof MemberFigures) => sum([...m.values()].map((f) => f[k]))
  return {
    readSource: src,
    members: memberDiffs,
    loans: loanDiffs,
    totals: {
      contributed: { recordsCents: total(records, 'contributedCents'), ledgerCents: total(ledger, 'contributedCents') },
      withdrawn: { recordsCents: total(records, 'withdrawnCents'), ledgerCents: total(ledger, 'withdrawnCents') },
      capital: { recordsCents: total(records, 'capitalCents'), ledgerCents: total(ledger, 'capitalCents') },
      outstanding: {
        recordsCents: sum(loans.map((l) => legacyCents(l.balanceRemaining).amount)),
        ledgerCents: sum(loans.map((l) => balances.get(l.loanId) ?? ZERO)),
      },
    },
    checked: { members: people.length, loans: loans.length },
  }
}
