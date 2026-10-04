// Maker / checker (D-06). An action that needs a second person is stored
// as an ApprovalRequest with everything needed to run it later. A
// different staff member holding the checker permission approves it, and
// the operation runs in the same transaction as the approval. If the
// operation fails (the claim was already handled, loan policy no longer
// passes, …) nothing changes and the request stays pending.
import type { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextPublicId } from '@/lib/publicIds'
import { OperationError } from '@/lib/operationError'
import { cents, fromBigInt } from '@/lib/money'
import { type AuditContext, auditContext, recordAudit } from '@/modules/audit'
import type { StaffPrincipal } from '@/modules/auth'
import { LedgerError, postEntry, type EntryInput } from '@/modules/accounting/ledger'
import { confirmZelleClaim } from '@/modules/payments/zelle'
import { recordWithdrawal, type WithdrawalInput } from '@/modules/membership/withdrawals'
import { createLoan, type LoanInput } from '@/modules/loans/create'
import {
  type DisburseInput, type WaiveInput, type WriteOffInput, disburseLoan, waiveLateFee, writeOffLoan,
} from '@/modules/loans/lifecycle'
import { type ReverseInput, reverseContribution } from '@/modules/contributions'
import { type OpeningPayload, postOpeningBalances } from '@/modules/accounting/opening'
import { type BankBalanceInput, recordBankBalance } from '@/modules/treasury'
import { type TransferInput, recordTransfer } from '@/modules/accounting/reconciliation'
import { APPROVAL_POLICIES, type ApprovalAction, needsApproval } from './policy'
import type { Actors, StaffRef } from './actors'

type Tx = Prisma.TransactionClient

export type ApprovalPayload = {
  'payment.zelle.confirm': { paymentId: string }
  'withdrawal.record': WithdrawalInput
  'loan.create': LoanInput
  'journal.manual': Omit<EntryInput, 'createdBy' | 'approvedBy'>
  'loan.disburse': DisburseInput
  'loan.fee.waive': WaiveInput
  'loan.write_off': WriteOffInput
  'contribution.reverse': ReverseInput
  'ledger.opening_balances': OpeningPayload
  'treasury.bank_balance': BankBalanceInput
  'treasury.clearing_transfer': TransferInput
}

/** Run an operation, now (no approval needed) or when its request is approved. */
export async function executeOperation<A extends ApprovalAction>(
  tx: Tx, action: A, payload: ApprovalPayload[A], actors: Actors, ctx: AuditContext,
): Promise<{ resultRef: string; result: unknown }> {
  switch (action) {
    case 'payment.zelle.confirm': {
      const p = payload as ApprovalPayload['payment.zelle.confirm']
      const result = await confirmZelleClaim(tx, p.paymentId, actors, ctx)
      return { resultRef: result.publicId, result }
    }
    case 'withdrawal.record': {
      const result = await recordWithdrawal(tx, payload as WithdrawalInput, actors, ctx)
      return { resultRef: result.withdrawalId, result }
    }
    case 'loan.create': {
      const result = await createLoan(tx, payload as LoanInput, actors, ctx)
      return { resultRef: result.loanId, result }
    }
    case 'loan.disburse': {
      const result = await disburseLoan(tx, payload as DisburseInput, actors, ctx)
      return { resultRef: result.loanId, result }
    }
    case 'loan.fee.waive': {
      const result = await waiveLateFee(tx, payload as WaiveInput, actors, ctx)
      return { resultRef: result.feeId, result }
    }
    case 'loan.write_off': {
      const result = await writeOffLoan(tx, payload as WriteOffInput, actors, ctx)
      return { resultRef: result.loanId, result }
    }
    case 'ledger.opening_balances': {
      const result = await postOpeningBalances(tx, payload as OpeningPayload, actors, ctx)
      return { resultRef: result.entries[0] ?? 'opening-balances', result }
    }
    case 'treasury.clearing_transfer': {
      const result = await recordTransfer(tx, payload as TransferInput, actors, ctx)
      return { resultRef: result.transferId, result }
    }
    case 'treasury.bank_balance': {
      const result = await recordBankBalance(tx, payload as BankBalanceInput, actors, ctx)
      return { resultRef: result.balanceId, result }
    }
    case 'contribution.reverse': {
      const result = await reverseContribution(tx, payload as ReverseInput, actors, ctx)
      return { resultRef: result.transactionId, result }
    }
    case 'journal.manual': {
      const p = payload as ApprovalPayload['journal.manual']
      try {
        const { entry } = await postEntry(tx, {
          ...p,
          lines: p.lines.map((l) => ({ ...l, debit: l.debit === undefined ? undefined : cents(l.debit), credit: l.credit === undefined ? undefined : cents(l.credit) })),
          createdBy: actors.maker.id,
          approvedBy: actors.checker?.id ?? null,
        })
        await recordAudit(tx, ctx, {
          action: 'ledger.entry.post', entityType: 'journal_entry', entityId: entry.entryNumber, after: entry,
          metadata: { maker: actors.maker.id, checker: actors.checker?.id ?? null },
        })
        return { resultRef: entry.entryNumber, result: entry }
      } catch (err) {
        if (err instanceof LedgerError) {
          throw new OperationError(err.code === 'idempotency_conflict' ? 409 : 422, err.message, { code: err.code })
        }
        throw err
      }
    }
  }
  throw new OperationError(400, `unknown action ${action}`)
}

const toRef = (p: StaffPrincipal): StaffRef => ({ id: p.id, email: p.email })

export type SubmitOptions<A extends ApprovalAction> = {
  action: A
  principal: StaffPrincipal
  req: NextRequest
  amountCents: number | null
  entityType: string
  entityId: string
  summary: string
  payload: ApprovalPayload[A]
}

/**
 * The entry point for routes: runs the operation now, or queues it for a
 * checker when the approval policy says so.
 */
export async function submitOrExecute<A extends ApprovalAction>(opts: SubmitOptions<A>):
  Promise<{ queued: ApprovalView } | { result: unknown; resultRef: string }> {
  const ctx = auditContext(opts.req, opts.principal)
  if (!needsApproval(opts.action, opts.amountCents)) {
    return prisma.$transaction((tx) => executeOperation(tx, opts.action, opts.payload, { maker: toRef(opts.principal), checker: null }, ctx))
  }
  const request = await prisma.$transaction((tx) => requestApproval(tx, opts, ctx))
  return { queued: request }
}

async function requestApproval<A extends ApprovalAction>(tx: Tx, opts: SubmitOptions<A>, ctx: AuditContext): Promise<ApprovalView> {
  const policy = APPROVAL_POLICIES[opts.action]
  if (!opts.principal.permissions.has(policy.makerPermission)) throw new OperationError(403, 'Forbidden')
  const open = await tx.approvalRequest.findFirst({
    where: { action: opts.action, entityType: opts.entityType, entityId: opts.entityId, status: 'pending' },
    select: { publicId: true },
  })
  if (open) throw new OperationError(409, `This is already waiting for approval (${open.publicId}).`, { approvalRequest: open.publicId })
  let row
  try {
    row = await tx.approvalRequest.create({
      data: {
        publicId: nextPublicId('APR'),
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        summary: opts.summary,
        amountCents: opts.amountCents === null ? null : BigInt(opts.amountCents),
        payload: opts.payload as unknown as Prisma.InputJsonValue,
        approvalsRequired: policy.approvalsRequired,
        requestedBy: opts.principal.id,
      },
      include: { decisions: true },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new OperationError(409, 'This is already waiting for approval.')
    }
    throw err
  }
  await recordAudit(tx, ctx, {
    action: 'approval.request', entityType: 'approval_request', entityId: row.publicId,
    after: { action: row.action, summary: row.summary, entityType: row.entityType, entityId: row.entityId, amountCents: row.amountCents },
  })
  return (await viewRequests(tx, [row], opts.principal))[0]
}

type Decision = 'approve' | 'reject'

/** A checker approves or rejects a pending request. */
export async function decideApproval(requestId: string, principal: StaffPrincipal, decision: Decision, note: string | null, req: NextRequest) {
  const ctx = auditContext(req, principal)
  return prisma.$transaction(async (tx) => {
    // Lock the request so two checkers cannot both execute it.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ApprovalRequest" WHERE id = ${requestId} FOR UPDATE`
    if (locked.length === 0) throw new OperationError(404, 'Approval request not found.')
    const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { decisions: true } })
    if (request.status !== 'pending') throw new OperationError(409, `This request is already ${request.status}.`)
    const policy = APPROVAL_POLICIES[request.action as ApprovalAction]
    if (!policy) throw new OperationError(400, `unknown action ${request.action}`)
    if (request.requestedBy === principal.id) {
      throw new OperationError(409, 'You proposed this, so someone else must approve it (maker/checker).', { code: 'maker_is_checker' })
    }
    if (!principal.permissions.has(policy.checkerPermission)) throw new OperationError(403, 'Forbidden')
    if (request.decisions.some((d) => d.deciderId === principal.id)) throw new OperationError(409, 'You have already decided on this request.')
    if (decision === 'reject' && !note?.trim()) throw new OperationError(400, 'Give a reason for rejecting.')

    await tx.approvalDecision.create({ data: { requestId, deciderId: principal.id, decision, note: note?.trim() || null } })

    if (decision === 'reject') {
      const updated = await tx.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', decidedAt: new Date(), decisionNote: note!.trim() },
        include: { decisions: true },
      })
      await recordAudit(tx, ctx, {
        action: 'approval.reject', entityType: 'approval_request', entityId: request.publicId,
        metadata: { action: request.action, reason: note!.trim(), maker: request.requestedBy },
      })
      return (await viewRequests(tx, [updated], principal))[0]
    }

    const approvals = request.decisions.filter((d) => d.decision === 'approve').length + 1
    let resultRef: string | null = null
    if (approvals >= request.approvalsRequired) {
      const makerRow = await tx.user.findUniqueOrThrow({ where: { id: request.requestedBy }, select: { id: true, email: true } })
      const maker = { id: makerRow.id, email: makerRow.email ?? '' }
      const executed = await executeOperation(
        tx, request.action as ApprovalAction, request.payload as never, { maker, checker: toRef(principal) }, ctx,
      )
      resultRef = executed.resultRef
    }
    const updated = await tx.approvalRequest.update({
      where: { id: requestId },
      data: resultRef !== null
        ? { status: 'approved', decidedAt: new Date(), decisionNote: note?.trim() || null, resultRef }
        : {},
      include: { decisions: true },
    })
    await recordAudit(tx, ctx, {
      action: 'approval.approve', entityType: 'approval_request', entityId: request.publicId,
      metadata: { action: request.action, maker: request.requestedBy, approvals, required: request.approvalsRequired, resultRef },
    })
    return (await viewRequests(tx, [updated], principal))[0]
  }, { timeout: 120_000, maxWait: 10_000 }) // opening balances (M4) post many entries at once
}

/** The maker withdraws their own pending request. */
export async function cancelApproval(requestId: string, principal: StaffPrincipal, req: NextRequest) {
  const ctx = auditContext(req, principal)
  return prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({ where: { id: requestId } })
    if (!request) throw new OperationError(404, 'Approval request not found.')
    if (request.requestedBy !== principal.id) throw new OperationError(403, 'Only the person who proposed this can withdraw it.')
    const cancelled = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status: 'cancelled', decidedAt: new Date(), decisionNote: 'Withdrawn by the maker' },
    })
    if (cancelled.count === 0) throw new OperationError(409, `This request is already ${request.status}.`)
    await recordAudit(tx, ctx, { action: 'approval.cancel', entityType: 'approval_request', entityId: request.publicId })
    const row = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { decisions: true } })
    return (await viewRequests(tx, [row], principal))[0]
  })
}

/** Close any open request about an entity that no longer needs it (e.g. a rejected claim). */
export async function cancelPendingFor(tx: Tx, entityType: string, entityId: string, reason: string) {
  const result = await tx.approvalRequest.updateMany({
    where: { entityType, entityId, status: 'pending' },
    data: { status: 'cancelled', decidedAt: new Date(), decisionNote: reason },
  })
  return result.count
}

// ── Views ──────────────────────────────────────────────────────────────

type Row = Prisma.ApprovalRequestGetPayload<{ include: { decisions: true } }>

export type ApprovalView = {
  id: string
  publicId: string
  action: string
  label: string
  summary: string
  entityType: string
  entityId: string
  amountCents: number | null
  status: string
  approvalsRequired: number
  requestedBy: { id: string; name: string; email: string }
  requestedAt: Date
  decidedAt: Date | null
  decisionNote: string | null
  resultRef: string | null
  decisions: { decider: { id: string; name: string }; decision: string; note: string | null; at: Date }[]
  /** For the viewer: may they decide, and if not, why. */
  canDecide: boolean
  blockedReason: string | null
  isMine: boolean
}

export async function viewRequests(db: Tx | typeof prisma, rows: Row[], viewer: StaffPrincipal): Promise<ApprovalView[]> {
  const ids = Array.from(new Set(rows.flatMap((r) => [r.requestedBy, ...r.decisions.map((d) => d.deciderId)])))
  const staff = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
  const byId = new Map(staff.map((s) => [s.id, { ...s, email: s.email ?? '' }]))
  const who = (id: string) => byId.get(id) ?? { id, name: 'Unknown', email: '' }
  return rows.map((r) => {
    const policy = APPROVAL_POLICIES[r.action as ApprovalAction]
    const isMine = r.requestedBy === viewer.id
    const decided = r.decisions.some((d) => d.deciderId === viewer.id)
    const permitted = Boolean(policy) && viewer.permissions.has(policy.checkerPermission)
    const blockedReason = r.status !== 'pending' ? null
      : isMine ? 'You proposed this; someone else must approve it.'
      : decided ? 'You have already approved this.'
      : !permitted ? 'Your roles cannot approve this.'
      : null
    return {
      id: r.id, publicId: r.publicId, action: r.action, label: policy?.label ?? r.action, summary: r.summary,
      entityType: r.entityType, entityId: r.entityId,
      amountCents: r.amountCents === null ? null : fromBigInt(r.amountCents),
      status: r.status, approvalsRequired: r.approvalsRequired,
      requestedBy: who(r.requestedBy), requestedAt: r.requestedAt,
      decidedAt: r.decidedAt, decisionNote: r.decisionNote, resultRef: r.resultRef,
      decisions: r.decisions.map((d) => ({ decider: who(d.deciderId), decision: d.decision, note: d.note, at: d.at })),
      canDecide: r.status === 'pending' && blockedReason === null,
      blockedReason,
      isMine,
    }
  })
}

export { APPROVAL_POLICIES, makerCheckerEnforced, needsApproval } from './policy'
export type { ApprovalAction } from './policy'
