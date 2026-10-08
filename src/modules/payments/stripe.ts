import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { fromLegacyDollars } from '@/lib/money'
import { recordContribution, recordLoanPayment } from '@/lib/paymentActions'
import { recordAudit, systemAuditContext } from '@/modules/audit'
import { sendEmail, escapeHtml } from '@/lib/email'

/**
 * A verified event that can never post as it is (no club payment, or a
 * session, currency or amount that does not match it). Retrying cannot
 * help: it is kept for review and reported once.
 */
export class StripeReviewError extends Error {}

async function completeCheckout(session: Stripe.Checkout.Session, eventId: string, settledAt: number) {
  const portalPaymentId = session.metadata?.portalPaymentId || session.client_reference_id
  // Card payments are "paid" at completion; anything else waits for
  // checkout.session.async_payment_succeeded.
  if (session.payment_status !== 'paid') return
  if (!portalPaymentId) throw new StripeReviewError('Paid checkout has no club payment reference.')

  const payment = await prisma.portalPayment.findUnique({ where: { id: portalPaymentId } })
  if (!payment || payment.method !== 'stripe') throw new StripeReviewError('Checkout has no matching club payment.')
  if (session.id !== payment.stripeSessionId || session.currency !== 'usd' || session.amount_total !== fromLegacyDollars(payment.amount)) {
    throw new StripeReviewError('Checkout session, currency, or amount does not match the club payment.')
  }

  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  const ctx = systemAuditContext('stripe-webhook')
  const details = {
    paymentDate: new Date(settledAt * 1000),
    paymentMethod: 'Card (Stripe)',
    comments: `Stripe checkout ${session.id}`,
    source: 'Stripe',
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Stripe retries and can deliver the same event concurrently. Only
      // one delivery can move the payment to "completed"; the rest match
      // nothing here (after waiting on the row lock) and record nothing.
      const claimed = await tx.portalPayment.updateMany({
        where: { id: payment.id, status: { not: 'completed' } },
        data: { status: 'completed', stripePaymentIntentId: paymentIntentId, reviewedAt: new Date(), rejectionReason: null },
      })
      if (claimed.count === 0) return

      let after
      let recorded: Record<string, string>
      if (payment.type === 'contribution') {
        const record = await recordContribution(tx, { memberId: payment.memberId, amount: payment.amount, ...details })
        after = await tx.portalPayment.update({ where: { id: payment.id }, data: { contributionId: record.id } })
        recorded = { contributionId: record.transactionId }
      } else {
        if (!payment.loanId) throw new Error('Missing loanId on loan_payment PortalPayment')
        const record = await recordLoanPayment(tx, { loanId: payment.loanId, amount: payment.amount, settledExternally: true, ...details })
        after = await tx.portalPayment.update({ where: { id: payment.id }, data: { loanPaymentId: record.id } })
        recorded = { loanPaymentId: record.paymentId }
      }
      await recordAudit(tx, ctx, {
        action: 'payment.stripe.complete', entityType: 'portal_payment', entityId: payment.publicId,
        before: payment, after, metadata: { stripeEventId: eventId, checkoutSessionId: session.id, ...recorded },
      })
    })
  } catch (err: any) {
    const reason = err?.message?.slice(0, 500) || 'Failed to record payment'
    const failed = await prisma.portalPayment.updateMany({
      where: { id: payment.id, status: { not: 'completed' } },
      data: { status: 'failed', rejectionReason: reason },
    })
    if (failed.count > 0) {
      await recordAudit(prisma, ctx, {
        action: 'payment.stripe.record_failed', entityType: 'portal_payment', entityId: payment.publicId,
        before: payment, metadata: { stripeEventId: eventId, checkoutSessionId: session.id, reason },
      }).catch((auditErr) => console.error('audit: failed to record payment failure', auditErr))
    }
    throw err
  }
}

async function expireCheckout(session: Stripe.Checkout.Session, eventId: string) {
  const portalPaymentId = session.metadata?.portalPaymentId || session.client_reference_id
  if (!portalPaymentId) return
  await prisma.$transaction(async (tx) => {
    const expired = await tx.portalPayment.updateMany({
      where: { id: portalPaymentId, stripeSessionId: session.id, method: 'stripe', status: 'pending' },
      data: { status: 'failed' },
    })
    if (expired.count === 0) return
    const payment = await tx.portalPayment.findUniqueOrThrow({ where: { id: portalPaymentId } })
    await recordAudit(tx, systemAuditContext('stripe-webhook'), {
      action: 'payment.stripe.expire', entityType: 'portal_payment', entityId: payment.publicId,
      after: payment, metadata: { stripeEventId: eventId, checkoutSessionId: session.id },
    })
  })
}


/** Called only with a verified Stripe event, or a previously verified inbox row. */
export async function processStripeEvent(event: Stripe.Event) {
  // Stripe can deliver one event several times at once. Insert-if-absent is
  // a single statement (ON CONFLICT DO NOTHING), so simultaneous deliveries
  // cannot collide here; each then reads the one row.
  await prisma.stripeWebhookEvent.createMany({
    data: [{ eventId: event.id, type: event.type, payload: event as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  })
  const row = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: event.id } })
  if (row.status === 'processed' || row.status === 'review') return
  // Crash recovery uses the inbox's pending/failed rows. Competing workers
  // remain idempotent on the payment row; no success is acknowledged early.
  const ctx = systemAuditContext('stripe-webhook')
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await completeCheckout(event.data.object as Stripe.Checkout.Session, event.id, event.created)
        break
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await expireCheckout(event.data.object as Stripe.Checkout.Session, event.id)
        break
      case 'charge.refunded':
      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        const changed = await prisma.stripeWebhookEvent.updateMany({
          where: { eventId: event.id, status: { not: 'review' } },
          data: { status: 'review', attempts: { increment: 1 }, lastError: 'Refund/dispute requires Treasurer reconciliation; the books have not been adjusted automatically.' },
        })
        if (changed.count) {
          await recordAudit(prisma, ctx, { action: 'payment.stripe.review_required', entityType: 'stripe_event', entityId: event.id, metadata: { type: event.type } })
          await alertStripeIssue(event.id, event.type)
        }
        return
      }
    }
    await prisma.stripeWebhookEvent.update({ where: { eventId: event.id }, data: { status: 'processed', attempts: { increment: 1 }, lastError: null, processedAt: new Date() } })
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 500) : 'Stripe posting failed'
    if (err instanceof StripeReviewError) {
      const held = await prisma.stripeWebhookEvent.updateMany({
        where: { eventId: event.id, status: { notIn: ['processed', 'review'] } },
        data: { status: 'review', attempts: { increment: 1 }, lastError: reason },
      })
      if (held.count) {
        await recordAudit(prisma, ctx, { action: 'payment.stripe.review_required', entityType: 'stripe_event', entityId: event.id, metadata: { type: event.type, reason } })
        await alertStripeIssue(event.id, reason)
      }
      return
    }
    const failed = await prisma.stripeWebhookEvent.updateMany({ where: { eventId: event.id, status: { notIn: ['processed', 'review'] } }, data: { status: 'failed', attempts: { increment: 1 }, lastError: reason } })
    // The retry job runs every few minutes: alert on the first failure, not on every retry.
    if (failed.count && row.status !== 'failed') await alertStripeIssue(event.id, reason)
    throw err
  }
}

async function alertStripeIssue(eventId: string, reason: string) {
  const to = process.env.PAYMENT_ALERT_EMAIL || process.env.SECURITY_ALERT_EMAIL
  if (!to) return
  const sent = await sendEmail(to, 'MCFinancial: Stripe payment needs attention', `<p>Event ${escapeHtml(eventId)}: ${escapeHtml(reason)}</p><p>Review Payments and reconcile against Stripe before adjusting the books.</p>`)
  if (!sent.ok) console.error('Stripe alert could not be delivered:', sent.error)
}

/** A bounded retry batch; oldest attempted rows first so one failure cannot starve the queue. */
export async function retryStripeEvents() {
  const events = await prisma.stripeWebhookEvent.findMany({ where: { status: { in: ['pending', 'failed'] } }, orderBy: { updatedAt: 'asc' }, take: 100 })
  let failed = 0
  for (const row of events) {
    try { await processStripeEvent(row.payload as unknown as Stripe.Event) } catch { failed++ }
  }
  return { checked: events.length, failed }
}
