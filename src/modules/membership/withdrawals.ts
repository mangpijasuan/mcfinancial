import type { Prisma } from '@prisma/client'
import { nextPublicId } from '@/lib/publicIds'
import { OperationError } from '@/lib/operationError'
import { type AuditContext, recordAudit } from '@/modules/audit'
import { onMemberStatusChange } from '@/modules/contributions'
import { postWithdrawalNow } from '@/modules/accounting/legacyActivity'
import { fromLegacyDollars, formatUSD, subtract, sum, ZERO } from '@/lib/money'
import { dateOnly, isoDateOf, todayIso } from '@/lib/dates'
import { ledgerOpening } from '@/modules/accounting/autoPost'
import { accountBalance } from '@/modules/accounting/ledger'
import { DEFAULT_CUTOVER } from '@/modules/accounting/opening'
import { treasuryPosition } from '@/modules/treasury'
import type { Actors } from '@/modules/approvals/actors'

export type WithdrawalInput = {
  memberId: string
  amount: number // dollars (legacy column)
  withdrawalDate: string // ISO
  type: 'Partial' | 'Full Exit'
  reason: string | null
  processedBy: string | null
  notes: string | null
}

/** Checks that can be made before queueing for approval, and again at execution. */
export async function checkWithdrawal(db: Prisma.TransactionClient, input: WithdrawalInput) {
  const member = await db.member.findUnique({
    where: { id: input.memberId },
    select: { legalName: true, status: true, activeAsBorrower: true, activeAsCosigner: true, currentLoanBalance: true, overallContributions: true },
  })
  if (!member) throw new OperationError(404, 'Member not found')
  if (member.activeAsBorrower > 0 || member.activeAsCosigner > 0 || member.currentLoanBalance > 0) {
    throw new OperationError(409, 'Member cannot withdraw while they have an active loan or co-signer obligation.')
  }
  const obligations = await db.loan.count({ where: {
    lifecycle: { in: ['approved', 'agreement_signed', 'disbursed'] },
    OR: [{ borrowerId: input.memberId }, { cosignerId: input.memberId }],
  } })
  if (obligations) throw new OperationError(409, 'Member cannot withdraw while they have an active loan or co-signer obligation.')
  const amount = fromLegacyDollars(input.amount)
  const day = isoDateOf(new Date(input.withdrawalDate))
  if (amount <= 0 || day > todayIso() || day < DEFAULT_CUTOVER) {
    throw new OperationError(400, 'Withdrawal must be positive and dated from the cutover through today.')
  }
  const opened = await ledgerOpening(db)
  const prior = await db.withdrawal.aggregate({ where: { memberId: input.memberId, withdrawalDate: { gte: dateOnly(DEFAULT_CUTOVER) } }, _sum: { amount: true } })
  const withdrawals = opened ? await db.withdrawal.findMany({ where: { memberId: input.memberId, withdrawalDate: { gte: dateOnly(opened.cutover) } }, select: { withdrawalId: true, amount: true } }) : []
  const posted = new Set((await db.journalEntry.findMany({ where: { idempotencyKey: { in: withdrawals.map(w => `withdrawal:${w.withdrawalId}`) } }, select: { idempotencyKey: true } })).map(e => e.idempotencyKey))
  const unposted = sum(withdrawals.filter(w => !posted.has(`withdrawal:${w.withdrawalId}`)).map(w => fromLegacyDollars(w.amount)))
  const capital = opened
    ? subtract((await accountBalance(db, '2000', { memberId: input.memberId })).balance, unposted)
    : subtract(fromLegacyDollars(member.overallContributions), fromLegacyDollars(prior._sum.amount ?? 0))
  if (amount > capital) throw new OperationError(409, `Withdrawal exceeds available member capital (${formatUSD(capital)}).`)
  if (input.type === 'Full Exit' && amount !== capital) throw new OperationError(409, 'A full exit must withdraw the complete available capital balance; use Partial otherwise.')
  const position = await treasuryPosition(db)
  // Clearing funds have not reached the bank and cannot fund a bank payout.
  const cash = opened ? subtract((await accountBalance(db, '1000', { asOf: todayIso() })).balance, position.cash.source === 'ledger' ? position.cash.unpostedWithdrawalsCents : ZERO) : position.cash.cents
  if (cash === null || amount > subtract(cash, position.committed.cents)) {
    throw new OperationError(409, 'Insufficient known bank cash after committed loan payouts.')
  }
  return member
}

export async function recordWithdrawal(tx: Prisma.TransactionClient, input: WithdrawalInput, actors: Actors, ctx: AuditContext) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('treasury.lending_capacity'))`
  const member = await checkWithdrawal(tx, input)
  const isFullExit = input.type === 'Full Exit'
  const created = await tx.withdrawal.create({
    data: {
      withdrawalId: nextPublicId('WD'),
      memberId: input.memberId,
      memberName: member.legalName,
      amount: input.amount,
      withdrawalDate: new Date(input.withdrawalDate),
      type: input.type,
      reason: input.reason,
      processedBy: input.processedBy,
      notes: input.notes,
    },
  })
  // Dual-write (M5): in the ledger in the same transaction, once opening
  // balances exist (earlier ones are in the opening balances).
  const journalEntry = await postWithdrawalNow(tx, created.withdrawalId)
  if (isFullExit) {
    await tx.member.update({ where: { id: input.memberId }, data: { status: 'Inactive', eligible: 'NO - Inactive' } })
    await onMemberStatusChange(tx, input.memberId, member.status, 'Inactive')
  }
  await recordAudit(tx, ctx, {
    action: isFullExit ? 'withdrawal.full_exit' : 'withdrawal.create',
    entityType: 'withdrawal', entityId: created.withdrawalId, after: created,
    metadata: { maker: actors.maker.id, checker: actors.checker?.id ?? null, journalEntry },
  })
  return { ...created, journalEntry }
}
