import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBaseFixtures } from './helpers/factories'
import { TEST_IDS, signInAs } from './helpers/actors'
import { prisma, resetDatabase } from './helpers/db'
import { callRoute } from './helpers/routes'
import { retryStripeEvents } from '@/modules/payments/stripe'
import { recordLoanPayment } from '@/lib/paymentActions'

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
  pending = await prisma.portalPayment.create({ data: { publicId: 'PP-SAFE', memberId: TEST_IDS.member, type: 'contribution', amount: 25, method: 'stripe', stripeSessionId: 'cs_safe' } })
})
afterEach(() => { vi.restoreAllMocks(); process.env.STRIPE_SECRET_KEY = ''; process.env.STRIPE_WEBHOOK_SECRET = '' })

describe('Stripe recovery', () => {
  it('rejects mismatched sessions, amounts, currencies, and fractional-cent checkout amounts', async () => {
    for (const [i, extra] of [{ id: 'cs_wrong' }, { amount_total: 2400 }, { currency: 'eur' }].entries()) {
      expect((await deliver(event(`evt_bad_${i}`, extra))).status).toBe(500)
    }
    expect(await prisma.contribution.count()).toBe(0)
    expect(await prisma.stripeWebhookEvent.count({ where: { status: 'failed' } })).toBe(3)
    signInAs('member')
    for (const amount of ['25oops', '0.001', 25.005]) expect((await callRoute('portal/payments/checkout', 'POST', { body: { type: 'contribution', method: 'zelle', amount } })).status).toBe(400)
  })
  it('persists a failed delivery, returns 500, and retries it exactly once', async () => {
    // Simulate a transient database failure after signature verification.
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('temporary posting outage'))
    expect((await deliver(event('evt_retry'))).status).toBe(500)
    vi.restoreAllMocks()
    expect((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_retry' } })).status).toBe('failed')
    expect(await prisma.contribution.count()).toBe(0)
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
    expect((await deliver(event('evt_no_reference', { metadata: {} }))).status).toBe(500)
    expect((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { eventId: 'evt_no_reference' } })).status).toBe('failed')
    expect(await prisma.contribution.count()).toBe(0)
  })
  it('does not expire a payment from another checkout session', async () => {
    const body = { ...event('evt_wrong_expiry', { id: 'cs_other' }), type: 'checkout.session.expired' }
    expect((await deliver(body)).status).toBe(200)
    expect((await prisma.portalPayment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('pending')
  })

})
