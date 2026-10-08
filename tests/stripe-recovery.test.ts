import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseFixtures } from './helpers/factories'
import { TEST_IDS, signInAs } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { callRoute } from './helpers/routes'
import { processStripeEvent, retryStripeEvents } from '@/modules/payments/stripe'
import { recordLoanPayment } from '@/lib/paymentActions'
import { sendEmail } from '@/lib/email'

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: vi.fn(async () => ({ ok: true })),
}))

const secret = 'whsec_recovery_test_only'
let pending: { id: string }
const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id, created: Math.floor(Date.now() / 1000), object: 'event', type: 'checkout.session.completed',
  data: { object: { id: 'cs_safe', currency: 'usd', amount_total: 2500, payment_status: 'paid', payment_intent: 'pi_safe', metadata: { portalPaymentId: pending.id }, ...extra } },
})
async function deliver(body: unknown) {
  const payload = JSON.stringify(body)
  const signature = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload, secret })
  return callRoute('webhooks/stripe', 'POST', { rawBody: payload, headers: { 'stripe-signature': signature } })
}
beforeEach(async () => {
  await resetDatabase()
  await createBaseFixtures()
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_WEBHOOK_SECRET = secret
  process.env.PAYMENT_ALERT_EMAIL = 'treasurer@example.test'
  vi.mocked(sendEmail).mockClear()
  pending = await prisma.portalPayment.create({ data: { publicId: 'PP-SAFE', memberId: TEST_IDS.member, type: 'contribution', amount: 25, method: 'stripe', stripeSessionId: 'cs_safe' } })
})
afterEach(() => { vi.restoreAllMocks(); process.env.STRIPE_SECRET_KEY = ''; process.env.STRIPE_WEBHOOK_SECRET = ''; process.env.PAYMENT_ALERT_EMAIL = ''; delete process.env.SECURITY_ALERT_EMAIL })

describe('Stripe recovery', () => {
  it('holds mismatched sessions, amounts and currencies for review, reported once; rejects fractional-cent checkout amounts', async () => {
    const started = new Date()
    for (const [i, extra] of [{ id: 'cs_wrong' }, { amount_total: 2400 }, { currency: 'eur' }].entries()) {
      // Retrying cannot fix a mismatch: Stripe is told it was received, and the evidence is kept.
      expect((await deliver(event(`evt_bad_${i}`, extra))).status).toBe(200)
      expect((await deliver(event(`evt_bad_${i}`, extra))).status).toBe(200)
    }
    expect(await prisma.contribution.count()).toBe(0)
    expect(await prisma.stripeWebhookEvent.count({ where: { status: 'review' } })).toBe(3)
    expect(sendEmail).toHaveBeenCalledTimes(3) // one alert each, not one per delivery
    expect(await retryStripeEvents()).toEqual({ checked: 0, failed: 0 }) // nothing for the retry job
    expect(await prisma.auditLog.count({ where: { action: 'payment.stripe.review_required', at: { gte: started } } })).toBe(3)
    signInAs('member')
    for (const amount of ['25oops', '0.001', 25.005]) expect((await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'zelle', amount } })).status).toBe(400)
  })
  it('persists a failed delivery, returns 500, and retries it exactly once', async () => {
    // Simulate a transient database failure after signature verification.
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('temporary posting outage'))
    expect((await deliver(event('evt_retry'))).status).toBe(500)
    vi.mocked(prisma.$transaction).mockRestore()
    expect((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_retry' } })).status).toBe('failed')
    expect(await prisma.contribution.count()).toBe(0)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(await retryStripeEvents()).toEqual({ checked: 1, failed: 0 })
    expect((await deliver(event('evt_retry'))).status).toBe(200)
    expect(await prisma.contribution.count()).toBe(1)
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).rejectionReason).toBeNull()
    expect((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_retry' } })).status).toBe('processed')
  })
  it('records refunds and disputes as durable staff-visible reconciliation issues', async () => {
    for (const type of ['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed']) {
      const body = { id: `evt_${type}`, created: Math.floor(Date.now() / 1000), type, data: { object: { id: 'ch_test' } } }
      expect((await deliver(body)).status).toBe(200)
      expect((await deliver(body)).status).toBe(200)
    }
    expect(await prisma.stripeWebhookEvent.count({ where: { status: 'review' } })).toBe(3)
    signInAs('treasurer')
    expect((await callRoute('payments', 'GET')).json.stripeIssues).toHaveLength(3)
    expect(await prisma.contribution.count()).toBe(0)
  })
  it('holds late externally settled payments as member credit on an already paid-off engine loan', async () => {
    const loanId = 'LN-SETTLED'
    await prisma.loan.create({ data: {
      loanId, borrowerId: TEST_IDS.member, borrowerName: 'Member', loanDate: new Date('2026-01-15'), loanAmount: 25, termMonths: 1,
      monthlyDue: 25, balanceRemaining: 25, lifecycle: 'disbursed', principalCents: BigInt(2500), applicationFeeCents: BigInt(0),
      dueDay: 10, graceDays: 15, policyVersion: 'loan-policy-2026.1', disbursedOn: new Date('2026-01-15'), disbursedAmountCents: BigInt(2500),
      installments: { create: { number: 1, dueDate: new Date('2026-02-10'), principalCents: BigInt(2500), interestCents: BigInt(0) } },
    } })
    await prisma.$transaction(tx => recordLoanPayment(tx, { loanId, amount: 25, paymentDate: new Date(), source: 'test' }))
    await prisma.portalPayment.update({ where: { id: pending.id }, data: { type: 'loan_payment', loanId } })
    expect((await deliver(event('evt_late'))).status).toBe(200)
    const { loadLoan, loanState } = await import('@/modules/loans/state')
    const { todayIso } = await import('@/lib/dates')
    const loan = await loadLoan(prisma, loanId)
    expect(loan?.lifecycle).toBe('paid_off')
    expect(loanState(loan!, todayIso()).unapplied).toBe(2500)
    expect(await prisma.loanPayment.count({ where: { loanId } })).toBe(2)
  })
  it('database preserves the verified webhook payload', async () => {
    expect((await deliver(event('evt_immutable'))).status).toBe(200)
    await expect(prisma.stripeWebhookEvent.update({ where: { eventId: 'evt_immutable' }, data: { payload: {} } })).rejects.toThrow(/cannot change/)
  })
  it('retains paid checkouts without a payment reference for investigation', async () => {
    expect((await deliver(event('evt_no_reference', { metadata: {} }))).status).toBe(200)
    expect((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_no_reference' } })).status).toBe('review')
    expect(await prisma.contribution.count()).toBe(0)
    // A payment reference that is not a club card payment is held the same way.
    expect((await deliver(event('evt_unknown', { metadata: { portalPaymentId: 'no-such-payment' } }))).status).toBe(200)
    expect((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_unknown' } })).lastError).toBe('Checkout has no matching club payment.')
  })
  it('the same event delivered many times at once is recorded once, and every delivery succeeds', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => deliver(event('evt_burst'))))
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200))
    expect(await prisma.contribution.count()).toBe(1)
    expect(await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_burst' } })).toMatchObject({ status: 'processed', lastError: null })
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('a failure that keeps happening is reported once, however often the job retries it', async () => {
    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('database unavailable'))
    expect((await deliver(event('evt_down'))).status).toBe(500)
    expect(await retryStripeEvents()).toEqual({ checked: 1, failed: 1 })
    expect(await retryStripeEvents()).toEqual({ checked: 1, failed: 1 })
    spy.mockRestore()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_down' } })).toMatchObject({ status: 'failed', attempts: 3 })
    expect(await retryStripeEvents()).toEqual({ checked: 1, failed: 0 })
    expect(await prisma.contribution.count()).toBe(1)
  })
  it('does not expire a payment from another checkout session', async () => {
    const body = { ...event('evt_wrong_expiry', { id: 'cs_other' }), type: 'checkout.session.expired' }
    expect((await deliver(body)).status).toBe(200)
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('pending')
  })


describe('Stripe events, every path', () => {
  const inbox = (eventId: string) => prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId } })

  it('an expired or failed checkout marks its payment failed, once, and only for its own session', async () => {
    const started = new Date()
    const expired = { ...event('evt_expired'), type: 'checkout.session.expired' }
    expect((await deliver(expired)).status).toBe(200)
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('failed')
    const expiries = () => prisma.auditLog.count({ where: { action: 'payment.stripe.expire', entityId: 'PP-SAFE', at: { gte: started } } })
    expect(await expiries()).toBe(1)
    expect((await deliver({ ...event('evt_failed_async'), type: 'checkout.session.async_payment_failed' })).status).toBe(200)
    expect(await expiries()).toBe(1)
    // A session without a club reference is ignored (another product on the same Stripe account).
    expect((await deliver({ ...event('evt_expired_other', { metadata: {} }), type: 'checkout.session.expired' })).status).toBe(200)
    expect((await inbox('evt_expired_other')).status).toBe('processed')
  })

  it('a bank payment that clears later: nothing until async_payment_succeeded, found by client_reference_id', async () => {
    // Stripe may send the payment intent expanded, as an object.
    const later = (id: string, type: string, payment_status: string) => ({ ...event(id, { payment_status, metadata: {}, client_reference_id: pending.id, payment_intent: { id: 'pi_later' } }), type })
    expect((await deliver(later('evt_unpaid', 'checkout.session.completed', 'unpaid'))).status).toBe(200)
    expect(await prisma.contribution.count()).toBe(0)
    expect((await inbox('evt_unpaid')).status).toBe('processed')
    expect((await deliver(later('evt_cleared', 'checkout.session.async_payment_succeeded', 'paid'))).status).toBe(200)
    expect(await prisma.contribution.count()).toBe(1)
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).stripePaymentIntentId).toBe('pi_later')
  })

  it('event types the club does not use are acknowledged and kept', async () => {
    expect((await deliver({ id: 'evt_other', created: 1, type: 'customer.created', data: { object: {} } })).status).toBe(200)
    expect((await inbox('evt_other')).status).toBe('processed')
  })

  it('a card loan payment with no loan is a failure to retry, reported once', async () => {
    await prisma.portalPayment.update({ where: { id: pending.id }, data: { type: 'loan_payment', loanId: null } })
    expect((await deliver(event('evt_no_loan'))).status).toBe(500)
    expect(await inbox('evt_no_loan')).toMatchObject({ status: 'failed', lastError: 'Missing loanId on loan_payment PortalPayment' })
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('failed')
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('a failure that is not an Error still reads as one', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce('connection reset')
    await expect(processStripeEvent(event('evt_odd') as never)).rejects.toBe('connection reset')
    expect(await inbox('evt_odd')).toMatchObject({ status: 'failed', lastError: 'Stripe posting failed' })
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).rejectionReason).toBe('Failed to record payment')
  })

  it('when the failure cannot be written to the audit log, the payment is still marked failed and the error logged', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('posting outage'))
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('audit outage'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(processStripeEvent(event('evt_audit_down') as never)).rejects.toThrow('posting outage')
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('failed')
    expect(logged).toHaveBeenCalledWith('audit: failed to record payment failure', expect.any(Error))
  })

  it('a payment another delivery completed meanwhile is not marked failed', async () => {
    const failuresBefore = await prisma.auditLog.count({ where: { action: 'payment.stripe.record_failed' } })
    await prisma.portalPayment.update({ where: { id: pending.id }, data: { status: 'completed' } })
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('lost the race'))
    await expect(processStripeEvent(event('evt_race') as never)).rejects.toThrow('lost the race')
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('completed')
    expect(await prisma.auditLog.count({ where: { action: 'payment.stripe.record_failed' } })).toBe(failuresBefore)
  })

  it('when another delivery already moved the event to review, nothing is reported twice', async () => {
    const reviewsBefore = await prisma.auditLog.count({ where: { action: 'payment.stripe.review_required' } })
    // Two deliveries read the row as pending; the other one finished first.
    const asPending = async (eventId: string, body: unknown) => {
      await processStripeEvent(body as never)
      const row = await inbox(eventId)
      vi.spyOn(prisma.stripeWebhookEvent, 'findUniqueOrThrow').mockResolvedValueOnce({ ...row, status: 'pending' } as never)
      await processStripeEvent(body as never)
    }
    await asPending('evt_dispute', { id: 'evt_dispute', created: 1, type: 'charge.dispute.created', data: { object: { id: 'ch_1' } } })
    await asPending('evt_mismatch', event('evt_mismatch', { amount_total: 1 }))
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(await prisma.auditLog.count({ where: { action: 'payment.stripe.review_required' } })).toBe(reviewsBefore + 2)
  })

  it('alerts go to PAYMENT_ALERT_EMAIL, else SECURITY_ALERT_EMAIL, else nowhere; a failed send is logged', async () => {
    const mismatch = (id: string) => deliver(event(id, { amount_total: 1 }))
    process.env.PAYMENT_ALERT_EMAIL = ''
    process.env.SECURITY_ALERT_EMAIL = 'security@example.test'
    await mismatch('evt_alert_1')
    expect(sendEmail).toHaveBeenLastCalledWith('security@example.test', expect.any(String), expect.stringContaining('evt_alert_1'))
    delete process.env.SECURITY_ALERT_EMAIL
    await mismatch('evt_alert_2')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    process.env.PAYMENT_ALERT_EMAIL = 'treasurer@example.test'
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, error: 'mail provider down' } as never)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mismatch('evt_alert_3')
    expect(logged).toHaveBeenCalledWith('Stripe alert could not be delivered:', 'mail provider down')
  })
})
})
