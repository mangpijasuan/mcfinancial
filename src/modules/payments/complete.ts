import type { PortalPayment, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordContribution, recordLoanPayment } from '@/lib/paymentActions'
import { recordAudit, systemAuditContext } from '@/modules/audit'

export type CompletionDetails = {
  paymentDate: Date
  paymentMethod: string
  comments: string
  source: string
}

/**
 * Records a member's online payment (card or ACH) once its processor says
 * it is paid: the contribution or loan repayment, its ledger entries and
 * the audit entry, in one transaction. Safe to call any number of times,
 * at once: only one call moves the payment to "completed"; the others
 * match nothing and record nothing. Returns whether this call recorded it.
 *
 * If recording fails, the payment is marked failed with the reason (and
 * audited), and the error is rethrown for the caller to retry or report.
 */
export async function completePortalPayment(payment: PortalPayment, opts: {
  actor: string
  action: string
  failedAction: string
  details: CompletionDetails
  /** Processor references stored on the payment as it completes. */
  references?: Prisma.PortalPaymentUpdateManyMutationInput
  metadata: Record<string, unknown>
}): Promise<boolean> {
  const ctx = systemAuditContext(opts.actor)
  try {
    return await prisma.$transaction(async (tx) => {
      // Waits on the row lock: a concurrent caller sees "completed" and stops.
      const claimed = await tx.portalPayment.updateMany({
        where: { id: payment.id, status: { not: 'completed' } },
        data: { ...opts.references, status: 'completed', reviewedAt: new Date(), rejectionReason: null },
      })
      if (claimed.count === 0) return false

      let after
      let recorded: Record<string, string>
      if (payment.type === 'contribution') {
        const record = await recordContribution(tx, { memberId: payment.memberId, amount: payment.amount, ...opts.details })
        after = await tx.portalPayment.update({ where: { id: payment.id }, data: { contributionId: record.id } })
        recorded = { contributionId: record.transactionId }
      } else {
        if (!payment.loanId) throw new Error('Missing loanId on loan_payment PortalPayment')
        const record = await recordLoanPayment(tx, { loanId: payment.loanId, amount: payment.amount, settledExternally: true, ...opts.details })
        after = await tx.portalPayment.update({ where: { id: payment.id }, data: { loanPaymentId: record.id } })
        recorded = { loanPaymentId: record.paymentId }
      }
      await recordAudit(tx, ctx, {
        action: opts.action, entityType: 'portal_payment', entityId: payment.publicId,
        before: payment, after, metadata: { ...opts.metadata, ...recorded },
      })
      return true
    })
  } catch (err: any) {
    const reason = err?.message?.slice(0, 500) || 'Failed to record payment'
    const failed = await prisma.portalPayment.updateMany({
      where: { id: payment.id, status: { not: 'completed' } },
      data: { status: 'failed', rejectionReason: reason },
    })
    if (failed.count > 0) {
      await recordAudit(prisma, ctx, {
        action: opts.failedAction, entityType: 'portal_payment', entityId: payment.publicId,
        before: payment, metadata: { ...opts.metadata, reason },
      }).catch((auditErr) => console.error('audit: failed to record payment failure', auditErr))
    }
    throw err
  }
}
